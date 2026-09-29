const webpush = require('web-push');
const { query, getOne, getMany } = require('../db/database');
const logger = require('../utils/logger');

let _configured = false;

// VAPID keys are generated once and persisted in the settings table so they
// survive restarts (subscriptions created with one key pair stop working if it changes).
async function _ensureConfigured() {
  if (_configured) return;

  let row = await getOne("SELECT value FROM settings WHERE key='webpush_vapid_keys'");
  let keys;
  if (row) {
    keys = JSON.parse(row.value);
  } else {
    keys = webpush.generateVAPIDKeys();
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('webpush_vapid_keys', $1, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(keys)]
    );
  }

  const contactEmail = process.env.WEBPUSH_CONTACT_EMAIL || 'admin@example.com';
  webpush.setVapidDetails(`mailto:${contactEmail}`, keys.publicKey, keys.privateKey);
  _configured = true;
}

async function getPublicKey() {
  await _ensureConfigured();
  const row = await getOne("SELECT value FROM settings WHERE key='webpush_vapid_keys'");
  return JSON.parse(row.value).publicKey;
}

// Read the current branding so push notifications carry the actual configured app name/logo
// instead of the hardcoded defaults, matching the identity shown elsewhere in the app.
async function _getBranding() {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'").catch(() => null);
  if (!row) return { appName: 'GB Maintenance', icon: null };
  try {
    const general = JSON.parse(row.value || '{}');
    return {
      appName: String(general.app_name || '').trim() || 'GB Maintenance',
      icon: String(general.app_brand_image_url || '').trim() || null,
    };
  } catch {
    return { appName: 'GB Maintenance', icon: null };
  }
}

async function saveSubscription(userId, subscription) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('Invalid push subscription');
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4`,
    [userId, endpoint, keys.p256dh, keys.auth]
  );
}

async function removeSubscription(userId, endpoint) {
  await query(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, [userId, endpoint]);
}

async function sendToUser(userId, payload) {
  await _ensureConfigured();
  const subs = await getMany(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1`, [userId]);
  if (subs.length === 0) {
    logger.info(`[WebPush] No push subscription registered for user ${userId} — nothing to send`);
    return;
  }

  const branding = await _getBranding();
  const body = JSON.stringify({
    ...payload,
    title: payload.title || branding.appName,
    icon: payload.icon || branding.icon || undefined,
  });
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      await query(`UPDATE push_subscriptions SET last_used_at=NOW() WHERE id=$1`, [sub.id]);
    } catch (err) {
      // Subscription is no longer valid on the browser/OS side — stop trying to use it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id=$1`, [sub.id]).catch(() => {});
      } else {
        logger.warn(`[WebPush] Send failed for subscription ${sub.id}: ${err.message}`);
      }
    }
  }));
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, sendToUser };
