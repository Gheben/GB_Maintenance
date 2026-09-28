const http          = require('http');
const https         = require('https');
const net           = require('net');
const tls           = require('tls');
const dns           = require('dns');
const { exec }      = require('child_process');
const { query, getMany, getOne } = require('../db/database');
const logger        = require('../utils/logger');
const wsService     = require('./wsService');

const TICK_SECONDS = parseInt(process.env.PROBE_TICK_SECONDS || '60', 10);
const PROBE_BATCH_SIZE = parseInt(process.env.PROBE_BATCH_SIZE || '500', 10);
const PROBE_MAX_PARALLEL = parseInt(process.env.PROBE_MAX_PARALLEL || '30', 10);
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
    const probes = await getMany(
      `SELECT ap.id, ap.asset_id, ap.name,
              ap.probe_type, ap.probe_target, ap.probe_timeout_seconds,
              ap.expected_status_code, ap.probe_interval_seconds,
              ap.failure_threshold, ap.recovery_threshold,
              ap.pause_during_maintenance,
              ap.dns_record_type, ap.dns_expected_value, ap.ssl_expiry_warning_days,
              ap.consecutive_failures, ap.consecutive_successes, ap.current_state,
              a.status AS asset_status
       FROM asset_probes ap
       JOIN assets a ON a.id = ap.asset_id
       WHERE ap.probe_enabled = true
         AND a.is_active = true
         AND ap.next_probe_at <= NOW()
       ORDER BY ap.next_probe_at ASC
       LIMIT $1`,
      [PROBE_BATCH_SIZE]
    );

    // Surface backlog in logs: if this tick's batch was already full, more probes were
    // due than PROBE_BATCH_SIZE could cover, meaning monitoring is falling behind schedule.
    if (probes.length >= PROBE_BATCH_SIZE) {
      const dueRow = await getOne(
        `SELECT COUNT(*)::int AS c FROM asset_probes ap
         JOIN assets a ON a.id = ap.asset_id
         WHERE ap.probe_enabled = true AND a.is_active = true AND ap.next_probe_at <= NOW()`
      );
      const due = dueRow?.c || 0;
      if (due > PROBE_BATCH_SIZE) {
        logger.warn(`[ProbeService] Backlog detected: ${due} probes due but only ${PROBE_BATCH_SIZE} processed this tick. Consider raising PROBE_BATCH_SIZE/PROBE_MAX_PARALLEL.`);
      }
    }

    for (let i = 0; i < probes.length; i += PROBE_MAX_PARALLEL) {
      const batch = probes.slice(i, i + PROBE_MAX_PARALLEL);
      await Promise.allSettled(batch.map((probe) => _probeAsset(probe)));
    }
  } catch (err) {
    logger.error(`[ProbeService] _runProbes error: ${err.message}`);
  }
}

