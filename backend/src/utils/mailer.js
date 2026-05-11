const nodemailer = require('nodemailer');
const logger = require('./logger');
const { query, getOne } = require('../db/database');
const { decrypt, isEncrypted } = require('./encryption');

let _transporter = null;

async function getSmtpConfig() {
  try {
    const row = await getOne("SELECT value FROM settings WHERE key = 'smtp_config'");
    if (!row) return null;
    const cfg = JSON.parse(row.value);
    if (cfg.pass && isEncrypted(cfg.pass)) cfg.pass = decrypt(cfg.pass);
    return cfg;
  } catch { return null; }
}

async function getTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg || !cfg.host) return null;

  _transporter = nodemailer.createTransport({
    host: cfg.host,
    port: parseInt(cfg.port || '587', 10),
    secure: cfg.secure === true || cfg.secure === 'true',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: false }
  });

  return _transporter;
}

async function sendMail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn('[Mailer] SMTP not configured, skipping email');
    return false;
  }

  const cfg = await getSmtpConfig();
  const from = cfg.from || `GB Maintenance <${cfg.user}>`;

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    logger.info(`[Mailer] Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (err) {
    logger.error(`[Mailer] Failed to send email to ${to}: ${err.message}`);
    throw err;
  }
}

async function testSmtp(cfg) {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: parseInt(cfg.port || '587', 10),
    secure: cfg.secure === true || cfg.secure === 'true',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: false }
  });
  await transporter.verify();
  return true;
}

/**
 * Interpolate template variables: {{key}} → value
 */
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

module.exports = { sendMail, testSmtp, renderTemplate, getSmtpConfig };
