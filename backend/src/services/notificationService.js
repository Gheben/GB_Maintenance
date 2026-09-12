const { query, getOne, getMany } = require('../db/database');
const { sendMail, renderTemplate } = require('../utils/mailer');
const logger = require('../utils/logger');
const axios = require('axios');
const {
  getAffectedAssets,
  getAffectedServices,
  getMaintenanceAffectedAssets,
  getMaintenanceAffectedServices,
} = require('../utils/maintenanceScope');
const { getVisibleAffectedScope } = require('../utils/entityVisibility');

function affectedScopeTemplateVars(scope) {
  return {
    primary_assets: scope.assets.filter((asset) => asset.is_direct).map((asset) => asset.name).join(', ') || '-',
    affected_assets: scope.assets.map((asset) => asset.name).join(', ') || '-',
    primary_services: scope.services.filter((service) => service.is_direct).map((service) => service.name).join(', ') || '-',
    affected_services: scope.services.map((service) => service.name).join(', ') || '-',
  };
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/?(p|div|h1|h2|h3|h4|h5|h6|tr|li|ul|ol|table|thead|tbody|tfoot|section|article|header|footer|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildEmailHtmlDocument({ appName, appUrl, subject, bodyHtml }) {
  const safeAppName = String(appName || 'GB Maintenance');
  const safeAppUrl = String(appUrl || '').trim();
  const safeSubject = String(subject || 'Notification');
  const safeBody = String(bodyHtml || '<p>No content.</p>');

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;word-spacing:normal;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <center style="width:100%;background-color:#f1f5f9;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;border-collapse:collapse;">
        <tr>
          <td align="center" style="padding:24px 12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:640px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:18px 24px;background-color:#0f172a;color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;">
                  ${safeAppName}
                </td>
              </tr>
              <tr>
                <td style="padding:20px 24px 8px 24px;font-family:Segoe UI,Arial,sans-serif;font-size:20px;line-height:28px;font-weight:700;color:#0f172a;">
                  ${safeSubject}
                </td>
              </tr>
              <tr>
                <td style="padding:0 24px 24px 24px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:22px;color:#334155;">
                  ${safeBody}
                </td>
              </tr>
              <tr>
                <td style="padding:14px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">
                  This is an automated notification from ${safeAppName}.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </center>
  </body>
</html>`;
}

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
async function sendEmailNotification(eventType, toEmails, vars, refType, refId, options = {}) {
  let tpl = await getTemplate(eventType);
  if (!tpl && eventType === 'maintenance_reopened') {
    tpl = await getTemplate('maintenance_started');
  }
  if (!tpl) {
    logger.warn(`[Notify] No active template for event: ${eventType}`);
    return;
  }

  const row = await getOne("SELECT value FROM settings WHERE key='general_config'").catch(() => null);
  const general = row?.value ? JSON.parse(row.value || '{}') : {};
  const appUrl = String(general?.app_url || process.env.APP_URL || 'http://localhost:4681').replace(/\/$/, '');
  const appName = String(general?.app_name || 'GB Maintenance');
  for (const email of toEmails) {
    let subject = eventType;
    try {
      const recipientVars = options.varsForRecipient
        ? await options.varsForRecipient(email)
        : {};
      const allVars = { ...vars, ...recipientVars, app_url: appUrl };
      subject = renderTemplate(tpl.subject_template, allVars);
      const htmlFragment = renderTemplate(tpl.body_html_template, allVars);
      const html = buildEmailHtmlDocument({ appName, appUrl, subject, bodyHtml: htmlFragment });
      const text = [subject, '', htmlToPlainText(htmlFragment), '', appUrl].filter(Boolean).join('\n');
      await sendMail({ to: email, subject, html, text });
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

  const affectedAssets = await getMaintenanceAffectedAssets(maintenanceId);
  const assetIds = affectedAssets.map(asset => asset.id);
  const serviceIds = (await getMaintenanceAffectedServices(maintenanceId)).map(service => service.service_id);

  // Direct maintenance status subscribers — always fetched, independent of services
  const statusSubs = await getMany(
    `SELECT u.id as user_id, u.email as user_email
     FROM maintenance_status_subscribers mss
     JOIN users u ON u.id = mss.user_id
     WHERE mss.maintenance_id = $1 AND u.is_active = true`,
    [maintenanceId]
  ).catch(() => []);

  // Subscribers
  const subs = serviceIds.length > 0 ? await getMany(
    `SELECT DISTINCT ss.email, u.email as user_email, u.id as user_id, ss.notify_maintenance
     FROM service_subscribers ss
     LEFT JOIN users u ON u.id = ss.user_id
     WHERE ss.service_id = ANY($1::uuid[]) AND ss.notify_maintenance = true`,
    [serviceIds]
  ) : [];

  // (statusSubs already fetched above)

  // Service owners
  const owners = serviceIds.length > 0 ? await getMany(
    `SELECT DISTINCT s.owner_id as user_id, u.email as user_email
     FROM services s JOIN users u ON u.id=s.owner_id
     WHERE s.id = ANY($1::uuid[]) AND s.owner_id IS NOT NULL AND u.is_active=true`,
    [serviceIds]
  ) : [];

  // Users audience from service user_targets
  const targetServiceOwners = serviceIds.length > 0 ? await getMany(
    `SELECT DISTINCT u.id AS user_id, u.email AS user_email
     FROM services s
     JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
     JOIN users u ON (
       (ot->>'type'='user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id=(ot->>'id')::uuid)
       OR (
         ot->>'type'='local_group'
         AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
         AND EXISTS (
           SELECT 1 FROM user_group_members ugm
           WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=u.id
         )
       )
     )
     WHERE s.id = ANY($1::uuid[]) AND u.is_active=true`,
    [serviceIds]
  ).catch(() => []) : [];

  // Users audience from directly selected and related asset user_targets.
  const targetAssetOwners = assetIds.length > 0 ? await getMany(
    `SELECT DISTINCT u.id AS user_id, u.email AS user_email
     FROM assets a
     JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
     JOIN users u ON (
       (ot->>'type'='user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id=(ot->>'id')::uuid)
       OR (
         ot->>'type'='local_group'
         AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
         AND EXISTS (
           SELECT 1 FROM user_group_members ugm
           WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=u.id
         )
       )
     )
     WHERE a.id = ANY($1::uuid[]) AND u.is_active=true`,
    [assetIds]
  ).catch(() => []) : [];

  const targetLdapAssetUsers = assetIds.length > 0 ? await getMany(
    `WITH asset_targets AS (
       SELECT ot
       FROM assets a
       JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
       WHERE a.id = ANY($1::uuid[])
     )
     SELECT DISTINCT lc.email AS user_email
     FROM asset_targets target
     JOIN ldap_users_cache lc ON (
       target.ot->>'type' = 'ldap_user'
       AND NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), '') IS NOT NULL
       AND (
         LOWER(COALESCE(lc.dn, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
         OR LOWER(COALESCE(lc.username, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
         OR LOWER(COALESCE(lc.upn, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
       )
     )
     WHERE lc.email IS NOT NULL
     UNION
     SELECT DISTINCT NULLIF(BTRIM(target.ot->>'email'), '') AS user_email
     FROM asset_targets target
     WHERE target.ot->>'type' = 'ldap_user'
       AND NULLIF(BTRIM(target.ot->>'email'), '') IS NOT NULL
     UNION
     SELECT DISTINCT lc.email AS user_email
     FROM asset_targets target
     JOIN ldap_users_cache lc ON (
       target.ot->>'type' = 'ldap_group'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) member(dn)
         WHERE LOWER(member.dn) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
            OR SPLIT_PART(LOWER(member.dn), ',', 1) = SPLIT_PART(LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), '')), ',', 1)
       )
     )
     WHERE lc.email IS NOT NULL
     UNION
     SELECT DISTINCT lc.email AS user_email
     FROM asset_targets target
     JOIN ldap_group_mappings lgm ON (
       target.ot->>'type' = 'local_group'
       AND (target.ot->>'id') ~* '^[0-9a-f-]{36}$'
       AND lgm.local_group_id=(target.ot->>'id')::uuid
     )
     JOIN ldap_users_cache lc ON EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) member(dn)
       WHERE LOWER(member.dn) = LOWER(lgm.ldap_group_dn)
          OR SPLIT_PART(LOWER(member.dn), ',', 1) = SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
     )
     WHERE lc.email IS NOT NULL`,
    [assetIds]
  ).catch(() => []) : [];

  for (const sub of subs) {
    if (sub.email) emails.add(sub.email);
    if (sub.user_email) emails.add(sub.user_email);
    if (sub.user_id) userIds.add(sub.user_id);
  }
  for (const ss of statusSubs) {
    if (ss.user_email) emails.add(ss.user_email);
    if (ss.user_id) userIds.add(ss.user_id);
  }
  for (const o of owners) {
    if (o.user_email) emails.add(o.user_email);
    if (o.user_id) userIds.add(o.user_id);
  }
  for (const o of targetServiceOwners) {
    if (o.user_email) emails.add(o.user_email);
    if (o.user_id) userIds.add(o.user_id);
  }
  for (const o of targetAssetOwners) {
    if (o.user_email) emails.add(o.user_email);
    if (o.user_id) userIds.add(o.user_id);
  }
  for (const user of targetLdapAssetUsers) {
    if (user.user_email) emails.add(user.user_email);
  }

  return { emails: [...emails], userIds: [...userIds] };
}

// ─── Notify maintenance event ─────────────────────────────────────────────────
async function notifyMaintenance(maintenanceId, eventType, extraVars = {}) {
  try {
    const maint = await getOne(`SELECT * FROM maintenance_windows WHERE id=$1`, [maintenanceId]);
    if (!maint) return;

    const { emails, userIds } = await getMaintenanceSubscribers(maintenanceId);
    const [affectedAssets, affectedServices] = await Promise.all([
      getMaintenanceAffectedAssets(maintenanceId),
      getMaintenanceAffectedServices(maintenanceId),
    ]);

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
      ...affectedScopeTemplateVars({ assets: affectedAssets, services: affectedServices }),
      ...extraVars
    };

    const titles = {
      maintenance_scheduled: `Maintenance Scheduled: ${maint.title}`,
      maintenance_reminder: `Reminder: ${maint.title} starts in ${extraVars.time_before || ''}`,
      maintenance_started: `Maintenance Started: ${maint.title}`,
      maintenance_completed: `Maintenance Completed: ${maint.title}`,
      maintenance_reopened: `Maintenance Reopened: ${maint.title}`,
      maintenance_cancelled: `Maintenance Cancelled: ${maint.title}`,
      maintenance_rejected: `Maintenance Rejected: ${maint.title}`,
    };

    // Dispatch all channels in parallel so in-app bell notifications are not blocked by email delivery.
    const tasks = [];
    if (emails.length > 0) {
      tasks.push(sendEmailNotification(eventType, emails, vars, 'maintenance', maintenanceId, {
        varsForRecipient: async (email) => affectedScopeTemplateVars(
          await getVisibleAffectedScope({ email }, affectedAssets, affectedServices)
        ),
      }));
    }
    if (userIds.length > 0) {
      tasks.push(Promise.all(userIds.map((uid) =>
        sendInApp(uid, eventType, titles[eventType] || maint.title, vars.description, 'maintenance', maintenanceId)
      )));
    }
    tasks.push(_dispatchWebhooks(eventType, { maintenance: maint, ...extraVars }));

    await Promise.allSettled(tasks);
  } catch (err) {
    logger.error(`[Notify] notifyMaintenance error: ${err.message}`);
  }
}

// ─── Notify incident event ────────────────────────────────────────────────────
async function notifyIncident(incidentId, eventType) {
  try {
    const incident = await getOne(`SELECT * FROM incidents WHERE id=$1`, [incidentId]);
    if (!incident) return;

    const directAssets = await getMany(`SELECT asset_id FROM incident_assets WHERE incident_id=$1`, [incidentId]);
    const directServices = await getMany(`SELECT service_id FROM incident_services WHERE incident_id=$1`, [incidentId]);
    const [affectedAssets, affectedServices] = await Promise.all([
      getAffectedAssets(directAssets.map((asset) => asset.asset_id), directServices.map((service) => service.service_id)),
      getAffectedServices(directAssets.map((asset) => asset.asset_id), directServices.map((service) => service.service_id)),
    ]);
    const assetIds = affectedAssets.map((asset) => asset.id);
    const serviceIds = affectedServices.map((service) => service.service_id);

    let emails = new Set();
    let userIds = new Set();

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

        const targetServiceOwners = await getMany(
          `SELECT DISTINCT u.id AS user_id, u.email AS user_email
           FROM services s
           JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
           JOIN users u ON (
             (ot->>'type'='user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id=(ot->>'id')::uuid)
             OR (
               ot->>'type'='local_group'
               AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
               AND EXISTS (
                 SELECT 1 FROM user_group_members ugm
                 WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=u.id
               )
             )
           )
           WHERE s.id = ANY($1::uuid[]) AND u.is_active=true`,
          [serviceIds]
        ).catch(() => []);
        targetServiceOwners.forEach(o => {
          if (o.user_email) emails.add(o.user_email);
          if (o.user_id) userIds.add(o.user_id);
        });
    }

    if (assetIds.length > 0 || serviceIds.length > 0) {
      const targetAssetOwners = await getMany(
        `SELECT DISTINCT u.id AS user_id, u.email AS user_email
         FROM assets a
         JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
         JOIN users u ON (
           (ot->>'type'='user' AND (ot->>'id') ~* '^[0-9a-f-]{36}$' AND u.id=(ot->>'id')::uuid)
           OR (
             ot->>'type'='local_group'
             AND (ot->>'id') ~* '^[0-9a-f-]{36}$'
             AND EXISTS (
               SELECT 1 FROM user_group_members ugm
               WHERE ugm.group_id=(ot->>'id')::uuid AND ugm.user_id=u.id
             )
           )
         )
         WHERE a.id = ANY($1::uuid[]) AND u.is_active=true`,
        [assetIds]
      ).catch(() => []);
      targetAssetOwners.forEach(o => {
        if (o.user_email) emails.add(o.user_email);
        if (o.user_id) userIds.add(o.user_id);
      });

      const targetLdapAssetUsers = await getMany(
        `WITH scope_targets AS (
           SELECT ot
           FROM assets a
           JOIN LATERAL jsonb_array_elements(COALESCE(a.user_targets, '[]'::jsonb)) ot ON true
           WHERE a.id = ANY($1::uuid[])
           UNION ALL
           SELECT ot
           FROM services s
           JOIN LATERAL jsonb_array_elements(COALESCE(s.user_targets, '[]'::jsonb)) ot ON true
           WHERE s.id = ANY($2::uuid[])
         )
         SELECT DISTINCT lc.email AS user_email
         FROM scope_targets target
         JOIN ldap_users_cache lc ON (
           target.ot->>'type' = 'ldap_user'
           AND (
             LOWER(COALESCE(lc.dn, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
             OR LOWER(COALESCE(lc.username, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
             OR LOWER(COALESCE(lc.upn, '')) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
           )
         )
         WHERE lc.email IS NOT NULL
         UNION
         SELECT DISTINCT NULLIF(BTRIM(target.ot->>'email'), '') AS user_email
         FROM scope_targets target
         WHERE target.ot->>'type' = 'ldap_user'
           AND NULLIF(BTRIM(target.ot->>'email'), '') IS NOT NULL
         UNION
         SELECT DISTINCT lc.email AS user_email
         FROM scope_targets target
         JOIN ldap_users_cache lc ON target.ot->>'type' = 'ldap_group'
         WHERE lc.email IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) member(dn)
             WHERE LOWER(member.dn) = LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), ''))
                OR SPLIT_PART(LOWER(member.dn), ',', 1) = SPLIT_PART(LOWER(NULLIF(BTRIM(COALESCE(target.ot->>'dn', target.ot->>'id', '')), '')), ',', 1)
           )
         UNION
         SELECT DISTINCT lc.email AS user_email
         FROM scope_targets target
         JOIN ldap_group_mappings lgm ON (
           target.ot->>'type' = 'local_group'
           AND (target.ot->>'id') ~* '^[0-9a-f-]{36}$'
           AND lgm.local_group_id=(target.ot->>'id')::uuid
         )
         JOIN ldap_users_cache lc ON EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(lc.source_payload->'memberOf', lc.source_payload->'memberof', '[]'::jsonb)) member(dn)
           WHERE LOWER(member.dn) = LOWER(lgm.ldap_group_dn)
              OR SPLIT_PART(LOWER(member.dn), ',', 1) = SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
         )
         WHERE lc.email IS NOT NULL`,
        [assetIds, serviceIds]
      ).catch(() => []);
      targetLdapAssetUsers.forEach((user) => {
        if (user.user_email) emails.add(user.user_email);
      });
    }

    const vars = {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      description: incident.description || '-',
      started_at: new Date(incident.started_at).toLocaleString('it-IT'),
      resolved_at: incident.resolved_at ? new Date(incident.resolved_at).toLocaleString('it-IT') : '-',
      ...affectedScopeTemplateVars({ assets: affectedAssets, services: affectedServices }),
    };

    const tasks = [];
    if (emails.size > 0) {
      tasks.push(sendEmailNotification(eventType, [...emails], vars, 'incident', incidentId, {
        varsForRecipient: async (email) => affectedScopeTemplateVars(
          await getVisibleAffectedScope({ email }, affectedAssets, affectedServices)
        ),
      }));
    }
    if (userIds.size > 0) {
      tasks.push(Promise.all([...userIds].map((uid) =>
        sendInApp(uid, eventType, `Incidente: ${incident.title}`, incident.description, 'incident', incidentId)
      )));
    }
    tasks.push(_dispatchWebhooks(eventType, { incident }));

    await Promise.allSettled(tasks);
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
