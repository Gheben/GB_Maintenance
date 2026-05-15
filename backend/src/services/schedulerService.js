const cron = require('node-cron');
const { query, getMany, getOne } = require('../db/database');
const { notifyMaintenance, sendEmailNotification } = require('./notificationService');
const logger = require('../utils/logger');
const wsService = require('./wsService');

// ─── Reminder intervals ───────────────────────────────────────────────────────
const REMINDERS = [
  { key: '7d',  ms: 7 * 24 * 60 * 60 * 1000, label: '7 giorni' },
  { key: '1d',  ms: 1 * 24 * 60 * 60 * 1000, label: '1 giorno' },
  { key: '2h',  ms: 2 * 60 * 60 * 1000,       label: '2 ore' },
  { key: '30m', ms: 30 * 60 * 1000,            label: '30 minuti' },
];

let initialized = false;

function start() {
  if (initialized) return;
  initialized = true;

  // Every minute: auto-transition maintenance status
  cron.schedule('* * * * *', async () => {
    await _tickMaintenanceStatus();
  });

  // Every 5 minutes: run reminders check
  cron.schedule('*/5 * * * *', async () => {
    await _checkReminders();
  });

  // Every minute: probe tick handled by probeService
  logger.info('[Scheduler] Started');
}

async function _tickMaintenanceStatus() {
  try {
    const now = new Date();

    // Scheduled → In Progress
    const toStart = await getMany(
      `SELECT id FROM maintenance_windows
       WHERE status='scheduled' AND scheduled_start <= $1`,
      [now]
    );
    for (const m of toStart) {
      await query(
        `UPDATE maintenance_windows SET status='in_progress', actual_start=NOW(), updated_at=NOW() WHERE id=$1`,
        [m.id]
      );
      await _updateAssetsStatus(m.id, 'under_maintenance');
      await notifyMaintenance(m.id, 'maintenance_started');
      wsService.broadcast({ type: 'maintenance_started', id: m.id });
      logger.info(`[Scheduler] Maintenance ${m.id} auto-started`);
    }

    // In Progress → Completed (past end time + 30min grace)
    const toComplete = await getMany(
      `SELECT id FROM maintenance_windows
       WHERE status='in_progress' AND scheduled_end < $1`,
      [new Date(now.getTime() - 30 * 60 * 1000)]
    );
    for (const m of toComplete) {
      await query(
        `UPDATE maintenance_windows SET status='completed', actual_end=NOW(), updated_at=NOW() WHERE id=$1`,
        [m.id]
      );
      await _updateAssetsStatus(m.id, 'operational');
      await notifyMaintenance(m.id, 'maintenance_completed');
      wsService.broadcast({ type: 'maintenance_completed', id: m.id });
      logger.info(`[Scheduler] Maintenance ${m.id} auto-completed`);
    }
  } catch (err) {
    logger.error(`[Scheduler] _tickMaintenanceStatus: ${err.message}`);
  }
}

async function _checkReminders() {
  try {
    const now = Date.now();

    const upcoming = await getMany(
      `SELECT id, scheduled_start, reminders_sent FROM maintenance_windows
       WHERE status = 'scheduled' AND scheduled_start > NOW()
         AND scheduled_start < NOW() + INTERVAL '8 days'`
    );

    for (const m of upcoming) {
      const remSent = m.reminders_sent || {};
      const msUntil = new Date(m.scheduled_start).getTime() - now;
      const updatedFlags = { ...remSent };
      let changed = false;

      for (const rem of REMINDERS) {
        if (!remSent[rem.key] && msUntil <= rem.ms && msUntil > 0) {
          await notifyMaintenance(m.id, 'maintenance_reminder', { time_before: rem.label });
          updatedFlags[rem.key] = true;
          changed = true;
          logger.info(`[Scheduler] Sent ${rem.key} reminder for maintenance ${m.id}`);
        }
      }

      if (changed) {
        await query(
          `UPDATE maintenance_windows SET reminders_sent=$1 WHERE id=$2`,
          [JSON.stringify(updatedFlags), m.id]
        );
      }
    }

    const expiringLicenses = await getMany(
      `SELECT l.id, l.name, l.expiry_date, l.reminder_days, l.owner_contact,
              uo.email AS owner_user_email, s.company AS supplier_company
       FROM licenses l
       LEFT JOIN users uo ON uo.id=l.owner_user_id
       LEFT JOIN suppliers s ON s.id=l.supplier_id
       WHERE l.expiry_date IS NOT NULL
         AND l.expiry_date >= CURRENT_DATE
         AND l.expiry_date <= CURRENT_DATE + (GREATEST(COALESCE(l.reminder_days, 30), 1) || ' days')::interval`
    );

    for (const license of expiringLicenses) {
      const alreadySent = await getOne(
        `SELECT 1 FROM notification_log
         WHERE event_type='license_expiry_reminder' AND reference_type='license' AND reference_id=$1
         LIMIT 1`,
        [license.id]
      );
      if (alreadySent) continue;

      const recipients = new Set();
      const add = (value) => {
        const email = String(value || '').trim();
        if (email) recipients.add(email);
      };

      add(license.owner_user_email);
      if (Array.isArray(license.owner_contact)) {
        for (const item of license.owner_contact) add(item?.email);
      }

      if (recipients.size === 0) continue;

      await sendEmailNotification('license_expiry_reminder', [...recipients], {
        license_id: license.id,
        license_name: license.name,
        supplier_company: license.supplier_company || '-',
        activation_date: license.activation_date ? String(license.activation_date).slice(0, 10) : '-',
        expiry_date: String(license.expiry_date).slice(0, 10),
        reminder_days: license.reminder_days || 30,
      }, 'license', license.id);

      logger.info(`[Scheduler] Sent expiry reminder for license ${license.id}`);
    }
  } catch (err) {
    logger.error(`[Scheduler] _checkReminders: ${err.message}`);
  }
}

async function _updateAssetsStatus(maintenanceId, newStatus) {
  try {
    const assets = await getMany(
      `SELECT asset_id FROM maintenance_assets WHERE maintenance_id=$1`,
      [maintenanceId]
    );
    for (const a of assets) {
      const current = await getOne('SELECT status FROM assets WHERE id=$1', [a.asset_id]);
      if (current && current.status !== newStatus) {
        await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, a.asset_id]);
        await query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('asset', $1, $2, 'system', $3)`,
          [a.asset_id, newStatus, `Maintenance ${maintenanceId}`]
        );
        wsService.broadcast({ type: 'asset_status_changed', assetId: a.asset_id, status: newStatus });
      }
    }
  } catch (err) {
    logger.error(`[Scheduler] _updateAssetsStatus: ${err.message}`);
  }
}

module.exports = { start };
