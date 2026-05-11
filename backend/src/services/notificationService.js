const { query, getOne, getMany } = require('../db/database');
const { sendMail, renderTemplate } = require('../utils/mailer');
const logger = require('../utils/logger');
const axios = require('axios');

// ─── In-App Notification ──────────────────────────────────────────────────────
async function sendInApp(userId, type, title, message, refType, refId) {
  try {
    await query(
      `INSERT INTO in_app_notifications (user_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, title, message || null, refType || null, refId || null]
    );
    // Push via WS if connected
    const wsService = require('./wsService');
    wsService.sendToUser(userId, { type: 'notification', payload: { type, title, message } });
  } catch (err) {
    logger.error(`[Notify] sendInApp error: ${err.message}`);
  }
}

// ─── Get notification template ────────────────────────────────────────────────
async function getTemplate(eventType) {
  return getOne(
    `SELECT * FROM notification_templates WHERE event_type=$1 AND is_active=true`,
    [eventType]
  );
}

// ─── Log notification ─────────────────────────────────────────────────────────
async function logNotification(eventType, channel, recipient, refType, refId, subject, status, errorMsg) {
  await query(
    `INSERT INTO notification_log (event_type, channel, recipient, reference_type, reference_id, subject, status, error_message, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [eventType, channel, recipient, refType || null, refId || null, subject || null, status, errorMsg || null, status === 'sent' ? new Date() : null]
  );
}

// ─── Send email notification ──────────────────────────────────────────────────
async function sendEmailNotification(eventType, toEmails, vars, refType, refId) {
  const tpl = await getTemplate(eventType);
  if (!tpl) {
    logger.warn(`[Notify] No active template for event: ${eventType}`);
    return;
  }

  const appUrl = process.env.APP_URL || 'http://localhost:4681';
  const allVars = { ...vars, app_url: appUrl };
  const subject = renderTemplate(tpl.subject_template, allVars);
  const html    = renderTemplate(tpl.body_html_template, allVars);

  for (const email of toEmails) {
    try {
      await sendMail({ to: email, subject, html });
      await logNotification(eventType, 'email', email, refType, refId, subject, 'sent');
    } catch (err) {
      await logNotification(eventType, 'email', email, refType, refId, subject, 'failed', err.message);
    }
  }
}

// ─── Send webhook notification ────────────────────────────────────────────────
async function sendWebhook(url, payload) {
  try {
    await axios.post(url, payload, { timeout: 10000 });
    logger.info(`[Notify] Webhook sent to ${url}`);
    return true;
  } catch (err) {
    logger.error(`[Notify] Webhook failed for ${url}: ${err.message}`);
    return false;
  }
}

// ─── Get subscribers for a maintenance window ─────────────────────────────────
async function getMaintenanceSubscribers(maintenanceId) {
  const emails = new Set();
  const userIds = new Set();

  // Get assets linked to maintenance (via maintenance_assets)
  const assets = await getMany(
    `SELECT asset_id FROM maintenance_assets WHERE maintenance_id=$1`,
    [maintenanceId]
  );

  // Get services linked directly (via maintenance_services) + via assets
  let allServiceIds = new Set();

  if (assets.length > 0) {
    const assetIds = assets.map(a => a.asset_id);
    const assetServices = await getMany(
      `SELECT DISTINCT service_id FROM service_assets WHERE asset_id = ANY($1::uuid[])`,
      [assetIds]
    );
    assetServices.forEach(s => allServiceIds.add(s.service_id));
  }

  const directServices = await getMany(
    `SELECT service_id FROM maintenance_services WHERE maintenance_id=$1`,
    [maintenanceId]
  );
  directServices.forEach(s => allServiceIds.add(s.service_id));

  const serviceIds = [...allServiceIds];
  if (serviceIds.length === 0) return { emails: [], userIds: [] };

  // Subscribers
  const subs = await getMany(
    `SELECT DISTINCT ss.email, u.email as user_email, u.id as user_id, ss.notify_maintenance
     FROM service_subscribers ss
     LEFT JOIN users u ON u.id = ss.user_id
     WHERE ss.service_id = ANY($1::uuid[]) AND ss.notify_maintenance = true`,
    [serviceIds]
  );

  // Service owners
  const owners = await getMany(
    `SELECT DISTINCT s.owner_id as user_id, u.email as user_email
     FROM services s JOIN users u ON u.id=s.owner_id
     WHERE s.id = ANY($1::uuid[]) AND s.owner_id IS NOT NULL AND u.is_active=true`,
    [serviceIds]
  );

  for (const sub of subs) {
    if (sub.email) emails.add(sub.email);
    if (sub.user_email) emails.add(sub.user_email);
    if (sub.user_id) userIds.add(sub.user_id);
  }
  for (const o of owners) {
    if (o.user_email) emails.add(o.user_email);
    if (o.user_id) userIds.add(o.user_id);
  }

  return { emails: [...emails], userIds: [...userIds] };
}

// ─── Notify maintenance event ─────────────────────────────────────────────────
async function notifyMaintenance(maintenanceId, eventType, extraVars = {}) {
  try {
    const maint = await getOne(`SELECT * FROM maintenance_windows WHERE id=$1`, [maintenanceId]);
    if (!maint) return;

    const { emails, userIds } = await getMaintenanceSubscribers(maintenanceId);

    const vars = {
      id: maint.id,
      title: maint.title,
      type: maint.type,
      impact_level: maint.impact_level,
      scheduled_start: new Date(maint.scheduled_start).toLocaleString('it-IT'),
      scheduled_end: new Date(maint.scheduled_end).toLocaleString('it-IT'),
      actual_start: maint.actual_start ? new Date(maint.actual_start).toLocaleString('it-IT') : '-',
      actual_end: maint.actual_end ? new Date(maint.actual_end).toLocaleString('it-IT') : '-',
      description: maint.description || '-',
      notes: maint.notes || '-',
      ...extraVars
    };

    if (emails.length > 0) {
      await sendEmailNotification(eventType, emails, vars, 'maintenance', maintenanceId);
    }

    // In-app for subscribed users
    for (const uid of userIds) {
      const titles = {
        maintenance_scheduled: `Manutenzione Programmata: ${maint.title}`,
        maintenance_reminder: `Promemoria: ${maint.title} inizia tra ${extraVars.time_before || ''}`,
        maintenance_started: `Manutenzione Iniziata: ${maint.title}`,
        maintenance_completed: `Manutenzione Completata: ${maint.title}`,
      };
      await sendInApp(uid, eventType, titles[eventType] || maint.title, vars.description, 'maintenance', maintenanceId);
    }

    // Webhooks
    await _dispatchWebhooks(eventType, { maintenance: maint, ...extraVars });
  } catch (err) {
    logger.error(`[Notify] notifyMaintenance error: ${err.message}`);
  }
}

// ─── Notify incident event ────────────────────────────────────────────────────
async function notifyIncident(incidentId, eventType) {
  try {
    const incident = await getOne(`SELECT * FROM incidents WHERE id=$1`, [incidentId]);
    if (!incident) return;

    // Get assets linked to incident → services → subscribers
    const assets = await getMany(`SELECT asset_id FROM incident_assets WHERE incident_id=$1`, [incidentId]);
    const assetIds = assets.map(a => a.asset_id);

    let emails = new Set();
    let userIds = new Set();

    if (assetIds.length > 0) {
      const services = await getMany(
        `SELECT DISTINCT service_id FROM service_assets WHERE asset_id = ANY($1::uuid[])`,
        [assetIds]
      );
      const serviceIds = services.map(s => s.service_id);
      if (serviceIds.length > 0) {
        const subs = await getMany(
          `SELECT ss.email, u.email as user_email, u.id as user_id
           FROM service_subscribers ss LEFT JOIN users u ON u.id=ss.user_id
           WHERE ss.service_id = ANY($1::uuid[]) AND ss.notify_incidents=true`,
          [serviceIds]
        );
        subs.forEach(s => {
          if (s.email) emails.add(s.email);
          if (s.user_email) emails.add(s.user_email);
          if (s.user_id) userIds.add(s.user_id);
        });
        // Also notify service owners
        const owners = await getMany(
          `SELECT DISTINCT s.owner_id as user_id, u.email as user_email
           FROM services s JOIN users u ON u.id=s.owner_id
           WHERE s.id = ANY($1::uuid[]) AND s.owner_id IS NOT NULL AND u.is_active=true`,
          [serviceIds]
        );
        owners.forEach(o => {
          if (o.user_email) emails.add(o.user_email);
          if (o.user_id) userIds.add(o.user_id);
        });
      }
    }

    const vars = {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      description: incident.description || '-',
      started_at: new Date(incident.started_at).toLocaleString('it-IT'),
      resolved_at: incident.resolved_at ? new Date(incident.resolved_at).toLocaleString('it-IT') : '-',
    };

    if (emails.size > 0) {
      await sendEmailNotification(eventType, [...emails], vars, 'incident', incidentId);
    }
    for (const uid of userIds) {
      await sendInApp(uid, eventType, `Incidente: ${incident.title}`, incident.description, 'incident', incidentId);
    }

    await _dispatchWebhooks(eventType, { incident });
  } catch (err) {
    logger.error(`[Notify] notifyIncident error: ${err.message}`);
  }
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
async function _dispatchWebhooks(eventType, payload) {
  try {
    const row = await getOne("SELECT value FROM settings WHERE key='webhook_config'");
    if (!row) return;
    const webhooks = JSON.parse(row.value);
    if (!Array.isArray(webhooks)) return;

    for (const wh of webhooks) {
      if (!wh.enabled || !wh.url) continue;
      if (wh.events && !wh.events.includes(eventType)) continue;
      await sendWebhook(wh.url, { event: eventType, timestamp: new Date().toISOString(), ...payload });
    }
  } catch (err) {
    logger.error(`[Notify] _dispatchWebhooks error: ${err.message}`);
  }
}

module.exports = {
  sendInApp, sendEmailNotification, sendWebhook,
  notifyMaintenance, notifyIncident,
  getMaintenanceSubscribers, logNotification
};
