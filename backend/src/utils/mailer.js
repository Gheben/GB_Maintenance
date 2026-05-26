const nodemailer = require('nodemailer');
const logger = require('./logger');
const { query, getOne } = require('../db/database');
const { decrypt, isEncrypted } = require('./encryption');

let _transporter = null;

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
    ignoreTLS: cfg.ignoreTls === true || cfg.ignoreTls === 'true',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: false }
  });

  return _transporter;
}

async function sendMail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn('[Mailer] SMTP not configured, skipping email');
    return null;
  }

  const cfg = await getSmtpConfig();
  const from = cfg.from || `GB Maintenance <${cfg.user}>`;
  const finalHtml = typeof html === 'string' && html.trim() ? html : undefined;
  const finalText = typeof text === 'string' && text.trim()
    ? text
    : (finalHtml ? htmlToPlainText(finalHtml) : undefined);

  try {
    const info = await transporter.sendMail({ from, to, subject, html: finalHtml, text: finalText });
    logger.info(`[Mailer] Email sent to ${to}: ${info.messageId}`);
    return {
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      response: info.response || ''
    };
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
    ignoreTLS: cfg.ignoreTls === true || cfg.ignoreTls === 'true',
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
