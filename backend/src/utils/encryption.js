const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:v1:';

function _getKey() {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'insecure-fallback-key-change-me!';
  // Derive a 32-byte key via SHA-256
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return '';
  const key = _getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext || !isEncrypted(ciphertext)) return ciphertext || '';
  try {
    const key = _getKey();
    const data = Buffer.from(ciphertext.slice(ENCRYPTED_PREFIX.length), 'base64');
    const iv  = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const enc = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
