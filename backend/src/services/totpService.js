const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { query, getOne } = require('../db/database');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

const APP_NAME = 'GB Maintenance';

// ─── Generate TOTP secret ─────────────────────────────────────────────────────
async function setupTotp(userId) {
  const secret = authenticator.generateSecret(20);
  const user = await getOne('SELECT username FROM users WHERE id=$1', [userId]);
  if (!user) throw new Error('User not found');

  const otpauth = authenticator.keyuri(user.username, APP_NAME, secret);
  const qrDataUrl = await qrcode.toDataURL(otpauth);

  // Store encrypted secret (not yet verified)
  const encSecret = encrypt(secret);
  await query(
    `UPDATE users SET totp_secret=$1, totp_enabled=false, totp_verified=false WHERE id=$2`,
    [encSecret, userId]
  );

  return { secret, qrDataUrl, otpauth };
}

// ─── Verify and activate TOTP ─────────────────────────────────────────────────
async function verifyAndActivateTotp(userId, token) {
  const user = await getOne('SELECT totp_secret FROM users WHERE id=$1', [userId]);
  if (!user?.totp_secret) throw new Error('TOTP not configured');

  const secret = isEncrypted(user.totp_secret) ? decrypt(user.totp_secret) : user.totp_secret;
  const valid = authenticator.verify({ token, secret });
  if (!valid) return false;

  await query(
    `UPDATE users SET totp_enabled=true, totp_verified=true WHERE id=$1`,
    [userId]
  );
  return true;
}

// ─── Validate TOTP token ──────────────────────────────────────────────────────
async function validateTotp(userId, token) {
  const user = await getOne('SELECT totp_secret, totp_enabled FROM users WHERE id=$1', [userId]);
  if (!user?.totp_enabled || !user.totp_secret) return true; // not enabled, skip

  const secret = isEncrypted(user.totp_secret) ? decrypt(user.totp_secret) : user.totp_secret;
  return authenticator.verify({ token, secret });
}

// ─── Disable TOTP ────────────────────────────────────────────────────────────
async function disableTotp(userId) {
  await query(
    `UPDATE users SET totp_secret=NULL, totp_enabled=false, totp_verified=false WHERE id=$1`,
    [userId]
  );
}

module.exports = { setupTotp, verifyAndActivateTotp, validateTotp, disableTotp };
