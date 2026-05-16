const http          = require('http');
const https         = require('https');
const net           = require('net');
const tls           = require('tls');
const dns           = require('dns');
const { exec }      = require('child_process');
const { query, getMany } = require('../db/database');
const logger        = require('../utils/logger');
const wsService     = require('./wsService');

const TICK_SECONDS = parseInt(process.env.PROBE_TICK_SECONDS || '60', 10);
let _interval = null;

function start() {
  if (_interval) return;
  _interval = setInterval(_runProbes, TICK_SECONDS * 1000);
  logger.info(`[ProbeService] Started (tick every ${TICK_SECONDS}s)`);
  // Run once on start
  setTimeout(_runProbes, 5000);
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

async function _runProbes() {
  try {
    const now = Math.floor(Date.now() / 1000);
    // Only probe assets where enough time has passed since last probe
    const assets = await getMany(
      `SELECT a.id, a.probe_type, a.probe_url, a.probe_timeout_seconds,
              a.expected_status_code, a.probe_interval_seconds, a.status,
              a.failure_threshold, a.recovery_threshold, a.pause_during_maintenance,
              a.dns_record_type, a.dns_expected_value, a.ssl_expiry_warning_days,
              MAX(pr.probed_at) as last_probed
       FROM assets a
       LEFT JOIN probe_results pr ON pr.asset_id = a.id
       WHERE a.probe_enabled = true AND a.is_active = true
       GROUP BY a.id`,
    );

    for (const asset of assets) {
      // Skip if paused during maintenance
      if (asset.pause_during_maintenance && asset.status === 'under_maintenance') continue;

      const lastProbed = asset.last_probed ? new Date(asset.last_probed).getTime() / 1000 : 0;
      const interval = asset.probe_interval_seconds || 300;
      if (now - lastProbed < interval) continue;

      _probeAsset(asset).catch(err => {
        logger.error(`[ProbeService] Asset ${asset.id} probe error: ${err.message}`);
      });
    }
  } catch (err) {
    logger.error(`[ProbeService] _runProbes error: ${err.message}`);
  }
}

async function _probeAsset(asset) {
  const start = Date.now();
  let success = false, statusCode = null, errorMsg = null, sslCertExpiry = null, dnsResponse = null;

  try {
    if (asset.probe_type === 'http' || asset.probe_type === 'https') {
      const result = await _httpProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      statusCode = result.statusCode;
      success = statusCode === (asset.expected_status_code || 200);
      if (!success) errorMsg = `HTTP ${statusCode}`;

    } else if (asset.probe_type === 'tcp') {
      success = await _tcpProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      if (!success) errorMsg = 'TCP connection failed';

    } else if (asset.probe_type === 'icmp') {
      success = await _icmpProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      if (!success) errorMsg = 'Host unreachable';

    } else if (asset.probe_type === 'dns') {
      const r = await _dnsProbe(
        asset.probe_url,
        asset.dns_record_type || 'A',
        asset.dns_expected_value || null,
        asset.probe_timeout_seconds * 1000
      );
      success = r.success;
      dnsResponse = r.response;
      if (!success) errorMsg = r.error;

    } else if (asset.probe_type === 'tls') {
      const r = await _tlsProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      sslCertExpiry = r.expiryDate || null;
      if (!r.connected) {
        success = false; errorMsg = r.error || 'TLS connection failed';
      } else if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= 0) {
        success = false; errorMsg = 'Certificate expired';
      } else {
        success = true;
        if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= (asset.ssl_expiry_warning_days || 30)) {
          errorMsg = `Certificate expires in ${r.daysUntilExpiry} day(s)`;
        }
      }
    } else {
      return;
    }
  } catch (err) {
    success = false;
    errorMsg = err.message.slice(0, 255);
  }

  const responseTime = Date.now() - start;

  await query(
    `INSERT INTO probe_results (asset_id, success, response_time_ms, status_code, error_message, ssl_cert_expiry, dns_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [asset.id, success, responseTime, statusCode, errorMsg, sslCertExpiry, dnsResponse]
  );

  // Determine new status using consecutive-streak thresholds
  const failThresh   = Math.max(1, asset.failure_threshold  || 2);
  const recoverThresh = Math.max(1, asset.recovery_threshold || 2);
  const lookback = Math.max(failThresh, recoverThresh);
  const recent = await getMany(
    `SELECT success FROM probe_results WHERE asset_id=$1 ORDER BY probed_at DESC LIMIT $2`,
    [asset.id, lookback]
  );

  let newStatus = asset.status;
  if (recent.length >= failThresh && recent.slice(0, failThresh).every(r => !r.success)) {
    newStatus = 'major_outage';
  } else if (recent.length >= recoverThresh && recent.slice(0, recoverThresh).every(r => r.success)) {
    newStatus = 'operational';
  }

  // Update asset status based on probe result
  if (newStatus !== asset.status && asset.status !== 'under_maintenance') {
    await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, asset.id]);
    await query(
      `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
       VALUES ('asset', $1, $2, 'probe', $3)`,
      [asset.id, newStatus, errorMsg || 'Probe success']
    );
    wsService.broadcast({ type: 'asset_status_changed', assetId: asset.id, status: newStatus });
    logger.info(`[ProbeService] Asset ${asset.id}: ${asset.status} → ${newStatus}`);
  }
}

function _httpProbe(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // consume response
      resolve({ statusCode: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.on('error', reject);
  });
}

function _tcpProbe(hostPort, timeoutMs) {
  return new Promise((resolve) => {
    const [host, portStr] = hostPort.split(':');
    const port = parseInt(portStr || '80', 10);
    const socket = new net.Socket();
    let resolved = false;
    const done = (ok) => { if (!resolved) { resolved = true; socket.destroy(); resolve(ok); } };
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => done(true));
    socket.on('error', () => done(false));
    socket.on('timeout', () => done(false));
  });
}

function _icmpProbe(host, timeoutMs) {
  return new Promise((resolve) => {
    const timeoutSecs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const cmd = process.platform === 'linux'
      ? `ping -c 1 -W ${timeoutSecs} ${host}`
      : `ping -c 1 -t ${timeoutSecs} ${host}`;
    exec(cmd, { timeout: timeoutMs + 2000 }, (err) => resolve(!err));
  });
}

async function _dnsProbe(hostname, recordType, expectedValue, timeoutMs) {
  const resolver = new dns.promises.Resolver();
  try {
    const records = await Promise.race([
      resolver.resolve(hostname, recordType || 'A'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), timeoutMs)),
    ]);
    const response = Array.isArray(records)
      ? records.map(r => (typeof r === 'object' ? JSON.stringify(r) : String(r))).join(', ')
      : String(records);
    if (expectedValue && !records.some(r => String(r).includes(expectedValue))) {
      return { success: false, response, error: `Expected "${expectedValue}" not found in: ${response}` };
    }
    return { success: true, response };
  } catch (err) {
    return { success: false, response: null, error: err.message.slice(0, 255) };
  }
}

function _tlsProbe(hostPort, timeoutMs) {
  return new Promise((resolve) => {
    const colonIdx = hostPort.lastIndexOf(':');
    const host = colonIdx > 0 ? hostPort.slice(0, colonIdx) : hostPort;
    const port = colonIdx > 0 ? (parseInt(hostPort.slice(colonIdx + 1)) || 443) : 443;
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; try { socket.destroy(); } catch {} resolve(result); } };
    const socket = tls.connect({ host, port, timeout: timeoutMs, rejectUnauthorized: false });
    socket.on('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) { done({ connected: true, expiryDate: null, daysUntilExpiry: null }); return; }
        const expiryDate = new Date(cert.valid_to);
        const daysUntilExpiry = Math.floor((expiryDate.getTime() - Date.now()) / 86400000);
        done({ connected: true, expiryDate, daysUntilExpiry });
      } catch { done({ connected: true, expiryDate: null, daysUntilExpiry: null }); }
    });
    socket.on('timeout', () => done({ connected: false, error: 'TLS timeout' }));
    socket.on('error', (err) => done({ connected: false, error: err.message.slice(0, 255) }));
    setTimeout(() => done({ connected: false, error: 'TLS timeout' }), timeoutMs + 1000);
  });
}

// ─── Manual probe trigger ─────────────────────────────────────────────────────
async function probeNow(assetId) {
  const { getOne } = require('../db/database');
  const asset = await getOne(
    `SELECT id, probe_type, probe_url, probe_timeout_seconds, expected_status_code,
            probe_interval_seconds, status, failure_threshold, recovery_threshold,
            pause_during_maintenance, dns_record_type, dns_expected_value, ssl_expiry_warning_days
     FROM assets WHERE id=$1 AND probe_enabled=true`,
    [assetId]
  );
  if (!asset) throw new Error('Asset non trovato o probe non abilitato');
  const start = Date.now();
  let success = false, statusCode = null, errorMsg = null, sslCertExpiry = null, dnsResponse = null;

  try {
    if (asset.probe_type === 'http' || asset.probe_type === 'https') {
      const r = await _httpProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      statusCode = r.statusCode;
      success = statusCode === (asset.expected_status_code || 200);
      if (!success) errorMsg = `HTTP ${statusCode}`;
    } else if (asset.probe_type === 'tcp') {
      success = await _tcpProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      if (!success) errorMsg = 'TCP connection failed';
    } else if (asset.probe_type === 'icmp') {
      success = await _icmpProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      if (!success) errorMsg = 'Host unreachable';
    } else if (asset.probe_type === 'dns') {
      const r = await _dnsProbe(
        asset.probe_url, asset.dns_record_type || 'A',
        asset.dns_expected_value || null, (asset.probe_timeout_seconds || 10) * 1000
      );
      success = r.success; dnsResponse = r.response;
      if (!success) errorMsg = r.error;
    } else if (asset.probe_type === 'tls') {
      const r = await _tlsProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      sslCertExpiry = r.expiryDate || null;
      if (!r.connected) { success = false; errorMsg = r.error || 'TLS connection failed'; }
      else if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= 0) { success = false; errorMsg = 'Certificate expired'; }
      else {
        success = true;
        if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= (asset.ssl_expiry_warning_days || 30)) {
          errorMsg = `Certificate expires in ${r.daysUntilExpiry} day(s)`;
        }
      }
    }
  } catch (err) {
    success = false; errorMsg = err.message.slice(0, 255);
  }

  const responseTime = Date.now() - start;
  await query(
    `INSERT INTO probe_results (asset_id, success, response_time_ms, status_code, error_message, ssl_cert_expiry, dns_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [assetId, success, responseTime, statusCode, errorMsg, sslCertExpiry, dnsResponse]
  );

  // Apply threshold logic for status update
  const failThresh    = Math.max(1, asset.failure_threshold  || 2);
  const recoverThresh = Math.max(1, asset.recovery_threshold || 2);
  const lookback = Math.max(failThresh, recoverThresh);
  const recent = await getMany(
    `SELECT success FROM probe_results WHERE asset_id=$1 ORDER BY probed_at DESC LIMIT $2`,
    [assetId, lookback]
  );
  let newStatus = asset.status;
  if (recent.length >= failThresh && recent.slice(0, failThresh).every(r => !r.success)) {
    newStatus = 'major_outage';
  } else if (recent.length >= recoverThresh && recent.slice(0, recoverThresh).every(r => r.success)) {
    newStatus = 'operational';
  }
  if (newStatus !== asset.status && asset.status !== 'under_maintenance') {
    await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, assetId]);
    await query(
      `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
       VALUES ('asset', $1, $2, 'probe', $3)`,
      [assetId, newStatus, errorMsg || 'Probe success']
    );
    wsService.broadcast({ type: 'asset_status_changed', assetId, status: newStatus });
  }

  return { success, responseTime, statusCode, errorMsg, sslCertExpiry, dnsResponse };
}

module.exports = { start, stop, probeNow };
