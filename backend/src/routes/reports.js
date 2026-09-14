const { Router } = require('express');
const { requireAuth, requireAdmin, requireOperator } = require('../middleware/authMiddleware');
const { query, getMany, getOne } = require('../db/database');
const PDFDocument = require('pdfkit');
const { stringify } = require('csv-stringify/sync');
const XLSX = require('xlsx');

const router = Router();
router.use(requireAuth);

const DASHBOARD_CACHE_TTL_MS = 15000;
const dashboardCache = new Map();

function parsePositiveInt(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function getCachedDashboard(key) {
  const hit = dashboardCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    dashboardCache.delete(key);
    return null;
  }
  return hit.payload;
}

function setCachedDashboard(key, payload) {
  dashboardCache.set(key, {
    payload,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  });
}

function sendExcel(res, rows, filename, sheetName) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0] || {}).map(key => ({ wch: Math.min(40, Math.max(12, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(buffer);
}

function sendSimplePdf(res, title, rows, filename) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  doc.pipe(res);
  doc.fontSize(18).fillColor('#111827').text(title, { align: 'center' });
  doc.fontSize(10).text(`Generated on ${new Date().toLocaleString('en-GB')}`, { align: 'center' });
  doc.moveDown();
  for (const row of rows) {
    doc.fontSize(10).fillColor('#1e40af').text(String(row.Name || row.Title || '-'));
    doc.fontSize(8).fillColor('#374151').text(Object.entries(row).filter(([key]) => !['Name', 'Title'].includes(key)).map(([key, value]) => `${key}: ${value ?? '-'}`).join(' | '));
    doc.moveDown(0.4);
  }
  doc.end();
}

// ─── GET /api/reports/maintenance ────────────────────────────────────────────
router.get('/maintenance', async (req, res) => {
  const { from, to, asset_id, service_id, status, format = 'json' } = req.query;
  const params = []; let i = 1;
  const filters = [];

  if (from)       { filters.push(`mw.scheduled_start >= $${i++}`); params.push(from); }
  if (to)         { filters.push(`mw.scheduled_end <= $${i++}`); params.push(to); }
  if (status)     { filters.push(`mw.status=$${i++}`); params.push(status); }
  if (asset_id)   { filters.push(`mw.id IN (SELECT maintenance_id FROM maintenance_assets WHERE asset_id=$${i++})`); params.push(asset_id); }
  if (service_id) {
    filters.push(`mw.id IN (SELECT ma.maintenance_id FROM maintenance_assets ma JOIN service_assets sa ON sa.asset_id=ma.asset_id WHERE sa.service_id=$${i++})`);
    params.push(service_id);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await getMany(
    `SELECT mw.id, mw.title, mw.type, mw.status, mw.impact_level,
            mw.scheduled_start, mw.scheduled_end, mw.actual_start, mw.actual_end,
            u.display_name as created_by, mw.description, mw.notes,
            EXTRACT(EPOCH FROM (COALESCE(mw.actual_end, NOW()) - COALESCE(mw.actual_start, mw.scheduled_start)))/60 as duration_minutes
     FROM maintenance_windows mw LEFT JOIN users u ON u.id=mw.created_by
     ${where} ORDER BY mw.scheduled_start DESC`,
    params
  );

  if (format === 'xlsx') {
    return sendExcel(res, rows.map(row => ({
      ID: row.id,
      Title: row.title,
      Type: row.type,
      Status: row.status,
      Impact: row.impact_level,
      'Scheduled start': row.scheduled_start,
      'Scheduled end': row.scheduled_end,
      'Actual start': row.actual_start,
      'Actual end': row.actual_end,
      'Created by': row.created_by || '',
      Description: row.description || '',
      Notes: row.notes || '',
      'Duration (minutes)': Math.round(row.duration_minutes || 0),
    })), 'maintenance-report.xlsx', 'Maintenance');
  }

  if (format === 'csv') {
    const csvHeaders = [
      ['id', 'ID'],
      ['title', 'Title'],
      ['type', 'Type'],
      ['status', 'Status'],
      ['impact_level', 'Impact'],
      ['scheduled_start', 'Scheduled start'],
      ['scheduled_end', 'Scheduled end'],
      ['actual_start', 'Actual start'],
      ['actual_end', 'Actual end'],
      ['created_by', 'Created by'],
      ['description', 'Description'],
      ['notes', 'Notes'],
      ['duration_minutes', 'Duration (minutes)'],
    ];
    const csv = stringify([
      csvHeaders.map(([, label]) => label),
      ...rows.map(row => csvHeaders.map(([key]) => row[key] ?? '')),
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=maintenance-report.csv');
    return res.send(csv);
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=maintenance-report.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('Maintenance Report', { align: 'center' });
    doc.fontSize(10).text(`Generated on ${new Date().toLocaleString('en-GB')}`, { align: 'center' });
    doc.moveDown();

    for (const row of rows) {
      doc.fontSize(11).fillColor('#1e40af').text(row.title);
      doc.fontSize(9).fillColor('#374151')
        .text(`Type: ${row.type} | Status: ${row.status} | Impact: ${row.impact_level}`)
        .text(`Start: ${new Date(row.scheduled_start).toLocaleString('en-GB')} | End: ${new Date(row.scheduled_end).toLocaleString('en-GB')}`)
        .text(`Duration: ${Math.round(row.duration_minutes || 0)} min | Created by: ${row.created_by || '-'}`);
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(800, doc.y).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.3);
    }
    doc.end();
    return;
  }

  res.json(rows);
});

// ─── GET /api/reports/uptime ──────────────────────────────────────────────────
router.get('/uptime', async (req, res) => {
  const { service_id, days = 30 } = req.query;
  const d = parseInt(days);

  let query_str, params;
  if (service_id) {
    query_str = `
      SELECT s.id, s.name, s.slug, s.sla_uptime_percent,
        (SELECT COUNT(*) FROM status_history sh
         JOIN service_assets sa ON sa.asset_id=sh.entity_id
         WHERE sh.entity_type='asset' AND sa.service_id=s.id
           AND sh.status != 'under_maintenance'
           AND sh.created_at > NOW() - INTERVAL '${d} days') as status_changes
      FROM services s WHERE s.id=$1 AND s.is_active=true`;
    params = [service_id];
  } else {
    query_str = `
      SELECT s.id, s.name, s.slug, s.sla_uptime_percent, s.status,
        (SELECT COUNT(*) FROM status_history sh
         JOIN service_assets sa ON sa.asset_id=sh.entity_id
         WHERE sh.entity_type='asset' AND sa.service_id=s.id
           AND sh.status IN ('major_outage','partial_outage')
           AND sh.created_at > NOW() - INTERVAL '${d} days') as outage_events
      FROM services s WHERE s.is_active=true ORDER BY s.name`;
    params = [];
  }

  const rows = await getMany(query_str, params);
  res.json(rows);
});

// ─── GET /api/reports/assets ──────────────────────────────────────────────────
router.get('/assets', async (req, res) => {
  const rows = await getMany(
    `SELECT a.id, a.name, a.category, a.criticality, a.status, a.part_is_relevant,
       u.display_name as owner,
       (SELECT COUNT(*) FROM maintenance_assets ma JOIN maintenance_windows mw ON mw.id=ma.maintenance_id
        WHERE ma.asset_id=a.id AND mw.status='completed') as maintenance_count,
       (SELECT COUNT(*) FROM incident_assets ia JOIN incidents i ON i.id=ia.incident_id
        WHERE ia.asset_id=a.id) as incident_count,
       (SELECT COUNT(*) FROM probe_results pr WHERE pr.asset_id=a.id AND pr.success=false
        AND pr.probed_at > NOW() - INTERVAL '30 days') as failed_probes_30d
     FROM assets a LEFT JOIN users u ON u.id=a.owner_id
     WHERE a.is_active=true ORDER BY a.criticality, a.name`
  );
  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'xlsx') {
    return sendExcel(res, rows.map(row => ({
      Name: row.name,
      Category: row.category,
      Criticality: row.criticality,
      Status: row.status,
      'Part-IS': row.part_is_relevant ? 'Yes' : 'No',
      Owner: row.owner || '',
      Maintenances: row.maintenance_count,
      Incidents: row.incident_count,
      'Probe fails (30d)': row.failed_probes_30d,
    })), 'assets-report.xlsx', 'Assets');
  }
  if (format === 'pdf') {
    return sendSimplePdf(res, 'Assets Report', rows.map(row => ({
      Name: row.name,
      Category: row.category,
      Criticality: row.criticality,
      Status: row.status,
      'Part-IS': row.part_is_relevant ? 'Yes' : 'No',
      Owner: row.owner || '',
      Maintenances: row.maintenance_count,
      Incidents: row.incident_count,
      'Probe fails (30d)': row.failed_probes_30d,
    })), 'assets-report.pdf');
  }
  if (format === 'csv') {
    const csv = stringify(rows.map(row => ({
      Name: row.name,
      Category: row.category,
      Criticality: row.criticality,
      Status: row.status,
      'Part-IS': row.part_is_relevant ? 'Yes' : 'No',
      Owner: row.owner || '',
      Maintenances: row.maintenance_count,
      Incidents: row.incident_count,
      'Probe fails (30d)': row.failed_probes_30d,
    })), { header: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=assets-report.csv');
    return res.send(`\uFEFF${csv}`);
  }
  res.json(rows);
});

// ─── GET /api/reports/services ──────────────────────────────────────────────
router.get('/services', async (req, res) => {
  const rows = await getMany(
    `SELECT s.id, s.name, s.criticality, s.status, s.sla_uptime_percent, s.part_is_relevant,
       (SELECT COUNT(*)::int FROM service_assets sa WHERE sa.service_id=s.id) AS asset_count,
       (SELECT COUNT(*)::int FROM maintenance_assets ma JOIN service_assets sa ON sa.asset_id=ma.asset_id WHERE sa.service_id=s.id) AS maintenance_count,
       (SELECT COUNT(*)::int FROM incident_services ins WHERE ins.service_id=s.id) AS incident_count
     FROM services s
     WHERE s.is_active=true ORDER BY s.criticality, s.name`
  );
  const reportRows = rows.map(row => ({
    Name: row.name,
    'Part-IS': row.part_is_relevant ? 'Yes' : 'No',
    Criticality: row.criticality,
    Status: row.status,
    'SLA %': row.sla_uptime_percent,
    Assets: row.asset_count,
    Maintenances: row.maintenance_count,
    Incidents: row.incident_count,
  }));
  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'xlsx') return sendExcel(res, reportRows, 'services-report.xlsx', 'Services');
  if (format === 'pdf') return sendSimplePdf(res, 'Services Report', reportRows, 'services-report.pdf');
  if (format === 'csv') {
    const csv = stringify(reportRows, { header: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=services-report.csv');
    return res.send(`\uFEFF${csv}`);
  }
  res.json(rows);
});

// ─── GET /api/reports/licenses ───────────────────────────────────────────────
router.get('/licenses', async (req, res) => {
  const rows = await getMany(
    `SELECT l.name, l.approval_status, l.expiry_date, l.renewal_date, l.reminder_days, l.estimated_cost, l.currency,
            COALESCE(s.company, l.supplier, '') AS supplier,
            (SELECT COUNT(*)::int FROM license_assets la WHERE la.license_id=l.id) AS asset_count,
            (SELECT COUNT(*)::int FROM license_services ls WHERE ls.license_id=l.id) AS service_count
     FROM licenses l LEFT JOIN suppliers s ON s.id=l.supplier_id
     WHERE l.is_active=true ORDER BY l.expiry_date NULLS LAST, l.name`
  );
  const reportRows = rows.map(row => ({
    Name: row.name,
    'Approval status': row.approval_status,
    'Expiry date': row.expiry_date || '',
    'Renewal date': row.renewal_date || '',
    Supplier: row.supplier || '',
    'Estimated cost': row.estimated_cost || '',
    Currency: row.currency || '',
    Assets: row.asset_count,
    Services: row.service_count,
  }));
  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'xlsx') return sendExcel(res, reportRows, 'licenses-report.xlsx', 'Licenses');
  if (format === 'pdf') return sendSimplePdf(res, 'Licenses Report', reportRows, 'licenses-report.pdf');
  if (format === 'csv') {
    const csv = stringify(reportRows, { header: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=licenses-report.csv');
    return res.send(`\uFEFF${csv}`);
  }
  res.json(rows);
});

// ─── GET /api/reports/dashboard ──────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const upcomingPage = parsePositiveInt(req.query.upcoming_page, 1, 10000);
  const upcomingLimit = parsePositiveInt(req.query.upcoming_limit, 5, 100);
  const recentPage = parsePositiveInt(req.query.recent_page, 1, 10000);
  const recentLimit = parsePositiveInt(req.query.recent_limit, 5, 100);
  const upcomingOffset = (upcomingPage - 1) * upcomingLimit;
  const recentOffset = (recentPage - 1) * recentLimit;

  const cacheKey = `u:${upcomingPage}:${upcomingLimit}|r:${recentPage}:${recentLimit}`;
  const cached = getCachedDashboard(cacheKey);
  if (cached) return res.json(cached);

  const [
    totalAssets, totalServices, activeMaintenance, openIncidents,
    expiringLicenses, expiredLicenses, expiringLicenseList, pendingApprovalMaintenance,
    upcomingMaintenanceCount, upcomingMaintenance, recentCompletedCount, recentCompleted,
    assetsByStatus, assetsByCriticality,
    maintenanceByType, maintenanceByStatus
  ] = await Promise.all([
    getOne(`SELECT COUNT(*)::int as count FROM assets WHERE is_active=true`),
    getOne(`SELECT COUNT(*)::int as count FROM services WHERE is_active=true`),
    getOne(`SELECT COUNT(*)::int as count FROM maintenance_windows WHERE status IN ('in_progress','scheduled')`),
    getOne(`SELECT COUNT(*)::int as count FROM incidents WHERE status != 'resolved'`),
    getOne(`SELECT COUNT(*)::int as count
            FROM licenses
            WHERE is_active = true
              AND expiry_date IS NOT NULL
              AND expiry_date >= CURRENT_DATE
              AND expiry_date <= CURRENT_DATE + (GREATEST(COALESCE(reminder_days, 30), 1) || ' days')::interval`),
    getOne(`SELECT COUNT(*)::int as count
            FROM licenses
            WHERE is_active = true
              AND expiry_date IS NOT NULL
              AND expiry_date < CURRENT_DATE`),
    getMany(`SELECT l.id, l.name, l.expiry_date, l.reminder_days
             FROM licenses l
             WHERE l.is_active = true
               AND l.expiry_date IS NOT NULL
               AND l.expiry_date >= CURRENT_DATE
               AND l.expiry_date <= CURRENT_DATE + (GREATEST(COALESCE(l.reminder_days, 30), 1) || ' days')::interval
             ORDER BY l.expiry_date ASC, l.name
             LIMIT 8`),
    getMany(`SELECT id, title, impact_level, scheduled_start, scheduled_end, owner_approval_status
             FROM maintenance_windows
             WHERE owner_approval_required = true
               AND owner_approval_status = 'pending'
               AND status IN ('scheduled', 'pending_approval', 'in_progress')
             ORDER BY scheduled_start ASC
             LIMIT 8`),
    getOne(`SELECT COUNT(*)::int as count
            FROM maintenance_windows
            WHERE status IN ('scheduled','pending_approval') AND scheduled_start > NOW()`),
    getMany(`SELECT id, title, type, impact_level, scheduled_start, scheduled_end, status
             FROM maintenance_windows
             WHERE status IN ('scheduled','pending_approval') AND scheduled_start > NOW()
             ORDER BY scheduled_start ASC
             LIMIT $1 OFFSET $2`, [upcomingLimit, upcomingOffset]),
    getOne(`SELECT COUNT(*)::int as count
            FROM maintenance_windows
            WHERE status='completed'`),
    getMany(`SELECT id, title, status, actual_end FROM maintenance_windows
             WHERE status='completed'
             ORDER BY COALESCE(actual_end, scheduled_end, updated_at, created_at) DESC
             LIMIT $1 OFFSET $2`, [recentLimit, recentOffset]),
    getMany(`SELECT status, COUNT(*)::int as count FROM assets WHERE is_active=true GROUP BY status`),
    getMany(`SELECT criticality, COUNT(*)::int as count FROM assets WHERE is_active=true GROUP BY criticality`),
    getMany(`SELECT type, COUNT(*)::int as count FROM maintenance_windows
             WHERE scheduled_start > NOW() - INTERVAL '90 days' GROUP BY type`),
    getMany(`SELECT status, COUNT(*)::int as count FROM maintenance_windows
             WHERE scheduled_start > NOW() - INTERVAL '90 days' GROUP BY status`),
  ]);

  const payload = {
    totals: {
      assets: totalAssets.count,
      services: totalServices.count,
      active_maintenance: activeMaintenance.count,
      open_incidents: openIncidents.count,
      expiring_licenses: expiringLicenses.count,
      expired_licenses: expiredLicenses.count,
    },
    upcoming_maintenance_page: upcomingPage,
    upcoming_maintenance_limit: upcomingLimit,
    upcoming_maintenance_total: upcomingMaintenanceCount.count,
    upcoming_maintenance: upcomingMaintenance,
    recent_completed_page: recentPage,
    recent_completed_limit: recentLimit,
    recent_completed_total: recentCompletedCount.count,
    recent_completed: recentCompleted,
    expiring_licenses: expiringLicenseList,
    pending_approval_maintenance: pendingApprovalMaintenance,
    assets_by_status: assetsByStatus,
    assets_by_criticality: assetsByCriticality,
    maintenance_by_type: maintenanceByType,
    maintenance_by_status: maintenanceByStatus,
  };

  setCachedDashboard(cacheKey, payload);
  res.json(payload);
});

module.exports = router;
