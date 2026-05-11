const http  = require('http');
const https = require('https');
const net   = require('net');
const { query, getMany } = require('../db/database');
const logger = require('../utils/logger');
const wsService = require('./wsService');

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
              MAX(pr.probed_at) as last_probed
       FROM assets a
       LEFT JOIN probe_results pr ON pr.asset_id = a.id
       WHERE a.probe_enabled = true AND a.is_active = true
       GROUP BY a.id`,
    );

    for (const asset of assets) {
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
  let success = false, statusCode = null, errorMsg = null;

  try {
    if (asset.probe_type === 'http' || asset.probe_type === 'https') {
      const result = await _httpProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      statusCode = result.statusCode;
      success = statusCode === (asset.expected_status_code || 200);
      if (!success) errorMsg = `HTTP ${statusCode}`;
    } else if (asset.probe_type === 'tcp') {
      success = await _tcpProbe(asset.probe_url, asset.probe_timeout_seconds * 1000);
      if (!success) errorMsg = 'TCP connection failed';
    } else {
      return; // Unknown probe type
    }
  } catch (err) {
    success = false;
    errorMsg = err.message.slice(0, 255);
  }

  const responseTime = Date.now() - start;

  await query(
    `INSERT INTO probe_results (asset_id, success, response_time_ms, status_code, error_message)
     VALUES ($1, $2, $3, $4, $5)`,
    [asset.id, success, responseTime, statusCode, errorMsg]
  );

  // Update asset status based on probe result
  const newStatus = success ? 'operational' : 'major_outage';
  if (asset.status !== newStatus && asset.status !== 'under_maintenance') {
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

// ─── Manual probe trigger ─────────────────────────────────────────────────────
async function probeNow(assetId) {
  const { getOne } = require('../db/database');
  const asset = await getOne(
    `SELECT id, probe_type, probe_url, probe_timeout_seconds, expected_status_code, probe_interval_seconds, status
     FROM assets WHERE id=$1 AND probe_enabled=true`,
    [assetId]
  );
  if (!asset) throw new Error('Asset non trovato o probe non abilitato');
  const start = Date.now();
  let success = false, statusCode = null, errorMsg = null;

  try {
    if (asset.probe_type === 'http' || asset.probe_type === 'https') {
      const r = await _httpProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      statusCode = r.statusCode;
      success = statusCode === (asset.expected_status_code || 200);
      if (!success) errorMsg = `HTTP ${statusCode}`;
    } else if (asset.probe_type === 'tcp') {
      success = await _tcpProbe(asset.probe_url, (asset.probe_timeout_seconds || 10) * 1000);
      if (!success) errorMsg = 'TCP connection failed';
    }
  } catch (err) {
    success = false; errorMsg = err.message.slice(0, 255);
  }

  const responseTime = Date.now() - start;
  await query(
    `INSERT INTO probe_results (asset_id, success, response_time_ms, status_code, error_message)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [assetId, success, responseTime, statusCode, errorMsg]
  );
  return { success, responseTime, statusCode, errorMsg };
}

module.exports = { start, stop, probeNow };
