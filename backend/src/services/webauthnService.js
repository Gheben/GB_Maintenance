const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { query, getOne, getMany } = require('../db/database');

const RP_NAME = 'GB Maintenance';

// In-memory challenge store (single-process deployment). Entries expire after 5 minutes.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challengeStore = new Map();

function setChallenge(key, challenge) {
  for (const [k, v] of challengeStore) if (v.expires < Date.now()) challengeStore.delete(k);
  challengeStore.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
}
function popChallenge(key) {
  const entry = challengeStore.get(key);
  challengeStore.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

// Extracts the challenge embedded in an assertion/attestation response without
// needing a username or session to look it up server-side first.
function decodeChallenge(response) {
  try {
    const clientDataJSON = response?.response?.clientDataJSON;
    const decoded = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    return decoded.challenge || null;
  } catch {
    return null;
  }
}

function getRpConfig(req) {
  const appUrl = (process.env.APP_URL || `${req?.protocol || 'http'}://${req?.get?.('host') || 'localhost:4681'}`).replace(/\/+$/, '');
  const rpID = new URL(appUrl).hostname;
  return { rpID, origin: appUrl };
}

function toCredentialRow(row) {
  return {
    id: row.credential_id,
    publicKey: Buffer.from(row.public_key, 'base64url'),
    counter: Number(row.counter),
    transports: Array.isArray(row.transports) ? row.transports : [],
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────
async function generateRegistrationOpts(req, user) {
  const { rpID } = getRpConfig(req);
  const existing = await getMany('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id=$1', [user.id]);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.username,
    userDisplayName: user.display_name || user.username,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({
      id: c.credential_id,
      transports: Array.isArray(c.transports) ? c.transports : [],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  setChallenge(`reg:${user.id}`, options.challenge);
  return options;
}

async function verifyRegistration(req, user, response, credentialName) {
  const { rpID, origin } = getRpConfig(req);
  const expectedChallenge = popChallenge(`reg:${user.id}`);
  if (!expectedChallenge) throw new Error('Registrazione scaduta, riprova');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Verifica della chiave di sicurezza fallita');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  await query(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_type, backed_up, transports, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp,
      JSON.stringify(credential.transports || []),
      credentialName || null,
    ]
  );

  return true;
}

// ─── Authentication (passwordless login, usernameless/discoverable credential) ─
async function generateAuthenticationOpts(req) {
  const { rpID } = getRpConfig(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  setChallenge(options.challenge, options.challenge);
  return options;
}

async function verifyAuthentication(req, response) {
  const { rpID, origin } = getRpConfig(req);
  const challenge = decodeChallenge(response);
  const expectedChallenge = challenge && popChallenge(challenge);
  if (!expectedChallenge) throw new Error('Richiesta di accesso scaduta, riprova');

  const credRow = await getOne('SELECT * FROM webauthn_credentials WHERE credential_id=$1', [response.id]);
  if (!credRow) throw new Error('Passkey non riconosciuta');

  const user = await getOne(`SELECT * FROM users WHERE id=$1 AND is_active=true`, [credRow.user_id]);
  if (!user) throw new Error('Utente non trovato o disabilitato');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: toCredentialRow(credRow),
  });

  if (!verification.verified) throw new Error('Verifica della passkey fallita');

  await query(
    `UPDATE webauthn_credentials SET counter=$1, last_used_at=NOW() WHERE id=$2`,
    [verification.authenticationInfo.newCounter, credRow.id]
  );
  await query(`UPDATE users SET last_login_at=NOW(), failed_login_count=0 WHERE id=$1`, [user.id]);

  return user;
}

// ─── Credential management ────────────────────────────────────────────────────
async function listCredentials(userId) {
  return getMany(
    `SELECT id, name, device_type, backed_up, transports, created_at, last_used_at
     FROM webauthn_credentials WHERE user_id=$1 ORDER BY created_at DESC`,
    [userId]
  );
}

async function deleteCredential(userId, credentialId) {
  await query('DELETE FROM webauthn_credentials WHERE id=$1 AND user_id=$2', [credentialId, userId]);
}

module.exports = {
  generateRegistrationOpts,
  verifyRegistration,
  generateAuthenticationOpts,
  verifyAuthentication,
  listCredentials,
  deleteCredential,
};