async function _probeAsset(probe, options = {}) {
  const forceRun = options.forceRun === true;
  // Skip and reschedule if paused while in maintenance.
  if (!forceRun && probe.pause_during_maintenance && probe.asset_status === 'under_maintenance') {
    await query(
      `UPDATE asset_probes
       SET next_probe_at = NOW() + ($1::int * INTERVAL '1 second'),
           updated_at = NOW()
       WHERE id = $2`,
      [probe.probe_interval_seconds || 300, probe.id]
    );
    return { skipped: true };
  }

  const start = Date.now();
  let success = false, statusCode = null, errorMsg = null, sslCertExpiry = null, dnsResponse = null;

  try {
    if (probe.probe_type === 'http' || probe.probe_type === 'https') {
      const result = await _httpProbe(probe.probe_target, (probe.probe_timeout_seconds || 10) * 1000);
      statusCode = result.statusCode;
      success = statusCode === (probe.expected_status_code || 200);
      if (!success) errorMsg = `HTTP ${statusCode}`;

    } else if (probe.probe_type === 'tcp') {
      success = await _tcpProbe(probe.probe_target, (probe.probe_timeout_seconds || 10) * 1000);
      if (!success) errorMsg = 'TCP connection failed';

    } else if (probe.probe_type === 'icmp') {
      success = await _icmpProbe(probe.probe_target, (probe.probe_timeout_seconds || 10) * 1000);
      if (!success) errorMsg = 'Host unreachable';

    } else if (probe.probe_type === 'dns') {
      const r = await _dnsProbe(
        probe.probe_target,
        probe.dns_record_type || 'A',
        probe.dns_expected_value || null,
        (probe.probe_timeout_seconds || 10) * 1000
      );
      success = r.success;
      dnsResponse = r.response;
      if (!success) errorMsg = r.error;

    } else if (probe.probe_type === 'tls') {
      const r = await _tlsProbe(probe.probe_target, (probe.probe_timeout_seconds || 10) * 1000);
      sslCertExpiry = r.expiryDate || null;
      if (!r.connected) {
        success = false; errorMsg = r.error || 'TLS connection failed';
      } else if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= 0) {
        success = false; errorMsg = 'Certificate expired';
      } else {
        success = true;
        if (r.daysUntilExpiry !== null && r.daysUntilExpiry <= (probe.ssl_expiry_warning_days || 30)) {
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
    `INSERT INTO probe_results (asset_id, probe_id, success, response_time_ms, status_code, error_message, ssl_cert_expiry, dns_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [probe.asset_id, probe.id, success, responseTime, statusCode, errorMsg, sslCertExpiry, dnsResponse]
  );

  const failThresh = Math.max(1, probe.failure_threshold || 2);
  const recoverThresh = Math.max(1, probe.recovery_threshold || 2);
  const consecutiveFailures = success ? 0 : (probe.consecutive_failures || 0) + 1;
  const consecutiveSuccesses = success ? (probe.consecutive_successes || 0) + 1 : 0;
  let currentState = probe.current_state || 'unknown';
  if (consecutiveFailures >= failThresh) currentState = 'major_outage';
  else if (consecutiveSuccesses >= recoverThresh) currentState = 'operational';

  await query(
    `UPDATE asset_probes
     SET last_probed_at = NOW(),
         next_probe_at = NOW() + ($1::int * INTERVAL '1 second'),
         consecutive_failures = $2,
         consecutive_successes = $3,
         current_state = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [probe.probe_interval_seconds || 300, consecutiveFailures, consecutiveSuccesses, currentState, probe.id]
  );

  await _refreshAssetStatus(probe.asset_id, errorMsg || 'Probe update');

  return {
    probeId: probe.id,
    assetId: probe.asset_id,
    success,
    responseTime,
    statusCode,
    errorMsg,
    sslCertExpiry,
    dnsResponse,
  };
}

async function _refreshAssetStatus(assetId, reason) {
  const [asset, agg] = await Promise.all([
    getOne(`SELECT status FROM assets WHERE id=$1`, [assetId]),
    getOne(
      `SELECT COUNT(*) FILTER (WHERE probe_enabled = true AND current_state = 'major_outage')::int AS failing_count
       FROM asset_probes
       WHERE asset_id = $1`,
      [assetId]
    )
  ]);

  if (!asset) return;
  const newStatus = (agg?.failing_count || 0) > 0 ? 'major_outage' : 'operational';
  if (newStatus !== asset.status && asset.status !== 'under_maintenance') {
    await query(`UPDATE assets SET status=$1, updated_at=NOW() WHERE id=$2`, [newStatus, assetId]);
    await query(
      `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
       VALUES ('asset', $1, $2, 'probe', $3)`,
      [assetId, newStatus, reason]
    );
    wsService.broadcast({ type: 'asset_status_changed', assetId, status: newStatus });
    logger.info(`[ProbeService] Asset ${assetId}: ${asset.status} -> ${newStatus}`);
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
  const probes = await getMany(
    `SELECT ap.id, ap.asset_id, ap.name,
            ap.probe_type, ap.probe_target, ap.probe_timeout_seconds,
            ap.expected_status_code, ap.probe_interval_seconds,
            ap.failure_threshold, ap.recovery_threshold,
            ap.pause_during_maintenance,
            ap.dns_record_type, ap.dns_expected_value, ap.ssl_expiry_warning_days,
            ap.consecutive_failures, ap.consecutive_successes, ap.current_state,
            a.status AS asset_status
     FROM asset_probes ap
     JOIN assets a ON a.id = ap.asset_id
     WHERE ap.asset_id = $1
       AND ap.probe_enabled = true
       AND a.is_active = true`,
    [assetId]
  );
  if (probes.length === 0) throw new Error('Asset not found or no probe enabled');

  const results = [];
  for (const probe of probes) {
    results.push(await _probeAsset(probe, { forceRun: true }));
  }

  if (results.length === 1) {
    return results[0];
  }

  return {
    assetId,
    probeCount: results.length,
    success: results.every((r) => !!r.success),
    results,
  };
}

async function probeNowById(assetId, probeId) {
  const probe = await getOne(
    `SELECT ap.id, ap.asset_id, ap.name,
            ap.probe_type, ap.probe_target, ap.probe_timeout_seconds,
            ap.expected_status_code, ap.probe_interval_seconds,
            ap.failure_threshold, ap.recovery_threshold,
            ap.pause_during_maintenance,
            ap.dns_record_type, ap.dns_expected_value, ap.ssl_expiry_warning_days,
            ap.consecutive_failures, ap.consecutive_successes, ap.current_state,
            a.status AS asset_status
     FROM asset_probes ap
     JOIN assets a ON a.id = ap.asset_id
     WHERE ap.id = $1
       AND ap.asset_id = $2
       AND ap.probe_enabled = true
       AND a.is_active = true`,
    [probeId, assetId]
  );
  if (!probe) throw new Error('Probe not found or not enabled');

  return await _probeAsset(probe, { forceRun: true });
}

async function probeNowService(serviceId) {
  const probes = await getMany(
    `SELECT sp.id, sp.service_id, sp.name,
            sp.probe_type, sp.probe_target, sp.probe_timeout_seconds,
            sp.expected_status_code, sp.probe_interval_seconds,
            sp.failure_threshold, sp.recovery_threshold,
            sp.pause_during_maintenance,
            sp.dns_record_type, sp.dns_expected_value, sp.ssl_expiry_warning_days,
            sp.consecutive_failures, sp.consecutive_successes, sp.current_state,
            s.status AS service_status
     FROM service_probes sp
     JOIN services s ON s.id = sp.service_id
     WHERE sp.service_id = $1
       AND sp.probe_enabled = true
       AND s.is_active = true`,
    [serviceId]
  );
  if (probes.length === 0) throw new Error('Service not found or no probe enabled');

  const results = [];
  for (const probe of probes) {
    results.push(await _probeService(probe, { forceRun: true }));
  }

  if (results.length === 1) {
    return results[0];
  }

  return {
    serviceId,
    probeCount: results.length,
    success: results.every((r) => !!r.success),
    results,
  };
}

async function probeNowByIdService(serviceId, probeId) {
  const probe = await getOne(
    `SELECT sp.id, sp.service_id, sp.name,
            sp.probe_type, sp.probe_target, sp.probe_timeout_seconds,
            sp.expected_status_code, sp.probe_interval_seconds,
            sp.failure_threshold, sp.recovery_threshold,
            sp.pause_during_maintenance,
            sp.dns_record_type, sp.dns_expected_value, sp.ssl_expiry_warning_days,
            sp.consecutive_failures, sp.consecutive_successes, sp.current_state,
            s.status AS service_status
     FROM service_probes sp
     JOIN services s ON s.id = sp.service_id
     WHERE sp.id = $1
       AND sp.service_id = $2
       AND sp.probe_enabled = true
       AND s.is_active = true`,
    [probeId, serviceId]
  );
  if (!probe) throw new Error('Probe not found or not enabled');

  return await _probeService(probe, { forceRun: true });
}

async function _probeService(probe, options = {}) {
  // Similar to _probeAsset but for services
  // Executes probe and saves result in service_probe_results table
  const startTime = Date.now();
  let success = false;
  let responseTime = null;
  let statusCode = null;
  let errorMessage = null;
  let sslCertExpiry = null;
  let dnsResponse = null;

  try {
    switch (probe.probe_type) {
      case 'http':
      case 'https':
        ({ success, responseTime, statusCode, errorMessage } = await _httpProbe(probe));
        break;
      case 'tcp':
        ({ success, responseTime, errorMessage } = await _tcpProbe(probe));
        break;
      case 'icmp':
        ({ success, responseTime, errorMessage } = await _icmpProbe(probe));
        break;
      case 'dns':
        ({ success, responseTime, errorMessage, dnsResponse } = await _dnsProbe(probe));
        break;
      case 'tls':
        ({ success, responseTime, errorMessage, sslCertExpiry } = await _tlsProbe(probe));
        break;
      default:
        throw new Error(`Probe type ${probe.probe_type} not supported`);
    }
  } catch (err) {
    success = false;
    errorMessage = err.message;
    responseTime = Date.now() - startTime;
  }

  // Update probe configuration state
  if (success) {
    await query(
      `UPDATE service_probes SET consecutive_successes = consecutive_successes + 1,
       consecutive_failures = 0, last_probed_at = NOW() WHERE id = $1`,
      [probe.id]
    );
    const rThreshold = probe.recovery_threshold || 2;
    const { consecutive_successes } = await getOne(
      `SELECT consecutive_successes FROM service_probes WHERE id = $1`,
      [probe.id]
    );
    if (consecutive_successes >= rThreshold) {
      await query(`UPDATE service_probes SET current_state = 'operational' WHERE id = $1`, [probe.id]);
    }
  } else {
    await query(
      `UPDATE service_probes SET consecutive_failures = consecutive_failures + 1,
       consecutive_successes = 0, last_probed_at = NOW() WHERE id = $1`,
      [probe.id]
    );
    const fThreshold = probe.failure_threshold || 2;
    const { consecutive_failures } = await getOne(
      `SELECT consecutive_failures FROM service_probes WHERE id = $1`,
      [probe.id]
    );
    if (consecutive_failures >= fThreshold) {
      await query(`UPDATE service_probes SET current_state = 'major_outage' WHERE id = $1`, [probe.id]);
    }
  }

  // Save probe result
  await query(
    `INSERT INTO service_probe_results (
      service_id, probe_id, success, response_time_ms, status_code,
      error_message, ssl_cert_expiry, dns_response
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      probe.service_id,
      probe.id,
      success,
      responseTime,
      statusCode,
      errorMessage || null,
      sslCertExpiry || null,
      dnsResponse || null,
    ]
  );

  // Broadcast update via WebSocket
  if (wsService && wsService.broadcast) {
    wsService.broadcast({
      type: 'probe_result',
      data: {
        serviceId: probe.service_id,
        probeId: probe.id,
        success,
        responseTime,
        statusCode,
        errorMessage,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return {
    probeId: probe.id,
    serviceId: probe.service_id,
    success,
    responseTime,
    statusCode,
    errorMessage,
    sslCertExpiry,
    dnsResponse,
  };
}

module.exports = { start, stop, probeNow, probeNowById, probeNowService, probeNowByIdService };
