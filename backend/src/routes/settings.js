const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware/authMiddleware');
const { query, getOne, getMany, transaction } = require('../db/database');
const { encrypt, isEncrypted } = require('../utils/encryption');
const ldapService = require('../services/ldapService');
const samlService = require('../services/samlService');
const authService = require('../services/authService');
const { testSmtp, getSmtpConfig, sendMail } = require('../utils/mailer');
const auditService = require('../services/auditService');

const router = Router();

const LDAP_DIRECTORY_SEARCH_PERMISSIONS = ['maintenance', 'assets', 'services'];

const DATA_TRANSFER_GROUPS = {
  core: {
    label: 'Users & Groups',
    tables: ['users', 'local_groups', 'user_group_members', 'ldap_group_mappings'],
  },
  assets: {
    label: 'Assets',
    tables: ['assets', 'asset_dependencies'],
  },
  services: {
    label: 'Services',
    tables: ['services', 'service_assets', 'service_dependencies', 'service_subscribers'],
  },
  maintenance: {
    label: 'Maintenance',
    tables: ['maintenance_templates', 'maintenance_types', 'maintenance_windows', 'maintenance_assets', 'maintenance_services', 'blackout_periods', 'maintenance_status_subscribers', 'maintenance_owner_approvals'],
  },
  incidents: {
    label: 'Incidents',
    tables: ['incident_severities', 'incidents', 'incident_assets', 'incident_services', 'incident_updates'],
  },
  licenses: {
    label: 'Licenses',
    tables: ['suppliers', 'licenses', 'license_assets', 'license_services'],
  },
  configuration: {
    label: 'Configuration',
    tables: ['settings', 'notification_templates', 'asset_categories'],
  },
  templates: {
    label: 'Templates',
    tables: ['settings', 'notification_templates'],
  },
  monitoring: {
    label: 'Monitoring',
    tables: ['asset_probes', 'service_probes'],
  },
};

const DATA_TRANSFER_DEPENDENCIES = {
  assets: ['core'],
  services: ['core', 'assets'],
  maintenance: ['assets', 'services'],
  incidents: ['assets', 'services'],
  licenses: ['assets', 'services'],
  monitoring: ['assets', 'services'],
};

const DATA_DELETE_TABLES = {
  core: ['ldap_group_mappings', 'user_group_members', 'local_groups', 'users'],
  assets: ['service_assets', 'license_assets', 'maintenance_assets', 'incident_assets', 'asset_dependencies', 'assets'],
  services: ['service_subscribers', 'service_dependencies', 'service_assets', 'license_services', 'maintenance_services', 'incident_services', 'services'],
  maintenance: ['maintenance_owner_approvals', 'maintenance_status_subscribers', 'maintenance_assets', 'maintenance_services', 'maintenance_windows', 'maintenance_templates', 'maintenance_types', 'blackout_periods'],
  incidents: ['incident_updates', 'incident_assets', 'incident_services', 'incidents', 'incident_severities'],
  licenses: ['license_assets', 'license_services', 'licenses', 'suppliers'],
  // System settings and notification templates are application defaults, not operational data.
  // They must survive "Delete all" so the template editor and placeholders remain usable.
  configuration: [],
  templates: ['notification_templates', 'settings'],
  monitoring: ['service_probe_results', 'asset_probes', 'service_probes'],
};

const DATA_TRANSFER_TABLES = new Set(Object.values(DATA_TRANSFER_GROUPS).flatMap(group => group.tables));

function normalizeTransferGroups(groups) {
  const requested = !Array.isArray(groups) || groups.length === 0 || groups.includes('all')
    ? Object.keys(DATA_TRANSFER_GROUPS)
    : groups.filter(group => Object.prototype.hasOwnProperty.call(DATA_TRANSFER_GROUPS, group));
  const expanded = new Set();
  const addGroup = (group) => {
    if (expanded.has(group)) return;
    for (const dependency of DATA_TRANSFER_DEPENDENCIES[group] || []) addGroup(dependency);
    expanded.add(group);
  };
  requested.forEach(addGroup);
  return [...expanded];
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function getTransferTableMetadata(client, table) {
  const columns = await client.query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  );
  const primaryKey = await client.query(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
     WHERE i.indrelid=$1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [table]
  );
  return {
    columns: columns.rows.map(row => row.column_name),
    jsonColumns: new Set(columns.rows
      .filter(row => row.data_type === 'json' || row.data_type === 'jsonb' || row.udt_name === 'json' || row.udt_name === 'jsonb')
      .map(row => row.column_name)),
    primaryKey: primaryKey.rows.map(row => row.column_name),
  };
}

const USER_REFERENCE_COLUMNS = new Set([
  'user_id', 'owner_id', 'created_by', 'approved_by', 'maintainer_user_id',
  'approver_user_id', 'rejected_by', 'reopened_by', 'owner_user_id', 'approved_by_user_id',
]);

const TRANSFER_NATURAL_KEYS = {
  local_groups: ['name'],
  assets: ['slug'],
  services: ['slug'],
  maintenance_types: ['slug'],
  notification_templates: ['event_type'],
  asset_categories: ['slug'],
  settings: ['key'],
};

const ENTITY_REFERENCE_COLUMNS = {
  asset_id: 'assets',
  service_id: 'services',
  group_id: 'local_groups',
  local_group_id: 'local_groups',
};

const DEPENDENCY_REFERENCE_TABLES = {
  asset_dependencies: 'assets',
  service_dependencies: 'services',
};

function remapTransferValue(table, column, value, idMaps) {
  if (value === null || value === undefined) return value;
  if (USER_REFERENCE_COLUMNS.has(column) && idMaps.users?.has(value)) return idMaps.users.get(value);
  const referencedTable = ENTITY_REFERENCE_COLUMNS[column];
  if (referencedTable && idMaps[referencedTable]?.has(value)) return idMaps[referencedTable].get(value);
  if (column === 'depends_on_id') {
    const dependencyTable = DEPENDENCY_REFERENCE_TABLES[table];
    if (dependencyTable && idMaps[dependencyTable]?.has(value)) return idMaps[dependencyTable].get(value);
  }
  return value;
}

function normalizeTransferValue(value, isJsonColumn) {
  if (!isJsonColumn || value === null || value === undefined) return value;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

function sanitizeTransferRow(table, row, includeSensitive) {
  if (includeSensitive) return row;
  const safe = { ...row };
  if (table === 'users') {
    delete safe.password_hash;
    delete safe.totp_secret;
  }
  if (table === 'settings' && ['ldap_config', 'saml_config', 'smtp_config'].includes(row.key)) {
    try {
      const config = JSON.parse(row.value || '{}');
      for (const key of ['bind_password', 'ldap_service_password', 'sp_private_key', 'sp_cert', 'idp_cert', 'pass']) delete config[key];
      safe.value = JSON.stringify(config);
    } catch {
      safe.value = '{}';
    }
  }
  return safe;
}

function getTransferTables(groups) {
  const tableOrder = [
    'users', 'local_groups', 'user_group_members', 'ldap_group_mappings',
    'assets', 'asset_dependencies', 'services', 'service_assets', 'service_dependencies', 'service_subscribers',
    'maintenance_templates', 'maintenance_types', 'maintenance_windows', 'maintenance_assets', 'maintenance_services',
    'blackout_periods', 'maintenance_status_subscribers', 'maintenance_owner_approvals',
    'incident_severities', 'incidents', 'incident_assets', 'incident_services', 'incident_updates',
    'suppliers', 'licenses', 'license_assets', 'license_services',
    'settings', 'notification_templates', 'asset_categories', 'asset_probes', 'service_probes',
  ];
  const selectedTables = new Set(groups.flatMap(group => DATA_TRANSFER_GROUPS[group].tables));
  return tableOrder.filter(table => selectedTables.has(table))
    .filter(table => DATA_TRANSFER_TABLES.has(table));
}

function getDeleteTables(groups) {
  const order = ['monitoring', 'licenses', 'incidents', 'maintenance', 'services', 'assets', 'configuration', 'core'];
  const selected = new Set(groups.flatMap(group => DATA_DELETE_TABLES[group] || []));
  return order.flatMap(group => DATA_DELETE_TABLES[group] || []).filter(table => selected.has(table));
}

async function createTransferBackup(groups, tables, reason) {
  const backupDir = path.join(__dirname, '../../uploads/data-transfer-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const data = {};
  for (const table of tables) {
    const rows = await getMany(`SELECT * FROM ${quoteIdentifier(table)}`);
    data[table] = rows.map(row => sanitizeTransferRow(table, row, false));
  }
  const fileName = `transfer-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(backupDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify({
    format: 'gb-maintenance-data-transfer',
    version: 1,
    reason,
    created_at: new Date().toISOString(),
    groups,
    tables: data,
  }, null, 2), 'utf8');
  return fileName;
}

function requireLdapDirectorySearchAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  if (req.user.role === 'superadmin' || req.user.role === 'admin') return next();

  const perms = req.user.permissions || {};
  const allowed = LDAP_DIRECTORY_SEARCH_PERMISSIONS.some((perm) => perms[perm] === true);
  if (allowed) return next();

  return res.status(403).json({ error: 'Permessi insufficienti per la ricerca LDAP' });
}

function getDefaultGeneralSettings() {
  return {
    app_name: 'GB Maintenance',
    app_url: '',
    app_brand_image_url: '',
    default_language: 'it',
    require_approval_for: ['critical', 'high'],
    audit_log_retention_days: 365,
    audit_log_auto_purge: true,
    maintenance_reminders: ['7d', '1d', '2h', '30m'],
    approval_page_title: 'License Approval',
    approval_page_subtitle: 'Review the request and confirm whether the license can be approved.',
    approval_page_logo_url: '',
    approval_page_primary_color: '#2563eb',
    approval_page_side_kicker: 'Approval Flow',
    approval_page_side_title: 'Simple, but brandable',
    approval_page_side_description: "This page can now be branded from Licenses > Template with company name, custom title, subtitle, logo, and primary color, so the approval request feels like part of the customer's own portal.",
    approval_page_side_rows_count: 4,
    approval_page_side_point_1: 'Company/app name shown in the public header',
    approval_page_side_point_2: 'Custom title and subtitle for approval requests',
    approval_page_side_point_3: 'Company logo uploaded from Licenses > Template',
    approval_page_side_point_4: 'Primary accent color used for CTA and highlights',
    approval_page_side_point_5: '',
    approval_page_side_point_6: '',
    approval_page_side_point_7: '',
    approval_page_side_point_8: '',
    approval_page_side_icon_1: 'shield-check',
    approval_page_side_icon_2: 'layout-list',
    approval_page_side_icon_3: 'image',
    approval_page_side_icon_4: 'palette',
    approval_page_side_icon_5: 'sparkles',
    approval_page_side_icon_6: 'star',
    approval_page_side_icon_7: 'check-circle',
    approval_page_side_icon_8: 'circle-dot',
    approval_page_back_to_login_label: 'Back to login',
    approval_page_footer_text: 'Powered by {app_name}',
    approval_page_load_button_label: 'Load request',
    approval_page_loading_label: 'Loading approval request...',
    approval_page_approve_button_label: 'Approve',
    approval_page_reject_button_label: 'Reject',
    approval_page_reject_reason_label: 'Reject reason (optional)',
    approval_page_reject_reason_placeholder: 'Add a note for the requester, if needed.',
    approval_page_missing_token_text: 'Missing approval token',
    approval_page_load_error_text: 'Cannot load approval request',
    maintenance_approval_page_title: 'Maintenance Approval',
    maintenance_approval_page_subtitle: 'Review the scheduled maintenance affecting an asset you own and confirm the proposed dates.',
    maintenance_approval_page_primary_color: '#2563eb',
    maintenance_approval_page_approve_label: 'Approve',
    maintenance_approval_page_reject_label: 'Reject',
    maintenance_approval_page_propose_label: 'Propose new date',
    maintenance_approval_page_submit_label: 'Submit proposed date',
    maintenance_approval_page_footer_text: 'Powered by {app_name}',
  };
}

async function getDemoRegistry() {
  const row = await getOne("SELECT value FROM settings WHERE key='demo_seed_registry'");
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return {
      asset_ids: Array.isArray(parsed.asset_ids) ? parsed.asset_ids : [],
      service_ids: Array.isArray(parsed.service_ids) ? parsed.service_ids : [],
      maintenance_ids: Array.isArray(parsed.maintenance_ids) ? parsed.maintenance_ids : [],
      incident_ids: Array.isArray(parsed.incident_ids) ? parsed.incident_ids : [],
      blackout_ids: Array.isArray(parsed.blackout_ids) ? parsed.blackout_ids : [],
      supplier_ids: Array.isArray(parsed.supplier_ids) ? parsed.supplier_ids : [],
      license_ids: Array.isArray(parsed.license_ids) ? parsed.license_ids : [],
      probe_ids: Array.isArray(parsed.probe_ids) ? parsed.probe_ids : [],
      local_user_ids: Array.isArray(parsed.local_user_ids) ? parsed.local_user_ids : [],
      local_group_ids: Array.isArray(parsed.local_group_ids) ? parsed.local_group_ids : [],
      asset_dependency_count: Number(parsed.asset_dependency_count || 0),
      service_dependency_count: Number(parsed.service_dependency_count || 0),
      seeded_at: parsed.seeded_at || null,
      seeded_by: parsed.seeded_by || null,
      tag: parsed.tag || null,
    };
  } catch {
    return null;
  }
}

function atFromNow(hoursFromNow) {
  return new Date(Date.now() + (hoursFromNow * 60 * 60 * 1000)).toISOString();
}

function atCurrentMonth(day, hour, minute = 0) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const safeDay = Math.max(1, Math.min(28, Number(day) || 1));
  return new Date(year, month, safeDay, hour, minute, 0, 0).toISOString();
}

function atYearMonthDay(year, monthIndex, day, hour, minute = 0) {
  const safeYear = Number(year) || new Date().getFullYear();
  const safeMonth = Math.max(0, Math.min(11, Number(monthIndex) || 0));
  const safeDay = Math.max(1, Math.min(28, Number(day) || 1));
  return new Date(safeYear, safeMonth, safeDay, hour, minute, 0, 0).toISOString();
}

// ─── GET /api/settings/public-branding ──────────────────────────────────────
router.get('/public-branding', async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  const general = row ? JSON.parse(row.value || '{}') : {};
  const defaults = getDefaultGeneralSettings();
  const sideRowsCountRaw = Number(general.approval_page_side_rows_count || defaults.approval_page_side_rows_count);
  const sideRowsCount = Number.isFinite(sideRowsCountRaw) ? Math.min(8, Math.max(1, Math.trunc(sideRowsCountRaw))) : 4;

  res.json({
    app_name: general.app_name || defaults.app_name,
    app_url: general.app_url || defaults.app_url,
    app_brand_image_url: general.app_brand_image_url || defaults.app_brand_image_url,
    approval_page_title: general.approval_page_title || defaults.approval_page_title,
    approval_page_subtitle: general.approval_page_subtitle || defaults.approval_page_subtitle,
    approval_page_logo_url: general.app_brand_image_url || defaults.app_brand_image_url || '',
    approval_page_primary_color: general.approval_page_primary_color || defaults.approval_page_primary_color,
    approval_page_side_kicker: general.approval_page_side_kicker || defaults.approval_page_side_kicker,
    approval_page_side_title: general.approval_page_side_title || defaults.approval_page_side_title,
    approval_page_side_description: general.approval_page_side_description || defaults.approval_page_side_description,
    approval_page_side_rows_count: sideRowsCount,
    approval_page_side_point_1: general.approval_page_side_point_1 || defaults.approval_page_side_point_1,
    approval_page_side_point_2: general.approval_page_side_point_2 || defaults.approval_page_side_point_2,
    approval_page_side_point_3: general.approval_page_side_point_3 || defaults.approval_page_side_point_3,
    approval_page_side_point_4: general.approval_page_side_point_4 || defaults.approval_page_side_point_4,
    approval_page_side_point_5: general.approval_page_side_point_5 || defaults.approval_page_side_point_5,
    approval_page_side_point_6: general.approval_page_side_point_6 || defaults.approval_page_side_point_6,
    approval_page_side_point_7: general.approval_page_side_point_7 || defaults.approval_page_side_point_7,
    approval_page_side_point_8: general.approval_page_side_point_8 || defaults.approval_page_side_point_8,
    approval_page_side_icon_1: general.approval_page_side_icon_1 || defaults.approval_page_side_icon_1,
    approval_page_side_icon_2: general.approval_page_side_icon_2 || defaults.approval_page_side_icon_2,
    approval_page_side_icon_3: general.approval_page_side_icon_3 || defaults.approval_page_side_icon_3,
    approval_page_side_icon_4: general.approval_page_side_icon_4 || defaults.approval_page_side_icon_4,
    approval_page_side_icon_5: general.approval_page_side_icon_5 || defaults.approval_page_side_icon_5,
    approval_page_side_icon_6: general.approval_page_side_icon_6 || defaults.approval_page_side_icon_6,
    approval_page_side_icon_7: general.approval_page_side_icon_7 || defaults.approval_page_side_icon_7,
    approval_page_side_icon_8: general.approval_page_side_icon_8 || defaults.approval_page_side_icon_8,
    approval_page_back_to_login_label: general.approval_page_back_to_login_label || defaults.approval_page_back_to_login_label,
    approval_page_footer_text: general.approval_page_footer_text || defaults.approval_page_footer_text,
    approval_page_load_button_label: general.approval_page_load_button_label || defaults.approval_page_load_button_label,
    approval_page_loading_label: general.approval_page_loading_label || defaults.approval_page_loading_label,
    approval_page_approve_button_label: general.approval_page_approve_button_label || defaults.approval_page_approve_button_label,
    approval_page_reject_button_label: general.approval_page_reject_button_label || defaults.approval_page_reject_button_label,
    approval_page_refresh_button_label: general.approval_page_refresh_button_label || defaults.approval_page_refresh_button_label,
    approval_page_reject_reason_label: general.approval_page_reject_reason_label || defaults.approval_page_reject_reason_label,
    approval_page_reject_reason_placeholder: general.approval_page_reject_reason_placeholder || defaults.approval_page_reject_reason_placeholder,
    approval_page_missing_token_text: general.approval_page_missing_token_text || defaults.approval_page_missing_token_text,
    approval_page_load_error_text: general.approval_page_load_error_text || defaults.approval_page_load_error_text,
    maintenance_approval_page_title: general.maintenance_approval_page_title || defaults.maintenance_approval_page_title,
    maintenance_approval_page_subtitle: general.maintenance_approval_page_subtitle || defaults.maintenance_approval_page_subtitle,
    maintenance_approval_page_primary_color: general.maintenance_approval_page_primary_color || defaults.maintenance_approval_page_primary_color,
    maintenance_approval_page_approve_label: general.maintenance_approval_page_approve_label || defaults.maintenance_approval_page_approve_label,
    maintenance_approval_page_reject_label: general.maintenance_approval_page_reject_label || defaults.maintenance_approval_page_reject_label,
    maintenance_approval_page_propose_label: general.maintenance_approval_page_propose_label || defaults.maintenance_approval_page_propose_label,
    maintenance_approval_page_submit_label: general.maintenance_approval_page_submit_label || defaults.maintenance_approval_page_submit_label,
    maintenance_approval_page_footer_text: general.maintenance_approval_page_footer_text || defaults.maintenance_approval_page_footer_text,
  });
});

// ─── GET /api/settings/data-transfer/options ─────────────────────────────────
router.get('/data-transfer/options', requireAuth, requireSuperAdmin, async (req, res) => {
  res.json({
    groups: Object.entries(DATA_TRANSFER_GROUPS).map(([id, group]) => ({ id, label: group.label, tables: group.tables })),
  });
});

// ─── GET /api/settings/data-transfer/export ──────────────────────────────────
router.get('/data-transfer/export', requireAuth, requireSuperAdmin, async (req, res) => {
  const requestedGroups = String(req.query.groups || 'all').split(',').map(group => group.trim()).filter(Boolean);
  const groups = normalizeTransferGroups(requestedGroups);
  const tables = getTransferTables(groups);
  const includeSensitive = String(req.query.include_sensitive || '').toLowerCase() === 'true';
  const data = {};

  for (const table of tables) {
    const rows = await getMany(`SELECT * FROM ${quoteIdentifier(table)}`);
    data[table] = rows.map(row => sanitizeTransferRow(table, row, includeSensitive));
  }

  await auditService.log(req.user.id, req.user.username, 'settings:data_export', 'settings', 'data_transfer', JSON.stringify({ groups }), req.ip);
  res.json({
    format: 'gb-maintenance-data-transfer',
    version: 1,
    exported_at: new Date().toISOString(),
    includes_sensitive_data: includeSensitive,
    groups,
    tables: data,
  });
});

// ─── POST /api/settings/data-transfer/import ─────────────────────────────────
router.post('/data-transfer/import', requireAuth, requireSuperAdmin, async (req, res) => {
  const payload = req.body?.data || req.body;
  if (!payload || payload.format !== 'gb-maintenance-data-transfer' || !payload.tables || typeof payload.tables !== 'object') {
    return res.status(400).json({ error: 'Invalid GB Maintenance data transfer file' });
  }

  const groups = normalizeTransferGroups(req.body?.groups || payload.groups);
  const tables = getTransferTables(groups).filter(table => Array.isArray(payload.tables[table]));
  if (tables.length === 0) return res.status(400).json({ error: 'No selected data found in the import file' });
  const backupFile = req.body?.dry_run === true ? null : await createTransferBackup(groups, tables, 'before-import');

  const imported = {};
  const idMaps = { users: new Map(), local_groups: new Map(), assets: new Map(), services: new Map() };
  let currentTable = null;
  try {
    await transaction(async (client) => {
      for (const table of tables) {
        currentTable = table;
      let rows = payload.tables[table].slice();
      if (rows.length === 0) {
        imported[table] = 0;
        continue;
      }

      const metadata = await getTransferTableMetadata(client, table);
      const naturalKey = TRANSFER_NATURAL_KEYS[table];
      if (naturalKey && naturalKey.every(column => Object.prototype.hasOwnProperty.call(rows[0], column))) {
        const rowsToInsert = [];
        for (const row of rows) {
          const conditions = naturalKey.map((column, index) => `${quoteIdentifier(column)}=$${index + 1}`).join(' AND ');
          const existing = await client.query(
            `SELECT ${quoteIdentifier(metadata.primaryKey[0] || 'id')} AS id FROM ${quoteIdentifier(table)} WHERE ${conditions} LIMIT 1`,
            naturalKey.map(column => row[column])
          );
          if (!existing.rows[0]) {
            rowsToInsert.push(row);
            continue;
          }

          if (row.id && idMaps[table]) idMaps[table].set(row.id, existing.rows[0].id);
          const updateColumns = metadata.columns.filter(column =>
            column !== 'id' && !naturalKey.includes(column) && Object.prototype.hasOwnProperty.call(row, column)
          );
          if (updateColumns.length > 0) {
            const updateValues = updateColumns.map(column => remapTransferValue(
              table,
              column,
              normalizeTransferValue(row[column] === undefined ? null : row[column], metadata.jsonColumns.has(column)),
              idMaps
            ));
            const updateConditions = naturalKey
              .map((column, index) => `${quoteIdentifier(column)}=$${updateColumns.length + index + 1}`)
              .join(' AND ');
            await client.query(
              `UPDATE ${quoteIdentifier(table)} SET ${updateColumns.map((column, index) => `${quoteIdentifier(column)}=$${index + 1}`).join(', ')} WHERE ${updateConditions}`,
              [...updateValues, ...naturalKey.map(column => row[column])]
            );
          }
        }
        rows = rowsToInsert;
        if (rows.length === 0) {
          imported[table] = payload.tables[table].length;
          continue;
        }
      }
      if (table === 'users') {
        const rowsToImport = [];
        for (const row of rows) {
          const existing = await client.query('SELECT id FROM "users" WHERE username=$1', [row.username]);
          if (existing.rows[0]) {
            idMaps.users.set(row.id, existing.rows[0].id);
          } else {
            rowsToImport.push(row);
            idMaps.users.set(row.id, row.id);
          }
        }
        imported[table] = rows.length - rowsToImport.length;
        if (rowsToImport.length === 0) continue;
        rows.splice(0, rows.length, ...rowsToImport);
      }
      const columns = metadata.columns.filter(column => Object.prototype.hasOwnProperty.call(rows[0], column));
      if (columns.length === 0) continue;
      const quotedColumns = columns.map(quoteIdentifier).join(', ');
      let conflictClause = 'ON CONFLICT DO NOTHING';
      const conflictColumns = metadata.primaryKey;
      if (conflictColumns.length > 0 && conflictColumns.every(column => columns.includes(column))) {
        const updates = columns
          .filter(column => !conflictColumns.includes(column) && column !== 'id')
          .map(column => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`)
          .join(', ');
        conflictClause = updates
          ? `ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(', ')}) DO UPDATE SET ${updates}`
          : 'ON CONFLICT DO NOTHING';
      }

      for (let offset = 0; offset < rows.length; offset += 200) {
        const batch = rows.slice(offset, offset + 200);
        const values = [];
        const placeholders = batch.map(row => {
          const rowPlaceholders = columns.map(column => `$${values.push(remapTransferValue(
            table,
            column,
            normalizeTransferValue(row[column] === undefined ? null : row[column], metadata.jsonColumns.has(column)),
            idMaps
          ))}`);
          return `(${rowPlaceholders.join(', ')})`;
        }).join(', ');
        await client.query(
          `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES ${placeholders} ${conflictClause}`,
          values
        );
      }
      imported[table] = (imported[table] || 0) + rows.length;
      }
      if (req.body?.dry_run === true) {
        const previewError = new Error('DRY_RUN');
        previewError.code = 'DRY_RUN';
        throw previewError;
      }
    });
  } catch (error) {
    if (error.code === 'DRY_RUN') {
      return res.json({ message: 'Import preview completed', dry_run: true, groups, imported });
    }
    console.error(`[DataTransfer] Import failed on ${currentTable || 'unknown table'}:`, error);
    return res.status(409).json({
      error: `Import failed on table ${currentTable || 'unknown'}`,
      details: error.code === '23505' ? 'A unique value already exists in the destination database.' : error.message,
    });
  }

  await auditService.log(req.user.id, req.user.username, 'settings:data_import', 'settings', 'data_transfer', JSON.stringify({ groups, tables }), req.ip);
  res.json({ message: 'Data imported successfully', groups, imported, backup_file: backupFile });
});

// ─── POST /api/settings/data-transfer/delete ─────────────────────────────────
router.post('/data-transfer/delete', requireAuth, requireSuperAdmin, async (req, res) => {
  if (req.body?.confirmation !== 'DELETE_SELECTED_DATA') {
    return res.status(400).json({ error: 'Explicit deletion confirmation is required' });
  }

  const requestedGroups = req.body?.all === true ? ['all'] : req.body?.groups;
  const groups = normalizeTransferGroups(requestedGroups);
  const tables = getDeleteTables(groups);
  if (tables.length === 0) return res.status(400).json({ error: 'No data group selected for deletion' });
  const backupFile = await createTransferBackup(groups, tables, 'before-delete');

  await transaction(async (client) => {
    for (const table of tables) {
      if (table === 'users') {
        await client.query('DELETE FROM "users" WHERE id <> $1', [req.user.id]);
      } else {
        await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
      }
    }
  });

  await auditService.log(req.user.id, req.user.username, 'settings:data_delete', 'settings', 'data_transfer', JSON.stringify({ groups, tables }), req.ip);
  res.json({ message: 'Selected data deleted successfully', groups, deleted_tables: tables, backup_file: backupFile });
});

// ─── GET /api/settings ────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const rows = await getMany('SELECT key, updated_at FROM settings ORDER BY key');
  res.json(rows.map(r => r.key));
});

// ─── GET /api/settings/smtp ───────────────────────────────────────────────────
router.get('/smtp', requireAuth, requireAdmin, async (req, res) => {
  const cfg = await getSmtpConfig();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.pass) safe.pass = '********';
  res.json(safe);
});

// ─── PUT /api/settings/smtp ───────────────────────────────────────────────────
router.put('/smtp', requireAuth, requireAdmin, [
  body('host').isString().trim().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }),
  body('user').optional().isString(),
  body('from').optional().isString(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const existing = await getSmtpConfig() || {};
  const cfg = {
    host: req.body.host,
    port: req.body.port,
    secure: req.body.secure || false,
    ignoreTls: req.body.ignoreTls !== undefined ? !!req.body.ignoreTls : !!existing.ignoreTls,
    user: req.body.user || '',
    pass: req.body.pass ? encrypt(req.body.pass) : (existing.pass || ''),
    from: req.body.from || `GB Maintenance <${req.body.user}>`,
  };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('smtp_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(cfg)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'smtp_config', null, req.ip);
  res.json({ message: 'Configurazione SMTP salvata' });
});

// ─── POST /api/settings/smtp/test ────────────────────────────────────────────
router.post('/smtp/test', requireAuth, requireAdmin, [
  body('to').isEmail().withMessage('Valid recipient email is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = await getSmtpConfig();
    const cfg = {
      ...existing,
      ...(req.body.host ? req.body : {}),
    };
    await testSmtp(cfg);

    const now = new Date().toISOString();
    const info = await sendMail({
      to: req.body.to,
      subject: 'GB Maintenance SMTP test',
      text: `SMTP test message sent at ${now}`,
      html: `<p>SMTP test message sent at <strong>${now}</strong>.</p>`
    });

    res.json({
      message: `SMTP connection OK, test email queued to ${req.body.to}`,
      delivery: info || null
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET/PUT /api/settings/ldap ───────────────────────────────────────────────
router.get('/ldap', requireAuth, requireSuperAdmin, async (req, res) => {
  const cfg = await ldapService.getLdapSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.bind_password) safe.bind_password = '********';
  res.json(safe);
});

router.get('/ldap/enabled', requireAuth, requireLdapDirectorySearchAccess, async (req, res) => {
  const cfg = await ldapService.getLdapSettings();
  res.json({ enabled: !!(cfg && cfg.enabled) });
});

router.put('/ldap', requireAuth, requireSuperAdmin, async (req, res) => {
  await ldapService.saveLdapSettings(req.body);
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'ldap_config', null, req.ip);
  res.json({ message: 'Configurazione LDAP salvata' });
});

router.post('/ldap/test', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const cfg = req.body.url ? req.body : await ldapService.getLdapSettings();
    if (!cfg) return res.status(400).json({ error: 'LDAP non configurato' });
    await ldapService.testLdapConnection(cfg);
    res.json({ message: 'Connessione LDAP riuscita' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/groups ───────────────────────────────────────────
router.get('/ldap/groups', requireAuth, requireLdapDirectorySearchAccess, async (req, res) => {
  try {
    const groups = await ldapService.searchGroups(req.query.q || '');
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/settings/ldap/users ────────────────────────────────────────────
router.get('/ldap/users', requireAuth, requireLdapDirectorySearchAccess, async (req, res) => {
  try {
    const users = await ldapService.searchUsers(req.query.q || '');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET/PUT /api/settings/saml ───────────────────────────────────────────────
router.get('/saml', requireAuth, requireSuperAdmin, async (req, res) => {
  const cfg = await samlService.getSamlSettings();
  if (!cfg) return res.json({});
  const safe = { ...cfg };
  if (safe.sp_private_key) safe.sp_private_key = '********';
  res.json(safe);
});

router.put('/saml', requireAuth, requireSuperAdmin, async (req, res) => {
  await samlService.saveSamlSettings(req.body);
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'saml_config', null, req.ip);
  res.json({ message: 'Configurazione SAML salvata' });
});

// ─── GET/PUT /api/settings/webhooks ──────────────────────────────────────────
router.get('/webhooks', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='webhook_config'");
  res.json(row ? JSON.parse(row.value) : []);
});

router.put('/webhooks', requireAuth, requireAdmin, [
  body().isArray(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('webhook_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(req.body)]
  );
  res.json({ message: 'Webhook salvati' });
});

// ─── GET/PUT /api/settings/general ───────────────────────────────────────────
router.get('/general', requireAuth, requireSuperAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='general_config'");
  res.json(row ? { ...getDefaultGeneralSettings(), ...JSON.parse(row.value) } : getDefaultGeneralSettings());
});

router.put('/general', requireAuth, requireSuperAdmin, async (req, res) => {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('general_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(req.body)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'general_config', null, req.ip);
  res.json({ message: 'Impostazioni generali salvate' });
});

// ─── GET/PUT /api/settings/ntp ────────────────────────────────────────────────
router.get('/ntp', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='ntp_config'");
  res.json(row ? JSON.parse(row.value) : { ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome' });
});

router.put('/ntp', requireAuth, requireAdmin, [
  body('ntp_server').optional().isString().trim(),
  body('timezone').optional().isString().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const cfg = {
    ntp_server: req.body.ntp_server || 'pool.ntp.org',
    timezone: req.body.timezone || 'Europe/Rome',
    note: req.body.note || '',
  };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('ntp_config', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(cfg)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'ntp_config', null, req.ip);
  res.json({ message: 'NTP/timezone configuration saved' });
});

// ─── POST /api/settings/ntp/query ─────────────────────────────────────────────
router.post('/ntp/query', requireAuth, requireAdmin, async (req, res) => {
  const server = (req.body.server || 'pool.ntp.org').trim();
  const dgram = require('dgram');
  const NTP_PORT = 123;
  try {
    const result = await new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const buf = Buffer.alloc(48);
      buf[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)
      const t1 = Date.now();
      client.send(buf, 0, buf.length, NTP_PORT, server, err => {
        if (err) { client.close(); reject(err); }
      });
      client.on('message', msg => {
        const t4 = Date.now();
        const secs = msg.readUInt32BE(40);
        const serverMs = (secs - 2208988800) * 1000;
        const offset = Math.round(((serverMs - t1) + (serverMs - t4)) / 2);
        client.close();
        resolve({ server_time: new Date(serverMs).toISOString(), offset_ms: offset });
      });
      client.on('error', err => { try { client.close(); } catch {} reject(err); });
      setTimeout(() => { try { client.close(); } catch {} reject(new Error('NTP query timeout (5s)')); }, 5000);
    });
    res.json({ success: true, server, server_time: result.server_time, offset_ms: result.offset_ms, local_time: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── GET/PUT /api/settings/role-presets ───────────────────────────────────────
router.get('/role-presets', requireAuth, requireAdmin, async (req, res) => {
  const row = await getOne("SELECT value FROM settings WHERE key='role_presets'");
  const saved = row ? JSON.parse(row.value) : [];
  const defaultOrder = ['admin', 'change_manager', 'operator', 'viewer', 'subscriber'];
  const defaults = defaultOrder.map((role) => ({
    id: role,
    name: role,
    description: 'Default role preset',
    permissions: authService.ROLE_DEFAULTS[role] || {},
  }));

  // Legacy upgrade path: if old data has no built-in role IDs, seed defaults once.
  if (!row) return res.json(defaults);

  const safeSaved = Array.isArray(saved) ? saved : [];
  const hasAnyDefaultId = safeSaved.some((p) => defaultOrder.includes(String(p?.id || '')));
  if (!hasAnyDefaultId) {
    const upgraded = [...defaults, ...safeSaved];
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('role_presets', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(upgraded)]
    );
    return res.json(upgraded);
  }

  res.json(safeSaved);
});

router.put('/role-presets', requireAuth, requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  const toSave = req.body
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      permissions: p.permissions || {},
    }));
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('role_presets', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [JSON.stringify(toSave)]
  );
  await auditService.log(req.user.id, req.user.username, 'settings:update', 'settings', 'role_presets', null, req.ip);
  res.json({ message: 'Role presets saved' });
});

// ─── Demo Data (superadmin only) ────────────────────────────────────────────
router.get('/demo/status', requireAuth, requireSuperAdmin, async (req, res) => {
  const reg = await getDemoRegistry();
  if (!reg) {
    return res.json({
      exists: false,
      asset_count: 0,
      service_count: 0,
      maintenance_count: 0,
      incident_count: 0,
      supplier_count: 0,
      license_count: 0,
      probe_count: 0,
      local_user_count: 0,
      local_group_count: 0,
      asset_dependency_count: 0,
      service_dependency_count: 0,
      seeded_at: null,
      seeded_by: null,
    });
  }
  const total = reg.asset_ids.length + reg.service_ids.length + reg.maintenance_ids.length + reg.incident_ids.length + reg.supplier_ids.length + reg.license_ids.length + reg.probe_ids.length + reg.local_user_ids.length + reg.local_group_ids.length;
  return res.json({
    exists: total > 0,
    asset_count: reg.asset_ids.length,
    service_count: reg.service_ids.length,
    maintenance_count: reg.maintenance_ids.length,
    incident_count: reg.incident_ids.length,
    supplier_count: reg.supplier_ids.length,
    license_count: reg.license_ids.length,
    probe_count: reg.probe_ids.length,
    local_user_count: reg.local_user_ids.length,
    local_group_count: reg.local_group_ids.length,
    asset_dependency_count: reg.asset_dependency_count,
    service_dependency_count: reg.service_dependency_count,
    seeded_at: reg.seeded_at,
    seeded_by: reg.seeded_by,
  });
});

router.post('/demo/create', requireAuth, requireSuperAdmin, async (req, res) => {
  const existing = await getDemoRegistry();
  if (existing) {
    const totalExisting = existing.asset_ids.length + existing.service_ids.length + existing.maintenance_ids.length + existing.incident_ids.length + existing.blackout_ids.length + existing.supplier_ids.length + existing.license_ids.length + existing.probe_ids.length + existing.local_user_ids.length + existing.local_group_ids.length;
    if (totalExisting > 0) {
      return res.status(409).json({ error: 'Demo data already exists. Remove it first.' });
    }
  }

  const tag = Date.now();
  const demoEmail = 'guidoballarini@email.test';

  const localUsersDef = [
    { key: 'ops1', username: 'demo.1', display_name: 'Login demo.1', role: 'operator', office: 'Milan HQ' },
    { key: 'ops2', username: 'demo.2', display_name: 'Login demo.2', role: 'operator', office: 'Rome Branch' },
    { key: 'viewer1', username: 'demo.3', display_name: 'Login demo.3', role: 'viewer', office: 'Turin Office' },
    { key: 'subscriber1', username: 'demo.4', display_name: 'Login demo.4', role: 'subscriber', office: 'Remote NOC' },
  ];

  const suppliersDef = [
    { key: 'cloud', first: 'Demo', last: 'Cloud', company: 'Acme Cloud SRL' },
    { key: 'network', first: 'Demo', last: 'Network', company: 'NorthNet SPA' },
    { key: 'security', first: 'Demo', last: 'Security', company: 'SafePatch LTD' },
  ];

  const licensesDef = [
    {
      key: 'portal-suite',
      name: 'Demo Portal Suite',
      description: 'Licenses covering the public portal stack.',
      supplierKey: 'cloud',
      ownerKey: 'ops1',
      maintainerKey: 'ops2',
      approverKey: 'ops3',
      approvalStatus: 'approved',
      approvalRequired: true,
      expiryDate: atFromNow(24 * 120),
      renewalDate: atFromNow(24 * 90),
      estimatedCost: 18000,
      notes: 'Assigned to portal assets and customer-facing services.',
      assets: ['portal-web', 'portal-api', 'edge-lb'],
      services: ['customer-portal', 'billing'],
    },
    {
      key: 'identity-suite',
      name: 'Demo Identity Suite',
      description: 'Authentication and session management licenses.',
      supplierKey: 'network',
      ownerKey: 'ops2',
      maintainerKey: 'ops3',
      approverKey: 'ops1',
      approvalStatus: 'pending',
      approvalRequired: true,
      expiryDate: atFromNow(24 * 60),
      renewalDate: atFromNow(24 * 30),
      estimatedCost: 9000,
      notes: 'Used for identity service testing and portal access.',
      assets: ['auth-service', 'redis-cache'],
      services: ['identity'],
    },
    {
      key: 'data-platform',
      name: 'Demo Data Platform',
      description: 'Licenses for data and reporting workloads.',
      supplierKey: 'security',
      ownerKey: 'ops3',
      maintainerKey: 'ops4',
      approverKey: 'ops2',
      approvalStatus: 'approved',
      approvalRequired: false,
      expiryDate: atFromNow(24 * 180),
      renewalDate: atFromNow(24 * 150),
      estimatedCost: 22000,
      notes: 'Assigned to database and analytics assets.',
      assets: ['payments-db', 'reporting-db', 'etl-engine'],
      services: ['analytics', 'billing'],
    },
    {
      key: 'messaging-suite',
      name: 'Demo Messaging Suite',
      description: 'Email and notification licenses.',
      supplierKey: 'cloud',
      ownerKey: 'ops1',
      maintainerKey: 'ops4',
      approverKey: 'ops2',
      approvalStatus: 'approved',
      approvalRequired: true,
      expiryDate: atFromNow(24 * 45),
      renewalDate: atFromNow(24 * 20),
      estimatedCost: 12000,
      notes: 'Assigned to the messaging stack.',
      assets: ['email-worker'],
      services: ['mailing'],
    },
    {
      key: 'vpn-security',
      name: 'Demo VPN Security',
      description: 'Security and connectivity licenses for remote access.',
      supplierKey: 'security',
      ownerKey: 'ops4',
      maintainerKey: 'ops1',
      approverKey: 'ops3',
      approvalStatus: 'pending',
      approvalRequired: true,
      expiryDate: atFromNow(24 * 75),
      renewalDate: atFromNow(24 * 40),
      estimatedCost: 7000,
      notes: 'Used for VPN infrastructure testing.',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
    },
  ];

  const assetsDef = [
    { key: 'portal-web', name: 'Demo Portal Web', category: 'application', criticality: 'high', status: 'operational', desc: 'Frontend portal', owner: 'group', user_targets: ['demo.1', 'demo.3'] },
    { key: 'portal-api', name: 'Demo Portal API', category: 'api', criticality: 'high', status: 'degraded', desc: 'Public API layer', owner: 'group', user_targets: ['demo.1', 'demo.2'] },
    { key: 'auth-service', name: 'Demo Auth Service', category: 'application', criticality: 'critical', status: 'operational', desc: 'Authentication backend', owner: 'user', user_targets: ['demo.2'] },
    { key: 'payments-db', name: 'Demo Payments DB', category: 'database', criticality: 'critical', status: 'operational', desc: 'Payment database', owner: 'user', user_targets: ['demo.1', 'demo.4'] },
    { key: 'reporting-db', name: 'Demo Reporting DB', category: 'database', criticality: 'medium', status: 'operational', desc: 'Reporting data mart', owner: 'group', user_targets: ['demo.3'] },
    { key: 'edge-lb', name: 'Demo Edge Load Balancer', category: 'infrastructure', criticality: 'high', status: 'operational', desc: 'Ingress traffic balancer', owner: 'group', user_targets: ['demo.1', 'demo.2'] },
    { key: 'redis-cache', name: 'Demo Redis Cache', category: 'infrastructure', criticality: 'medium', status: 'degraded', desc: 'Session and cache layer', owner: 'group', user_targets: ['demo.2', 'demo.3'] },
    { key: 'vpn-gateway', name: 'Demo VPN Gateway', category: 'network', criticality: 'medium', status: 'operational', desc: 'Remote office VPN', owner: 'user', user_targets: ['demo.4'] },
    { key: 'etl-engine', name: 'Demo ETL Engine', category: 'application', criticality: 'low', status: 'operational', desc: 'Nightly ETL process', owner: 'user', user_targets: ['demo.3', 'demo.4'] },
    { key: 'email-worker', name: 'Demo Email Worker', category: 'application', criticality: 'low', status: 'major_outage', desc: 'Notification sender worker', owner: 'group', user_targets: ['demo.1', 'demo.4'] },
    { key: 'collab-hub', name: 'Demo Collaboration Hub', category: 'application', criticality: 'medium', status: 'operational', desc: 'Shared collaboration workspace', owner: 'group', user_targets: ['demo.1', 'demo.2', 'demo.3', 'demo.4'] },
    { key: 'ops-dashboard', name: 'Demo Operations Dashboard', category: 'dashboard', criticality: 'medium', status: 'operational', desc: 'Operations command dashboard', owner: 'user', user_targets: ['demo.1', 'demo.2'] },
  ];

  const assetDependenciesDef = [
    ['portal-web', 'portal-api'],
    ['portal-api', 'auth-service'],
    ['portal-api', 'payments-db'],
    ['analytics-etl', 'reporting-db'],
    ['email-worker', 'portal-api'],
  ];

  const servicesDef = [
    { key: 'customer-portal', name: 'Demo Customer Portal', criticality: 'high', status: 'degraded', is_public: true, assets: ['portal-web', 'portal-api', 'edge-lb', 'redis-cache', 'collab-hub'], owner: 'group', user_targets: ['demo.1', 'demo.3', 'demo.4'] },
    { key: 'identity', name: 'Demo Identity Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['auth-service', 'redis-cache', 'ops-dashboard'], owner: 'user', user_targets: ['demo.2', 'demo.3'] },
    { key: 'billing', name: 'Demo Billing Service', criticality: 'critical', status: 'operational', is_public: true, assets: ['portal-api', 'payments-db', 'ops-dashboard'], owner: 'user', user_targets: ['demo.1', 'demo.4'] },
    { key: 'analytics', name: 'Demo Analytics', criticality: 'medium', status: 'operational', is_public: false, assets: ['etl-engine', 'reporting-db', 'collab-hub'], owner: 'group', user_targets: ['demo.3', 'demo.4'] },
    { key: 'internal-vpn', name: 'Demo Internal VPN', criticality: 'medium', status: 'operational', is_public: false, assets: ['vpn-gateway'], owner: 'group', user_targets: ['demo.4'] },
    { key: 'mailing', name: 'Demo Mailing', criticality: 'low', status: 'major_outage', is_public: true, assets: ['email-worker', 'collab-hub'], owner: 'group', user_targets: ['demo.1', 'demo.4'] },
  ];

  const serviceDependenciesDef = [
    ['customer-portal', 'identity'],
    ['customer-portal', 'billing'],
    ['analytics', 'billing'],
    ['mailing', 'customer-portal'],
  ];

  const assetProbesDef = [
    {
      key: 'portal-web-probe',
      assetKey: 'portal-web',
      name: 'Primary HTTPS check',
      probe_type: 'https',
      probe_target: 'https://example.com',
      expected_status_code: 200,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 300,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-1),
      result: { success: true, response_time_ms: 118, status_code: 200, error_message: null, ssl_cert_expiry: '2030-12-31T00:00:00.000Z', dns_response: null },
    },
    {
      key: 'portal-api-probe',
      assetKey: 'portal-api',
      name: 'DNS reachability',
      probe_type: 'dns',
      probe_target: 'example.com',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: '93.184.216.34',
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 600,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-2),
      result: { success: true, response_time_ms: 84, status_code: null, error_message: null, ssl_cert_expiry: null, dns_response: '93.184.216.34' },
    },
    {
      key: 'email-worker-probe',
      assetKey: 'email-worker',
      name: 'TCP port check',
      probe_type: 'tcp',
      probe_target: 'example.com:443',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 600,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-3),
      result: { success: true, response_time_ms: 42, status_code: null, error_message: null, ssl_cert_expiry: null, dns_response: null },
    },
    {
      key: 'vpn-gateway-probe',
      assetKey: 'vpn-gateway',
      name: 'TLS certificate check',
      probe_type: 'tls',
      probe_target: 'example.com:443',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 900,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-4),
      result: { success: true, response_time_ms: 132, status_code: null, error_message: null, ssl_cert_expiry: '2030-12-31T00:00:00.000Z', dns_response: null },
    },
  ];

  const serviceProbesDef = [
    {
      key: 'customer-portal-probe',
      serviceKey: 'customer-portal',
      name: 'Public HTTPS probe',
      probe_type: 'https',
      probe_target: 'https://example.com',
      expected_status_code: 200,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 300,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-1),
      result: { success: true, response_time_ms: 109, status_code: 200, error_message: null, ssl_cert_expiry: '2030-12-31T00:00:00.000Z', dns_response: null },
    },
    {
      key: 'identity-probe',
      serviceKey: 'identity',
      name: 'Identity DNS probe',
      probe_type: 'dns',
      probe_target: 'example.com',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: '93.184.216.34',
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 600,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-2),
      result: { success: true, response_time_ms: 79, status_code: null, error_message: null, ssl_cert_expiry: null, dns_response: '93.184.216.34' },
    },
    {
      key: 'billing-probe',
      serviceKey: 'billing',
      name: 'Billing TCP probe',
      probe_type: 'tcp',
      probe_target: 'example.com:443',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 600,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-3),
      result: { success: true, response_time_ms: 45, status_code: null, error_message: null, ssl_cert_expiry: null, dns_response: null },
    },
    {
      key: 'mailing-probe',
      serviceKey: 'mailing',
      name: 'Mailing TLS probe',
      probe_type: 'tls',
      probe_target: 'example.com:443',
      expected_status_code: null,
      dns_record_type: 'A',
      dns_expected_value: null,
      ssl_expiry_warning_days: 30,
      probe_interval_seconds: 900,
      probe_timeout_seconds: 10,
      failure_threshold: 2,
      recovery_threshold: 2,
      pause_during_maintenance: true,
      legacy_slot: true,
      current_state: 'operational',
      next_probe_at: atFromNow(24),
      last_probed_at: atFromNow(-4),
      result: { success: true, response_time_ms: 121, status_code: null, error_message: null, ssl_cert_expiry: '2030-12-31T00:00:00.000Z', dns_response: null },
    },
  ];

  const maintDef = [
    {
      key: 'db-upgrade',
      title: 'DEMO - Payments DB minor upgrade',
      type: 'upgrade',
      status: 'scheduled',
      impact_level: 'high',
      scheduled_start: atCurrentMonth(5, 9, 0),
      scheduled_end: atCurrentMonth(5, 11, 0),
      actual_start: null,
      actual_end: null,
      reopened_at: null,
      reopen_reason: null,
      note: 'Planned maintenance for schema optimization',
      assets: ['payments-db'],
      services: ['billing'],
    },
    {
      key: 'cache-restart',
      title: 'DEMO - Cache cluster rolling restart',
      type: 'infrastructure',
      status: 'in_progress',
      impact_level: 'medium',
      scheduled_start: atCurrentMonth(12, 8, 0),
      scheduled_end: atCurrentMonth(12, 12, 0),
      actual_start: atCurrentMonth(12, 8, 30),
      actual_end: null,
      reopened_at: null,
      reopen_reason: null,
      note: 'Rolling restart in progress',
      assets: ['redis-cache'],
      services: ['customer-portal', 'identity'],
    },
    {
      key: 'mail-hotfix',
      title: 'DEMO - Email worker hotfix',
      type: 'emergency',
      status: 'in_progress',
      impact_level: 'high',
      scheduled_start: atCurrentMonth(18, 14, 0),
      scheduled_end: atCurrentMonth(18, 16, 0),
      actual_start: atCurrentMonth(18, 14, 15),
      actual_end: atCurrentMonth(18, 15, 0),
      reopened_at: atCurrentMonth(19, 9, 30),
      reopen_reason: 'Recurring SMTP timeout after previous fix',
      note: 'Reopened for additional patching',
      assets: ['email-worker'],
      services: ['mailing'],
    },
    {
      key: 'api-failover',
      title: 'DEMO - API failover validation',
      type: 'infrastructure',
      status: 'in_progress',
      impact_level: 'medium',
      scheduled_start: atCurrentMonth(20, 13, 0),
      scheduled_end: atCurrentMonth(20, 15, 0),
      actual_start: atCurrentMonth(20, 13, 20),
      actual_end: null,
      reopened_at: null,
      reopen_reason: null,
      note: 'Active demo maintenance for status page visibility',
      assets: ['portal-api', 'auth-service'],
      services: ['customer-portal', 'identity'],
    },
    {
      key: 'vpn-health',
      title: 'DEMO - VPN certificate rotation',
      type: 'security_patch',
      status: 'completed',
      impact_level: 'low',
      scheduled_start: atCurrentMonth(24, 10, 0),
      scheduled_end: atCurrentMonth(24, 11, 30),
      actual_start: atCurrentMonth(24, 10, 15),
      actual_end: atCurrentMonth(24, 11, 15),
      reopened_at: null,
      reopen_reason: null,
      note: 'Completed without incidents',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
    },
    {
      key: 'legacy-platform-2025',
      title: 'DEMO - Legacy platform migration',
      type: 'upgrade',
      status: 'completed',
      impact_level: 'medium',
      scheduled_start: atYearMonthDay(2025, 4, 14, 21, 0),
      scheduled_end: atYearMonthDay(2025, 4, 14, 23, 0),
      actual_start: atYearMonthDay(2025, 4, 14, 21, 10),
      actual_end: atYearMonthDay(2025, 4, 14, 22, 30),
      reopened_at: null,
      reopen_reason: null,
      note: 'Historical demo maintenance for 2025',
      assets: ['portal-web', 'portal-api'],
      services: ['customer-portal'],
    },
    {
      key: 'core-db-2024',
      title: 'DEMO - Core database hardening',
      type: 'security_patch',
      status: 'completed',
      impact_level: 'high',
      scheduled_start: atYearMonthDay(2024, 10, 2, 22, 0),
      scheduled_end: atYearMonthDay(2024, 10, 3, 1, 0),
      actual_start: atYearMonthDay(2024, 10, 2, 22, 15),
      actual_end: atYearMonthDay(2024, 10, 3, 0, 45),
      reopened_at: null,
      reopen_reason: null,
      note: 'Historical demo maintenance for 2024',
      assets: ['payments-db', 'reporting-db'],
      services: ['billing', 'analytics'],
    },
  ];

  const incidentsDef = [
    {
      key: 'portal-latency',
      title: 'DEMO - Elevated latency on customer portal',
      severity: 'high',
      status: 'investigating',
      started_at: atFromNow(-3),
      resolved_at: null,
      description: 'Latency spike detected by synthetic probes.',
      assets: ['portal-api', 'redis-cache'],
      services: ['customer-portal'],
      updates: [
        { status: 'investigating', message: 'Engineers are collecting telemetry.' },
        { status: 'identified', message: 'Cache saturation identified, applying mitigation.' },
      ],
    },
    {
      key: 'mail-delays',
      title: 'DEMO - Delayed outbound notifications',
      severity: 'medium',
      status: 'monitoring',
      started_at: atFromNow(-14),
      resolved_at: null,
      description: 'Email queue backlog during SMTP provider instability.',
      assets: ['email-worker'],
      services: ['mailing'],
      updates: [
        { status: 'investigating', message: 'SMTP endpoint intermittently timing out.' },
        { status: 'monitoring', message: 'Retry policy tuned and queue draining.' },
      ],
    },
    {
      key: 'vpn-outage',
      title: 'DEMO - Temporary VPN disruption',
      severity: 'low',
      status: 'resolved',
      started_at: atFromNow(-48),
      resolved_at: atFromNow(-46),
      description: 'Brief disruption during certificate rollover.',
      assets: ['vpn-gateway'],
      services: ['internal-vpn'],
      updates: [
        { status: 'investigating', message: 'Root cause isolated to expired intermediate cert.' },
        { status: 'resolved', message: 'Certificate chain updated and service restored.' },
      ],
    },
  ];

  const extraIncidentsDef = [
    { key: 'dns-slowness', title: 'DEMO - DNS resolution slowness', severity: 'low', status: 'resolved', started_at: atFromNow(-7), resolved_at: atFromNow(-6), description: 'Intermittent DNS delays.', assets: ['edge-lb'], services: ['customer-portal'], updates: [{ status: 'investigating', message: 'Name server latency observed.' }, { status: 'resolved', message: 'Resolver cache warmed and verified.' }] },
    { key: 'api-errors', title: 'DEMO - API 500 spike', severity: 'high', status: 'monitoring', started_at: atFromNow(-11), resolved_at: null, description: 'Spikes on the public API.', assets: ['portal-api'], services: ['customer-portal', 'billing'], updates: [{ status: 'investigating', message: 'Rolling back last deploy.' }, { status: 'monitoring', message: 'Error rate dropped after rollback.' }] },
    { key: 'queue-backlog', title: 'DEMO - Queue backlog growth', severity: 'medium', status: 'monitoring', started_at: atFromNow(-16), resolved_at: null, description: 'Notification queue is slower than usual.', assets: ['email-worker'], services: ['mailing'], updates: [{ status: 'investigating', message: 'Workers restarted to clear backlog.' }, { status: 'monitoring', message: 'Queue depth is decreasing.' }] },
    { key: 'storage-io', title: 'DEMO - Storage IO spike', severity: 'medium', status: 'investigating', started_at: atFromNow(-21), resolved_at: null, description: 'High IO on database volumes.', assets: ['payments-db'], services: ['billing'], updates: [{ status: 'investigating', message: 'IOPS threshold exceeded.' }] },
    { key: 'auth-logins', title: 'DEMO - Intermittent auth login failures', severity: 'critical', status: 'resolved', started_at: atFromNow(-33), resolved_at: atFromNow(-31), description: 'Login errors on identity flow.', assets: ['auth-service', 'redis-cache'], services: ['identity'], updates: [{ status: 'investigating', message: 'Token cache stale entries found.' }, { status: 'resolved', message: 'Cache cleared and auth flow restored.' }] },
    { key: 'vpn-loss', title: 'DEMO - Packet loss on VPN', severity: 'low', status: 'resolved', started_at: atFromNow(-44), resolved_at: atFromNow(-43), description: 'Packet loss on branch gateway.', assets: ['vpn-gateway'], services: ['internal-vpn'], updates: [{ status: 'investigating', message: 'WAN provider route instability.' }, { status: 'resolved', message: 'Failover route is stable.' }] },
    { key: 'etl-lag', title: 'DEMO - ETL lag detected', severity: 'medium', status: 'monitoring', started_at: atFromNow(-61), resolved_at: null, description: 'Nightly ETL is behind schedule.', assets: ['etl-engine', 'reporting-db'], services: ['analytics'], updates: [{ status: 'investigating', message: 'Large input batch delayed the job.' }, { status: 'monitoring', message: 'Processing is catching up.' }] },
    { key: 'portal-timeout', title: 'DEMO - Portal timeout burst', severity: 'high', status: 'resolved', started_at: atFromNow(-75), resolved_at: atFromNow(-74), description: 'Timeouts on the customer portal.', assets: ['portal-web', 'portal-api'], services: ['customer-portal'], updates: [{ status: 'investigating', message: 'Application pool recycle in progress.' }, { status: 'resolved', message: 'Recycle completed and timeouts stopped.' }] },
    { key: 'mail-throttle', title: 'DEMO - SMTP throttling alert', severity: 'medium', status: 'monitoring', started_at: atFromNow(-88), resolved_at: null, description: 'Provider is throttling outbound mail.', assets: ['email-worker'], services: ['mailing'], updates: [{ status: 'investigating', message: 'SMTP retries increased.' }, { status: 'monitoring', message: 'Queue is being drained slowly.' }] },
  ];

  const allIncidentsDef = [...incidentsDef, ...extraIncidentsDef];

  const blackoutsDef = [
    { key: 'blackout-current', name: 'DEMO - Current release freeze', start_date: atCurrentMonth(19, 0, 0).slice(0, 10), end_date: atCurrentMonth(21, 23, 59).slice(0, 10), description: 'Current demo blackout window.' },
    { key: 'blackout-upcoming', name: 'DEMO - Upcoming platform freeze', start_date: atCurrentMonth(27, 0, 0).slice(0, 10), end_date: atCurrentMonth(28, 23, 59).slice(0, 10), description: 'Upcoming blackout for next release.' },
    { key: 'blackout-2025-a', name: 'DEMO - 2025 Q4 change freeze', start_date: atYearMonthDay(2025, 9, 10, 0, 0).slice(0, 10), end_date: atYearMonthDay(2025, 9, 12, 23, 59).slice(0, 10), description: 'Historic blackout 2025.' },
    { key: 'blackout-2025-b', name: 'DEMO - 2025 Black Friday freeze', start_date: atYearMonthDay(2025, 10, 24, 0, 0).slice(0, 10), end_date: atYearMonthDay(2025, 10, 29, 23, 59).slice(0, 10), description: 'Historic blackout 2025.' },
    { key: 'blackout-2025-c', name: 'DEMO - 2025 year-end freeze', start_date: atYearMonthDay(2025, 11, 22, 0, 0).slice(0, 10), end_date: atYearMonthDay(2025, 11, 31, 23, 59).slice(0, 10), description: 'Historic blackout 2025.' },
    { key: 'blackout-2024-a', name: 'DEMO - 2024 summer freeze', start_date: atYearMonthDay(2024, 6, 8, 0, 0).slice(0, 10), end_date: atYearMonthDay(2024, 6, 10, 23, 59).slice(0, 10), description: 'Historic blackout 2024.' },
    { key: 'blackout-2024-b', name: 'DEMO - 2024 autumn freeze', start_date: atYearMonthDay(2024, 8, 14, 0, 0).slice(0, 10), end_date: atYearMonthDay(2024, 8, 16, 23, 59).slice(0, 10), description: 'Historic blackout 2024.' },
    { key: 'blackout-2024-c', name: 'DEMO - 2024 winter freeze', start_date: atYearMonthDay(2024, 11, 5, 0, 0).slice(0, 10), end_date: atYearMonthDay(2024, 11, 8, 23, 59).slice(0, 10), description: 'Historic blackout 2024.' },
    { key: 'blackout-2024-d', name: 'DEMO - 2024 patch freeze', start_date: atYearMonthDay(2024, 3, 3, 0, 0).slice(0, 10), end_date: atYearMonthDay(2024, 3, 5, 23, 59).slice(0, 10), description: 'Historic blackout 2024.' },
    { key: 'blackout-2023-a', name: 'DEMO - 2023 spring freeze', start_date: atYearMonthDay(2023, 3, 2, 0, 0).slice(0, 10), end_date: atYearMonthDay(2023, 3, 4, 23, 59).slice(0, 10), description: 'Historic blackout 2023.' },
    { key: 'blackout-2023-b', name: 'DEMO - 2023 autumn freeze', start_date: atYearMonthDay(2023, 9, 11, 0, 0).slice(0, 10), end_date: atYearMonthDay(2023, 9, 13, 23, 59).slice(0, 10), description: 'Historic blackout 2023.' },
    { key: 'blackout-2022-a', name: 'DEMO - 2022 maintenance freeze', start_date: atYearMonthDay(2022, 5, 6, 0, 0).slice(0, 10), end_date: atYearMonthDay(2022, 5, 8, 23, 59).slice(0, 10), description: 'Historic blackout 2022.' },
  ];

  const created = await transaction(async (client) => {
    const usersByKey = new Map();
    const assetsByKey = new Map();
    const servicesByKey = new Map();
    const maintenanceByKey = new Map();
    const incidentsByKey = new Map();
    const supplierIds = [];
    const supplierByKey = new Map();
    const licenseIds = [];
    const probeIds = [];
    const blackoutIds = [];

    const g = await client.query(
      `INSERT INTO local_groups (name, description, permissions, role)
       VALUES ($1,$2,'{}'::jsonb,'viewer')
       RETURNING id`,
      [`Demo Ops ${tag}`, 'Demo local group for seed data management and notification tests']
    );
    const demoGroupId = g.rows[0].id;

    for (const u of localUsersDef) {
      const r = await client.query(
        `INSERT INTO users (username, display_name, email, office, auth_type, role, permissions, is_active)
         VALUES ($1,$2,$3,$4,'local',$5,'{}'::jsonb,true)
         RETURNING id`,
        [u.username, u.display_name, demoEmail, u.office, u.role]
      );
      const uid = r.rows[0].id;
      usersByKey.set(u.key, uid);
      await client.query(`INSERT INTO user_group_members (user_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, demoGroupId]);
    }

    for (const s of suppliersDef) {
      const r = await client.query(
        `INSERT INTO suppliers (first_name, last_name, company, email, is_active)
         VALUES ($1,$2,$3,$4,true)
         RETURNING id`,
        [s.first, s.last, s.company, demoEmail]
      );
      const sid = r.rows[0].id;
      supplierIds.push(sid);
      supplierByKey.set(s.key, { id: sid, company: s.company });
    }

    for (const a of assetsDef) {
      const ownerUser = usersByKey.get('ops1') || null;
      const ownerType = a.owner === 'group' ? 'local_group' : 'user';
      const ownerGroupId = ownerType === 'local_group' ? demoGroupId : null;
      const ownerId = ownerType === 'user' ? ownerUser : null;
      const userTargets = (Array.isArray(a.user_targets) ? a.user_targets : []).map((key) => {
        const uid = usersByKey.get(key);
        return uid ? { type: 'user', id: uid } : null;
      }).filter(Boolean);
      const r = await client.query(
        `INSERT INTO assets (name, slug, category, criticality, description, status, owner_id, owner_type, owner_group_id, user_targets, is_active, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,true,$11::jsonb)
         RETURNING id`,
        [a.name, `demo-${a.key}-${tag}`, a.category, a.criticality, a.desc, a.status, ownerId, ownerType, ownerGroupId, JSON.stringify(userTargets), JSON.stringify({ demo_seed: true, demo_tag: tag })]
      );
      assetsByKey.set(a.key, r.rows[0].id);
    }

    for (const dep of assetDependenciesDef) {
      const aid = assetsByKey.get(dep[0]);
      const did = assetsByKey.get(dep[1]);
      if (aid && did) {
        await client.query(`INSERT INTO asset_dependencies (asset_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [aid, did]);
      }
    }

    for (const s of servicesDef) {
      const ownerType = s.owner === 'group' ? 'local_group' : 'user';
      const ownerGroupId = ownerType === 'local_group' ? demoGroupId : null;
      const ownerId = ownerType === 'user' ? (usersByKey.get('ops2') || null) : null;
      const userTargets = (Array.isArray(s.user_targets) ? s.user_targets : []).map((key) => {
        const uid = usersByKey.get(key);
        return uid ? { type: 'user', id: uid } : null;
      }).filter(Boolean);
      const r = await client.query(
        `INSERT INTO services (name, slug, description, criticality, status, sla_uptime_percent, is_public, owner_id, owner_type, owner_group_id, user_targets, is_active)
         VALUES ($1,$2,$3,$4,$5,99.90,$6,$7,$8,$9,$10::jsonb,true)
         RETURNING id`,
        [s.name, `demo-${s.key}-${tag}`, `Demo service for ${s.name}`, s.criticality, s.status, !!s.is_public, ownerId, ownerType, ownerGroupId, JSON.stringify(userTargets)]
      );
      const sid = r.rows[0].id;
      servicesByKey.set(s.key, sid);
      for (const ak of s.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) {
          await client.query(`INSERT INTO service_assets (service_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sid, aid]);
        }
      }
      for (const uid of usersByKey.values()) {
        await client.query(
          `INSERT INTO service_subscribers (service_id, user_id, email, notify_maintenance, notify_incidents, notify_recovery)
           VALUES ($1,$2,$3,true,true,true)
           ON CONFLICT DO NOTHING`,
          [sid, uid, demoEmail]
        );
      }
    }

    for (const dep of serviceDependenciesDef) {
      const sid = servicesByKey.get(dep[0]);
      const did = servicesByKey.get(dep[1]);
      if (sid && did) {
        await client.query(`INSERT INTO service_dependencies (service_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [sid, did]);
      }
    }

    for (const p of assetProbesDef) {
      const assetId = assetsByKey.get(p.assetKey);
      if (!assetId) continue;
      const r = await client.query(
        `INSERT INTO asset_probes
          (asset_id, name, probe_enabled, probe_type, probe_target, probe_interval_seconds, probe_timeout_seconds, expected_status_code,
           failure_threshold, recovery_threshold, pause_during_maintenance, dns_record_type, dns_expected_value, ssl_expiry_warning_days,
           legacy_slot, last_probed_at, next_probe_at, consecutive_failures, consecutive_successes, current_state)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,0,1,$16)
         RETURNING id`,
        [
          assetId,
          p.name,
          p.probe_type,
          p.probe_target,
          p.probe_interval_seconds,
          p.probe_timeout_seconds,
          p.expected_status_code,
          p.failure_threshold,
          p.recovery_threshold,
          p.pause_during_maintenance,
          p.dns_record_type,
          p.dns_expected_value,
          p.ssl_expiry_warning_days,
          p.last_probed_at,
          p.next_probe_at,
          p.current_state,
        ]
      );
      const probeId = r.rows[0].id;
      probeIds.push(probeId);
      const pr = p.result || {};
      await client.query(
        `INSERT INTO probe_results (asset_id, probe_id, success, response_time_ms, status_code, error_message, ssl_cert_expiry, dns_response, probed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [assetId, probeId, !!pr.success, pr.response_time_ms ?? null, pr.status_code ?? null, pr.error_message ?? null, pr.ssl_cert_expiry ?? null, pr.dns_response ?? null, p.last_probed_at]
      );
    }

    for (const p of serviceProbesDef) {
      const serviceId = servicesByKey.get(p.serviceKey);
      if (!serviceId) continue;
      const r = await client.query(
        `INSERT INTO service_probes
          (service_id, name, probe_enabled, probe_type, probe_target, probe_interval_seconds, probe_timeout_seconds, expected_status_code,
           failure_threshold, recovery_threshold, pause_during_maintenance, dns_record_type, dns_expected_value, ssl_expiry_warning_days,
           legacy_slot, last_probed_at, next_probe_at, consecutive_failures, consecutive_successes, current_state)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,0,1,$16)
         RETURNING id`,
        [
          serviceId,
          p.name,
          p.probe_type,
          p.probe_target,
          p.probe_interval_seconds,
          p.probe_timeout_seconds,
          p.expected_status_code,
          p.failure_threshold,
          p.recovery_threshold,
          p.pause_during_maintenance,
          p.dns_record_type,
          p.dns_expected_value,
          p.ssl_expiry_warning_days,
          p.last_probed_at,
          p.next_probe_at,
          p.current_state,
        ]
      );
      const probeId = r.rows[0].id;
      probeIds.push(probeId);
      const pr = p.result || {};
      await client.query(
        `INSERT INTO service_probe_results (service_id, probe_id, success, response_time_ms, status_code, error_message, ssl_cert_expiry, dns_response, probed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [serviceId, probeId, !!pr.success, pr.response_time_ms ?? null, pr.status_code ?? null, pr.error_message ?? null, pr.ssl_cert_expiry ?? null, pr.dns_response ?? null, p.last_probed_at]
      );
    }

    for (const l of licensesDef) {
      const ownerUserId = usersByKey.get(l.ownerKey) || null;
      const maintainerUserId = usersByKey.get(l.maintainerKey) || null;
      const approverUserId = usersByKey.get(l.approverKey) || null;
      const supplierEntry = supplierByKey.get(l.supplierKey) || null;
      const supplierId = supplierEntry?.id || null;
      const supplierName = supplierEntry?.company || null;
      const approvalRequired = l.approvalRequired !== false;
      const approvalStatus = l.approvalStatus || 'pending';
      const approvedAt = approvalStatus === 'approved' ? atFromNow(-48) : null;
      const approvedBy = approvalStatus === 'approved' ? approverUserId : null;
      const r = await client.query(
        `INSERT INTO licenses
          (name, description, owner_user_id, supplier, supplier_id, maintainer_user_id, approver_user_id, expiry_date, renewal_date, reminder_days, approval_required, approval_status, estimated_cost, currency, notes, documents, is_active, created_by, approved_at, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'[]'::jsonb,true,$16,$17,$18)
         RETURNING id`,
        [
          l.name,
          l.description,
          ownerUserId,
          supplierName,
          supplierId,
          maintainerUserId,
          approverUserId,
          l.expiryDate,
          l.renewalDate,
          30,
          approvalRequired,
          approvalStatus,
          l.estimatedCost,
          'EUR',
          l.notes,
          req.user.id,
          approvedAt,
          approvedBy,
        ]
      );
      const lid = r.rows[0].id;
      licenseIds.push(lid);

      for (const ak of l.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) {
          await client.query(`INSERT INTO license_assets (license_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [lid, aid]);
        }
      }

      for (const sk of l.services) {
        const sid = servicesByKey.get(sk);
        if (sid) {
          await client.query(`INSERT INTO license_services (license_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [lid, sid]);
        }
      }
    }

    for (const m of maintDef) {
      const r = await client.query(
        `INSERT INTO maintenance_windows
          (title, description, type, status, impact_level, scheduled_start, scheduled_end, actual_start, actual_end, created_by, notes, approved_at, reopened_at, reopen_reason, owner_approval_required, owner_approval_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,'not_required')
         RETURNING id`,
        [m.title, `Demo maintenance: ${m.title}`, m.type, m.status, m.impact_level, m.scheduled_start, m.scheduled_end, m.actual_start, m.actual_end, req.user.id, m.note, m.status !== 'scheduled' ? m.scheduled_start : null, m.reopened_at, m.reopen_reason]
      );
      const mid = r.rows[0].id;
      maintenanceByKey.set(m.key, mid);

      for (const ak of m.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) await client.query(`INSERT INTO maintenance_assets (maintenance_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, aid]);
      }
      for (const sk of m.services) {
        const sid = servicesByKey.get(sk);
        if (sid) await client.query(`INSERT INTO maintenance_services (maintenance_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, sid]);
      }
      for (const uid of usersByKey.values()) {
        await client.query(`INSERT INTO maintenance_status_subscribers (maintenance_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [mid, uid]);
      }

      await client.query(
        `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
         VALUES ('maintenance',$1,'scheduled',$2,$3)`,
        [mid, req.user.username || req.user.id || 'system', 'Demo maintenance scheduled']
      ).catch(() => {});
      if (m.status === 'in_progress' || m.status === 'completed') {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'in_progress',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', 'Demo maintenance started']
        ).catch(() => {});
      }
      if (m.status === 'completed') {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'completed',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', 'Demo maintenance completed']
        ).catch(() => {});
      }
      if (m.reopened_at) {
        await client.query(
          `INSERT INTO status_history (entity_type, entity_id, status, changed_by, reason)
           VALUES ('maintenance',$1,'reopened',$2,$3)`,
          [mid, req.user.username || req.user.id || 'system', m.reopen_reason || 'Demo maintenance reopened']
        ).catch(() => {});
      }
    }

    for (const i of allIncidentsDef) {
      const r = await client.query(
        `INSERT INTO incidents (title, description, severity, status, started_at, resolved_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [i.title, i.description, i.severity, i.status, i.started_at, i.resolved_at, req.user.id]
      );
      const iid = r.rows[0].id;
      incidentsByKey.set(i.key, iid);

      for (const ak of i.assets) {
        const aid = assetsByKey.get(ak);
        if (aid) await client.query(`INSERT INTO incident_assets (incident_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [iid, aid]);
      }
      for (const sk of i.services) {
        const sid = servicesByKey.get(sk);
        if (sid) await client.query(`INSERT INTO incident_services (incident_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [iid, sid]);
      }
      for (const up of i.updates) {
        await client.query(
          `INSERT INTO incident_updates (incident_id, status, message, created_by)
           VALUES ($1,$2,$3,$4)`,
          [iid, up.status, up.message, req.user.id]
        );
      }
    }

    for (const b of blackoutsDef) {
      const r = await client.query(
        `INSERT INTO blackout_periods (name, description, start_date, end_date, created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [b.name, b.description, b.start_date, b.end_date, req.user.id]
      );
      blackoutIds.push(r.rows[0].id);
    }

    const registry = {
      asset_ids: Array.from(assetsByKey.values()),
      service_ids: Array.from(servicesByKey.values()),
      maintenance_ids: Array.from(maintenanceByKey.values()),
      incident_ids: Array.from(incidentsByKey.values()),
      blackout_ids: blackoutIds,
      supplier_ids: supplierIds,
      license_ids: licenseIds,
      probe_ids: probeIds,
      local_user_ids: Array.from(usersByKey.values()),
      local_group_ids: [demoGroupId],
      asset_dependency_count: assetDependenciesDef.filter(d => assetsByKey.get(d[0]) && assetsByKey.get(d[1])).length,
      service_dependency_count: serviceDependenciesDef.filter(d => servicesByKey.get(d[0]) && servicesByKey.get(d[1])).length,
      seeded_at: new Date().toISOString(),
      seeded_by: req.user.username || req.user.id || 'system',
      tag,
    };

    await client.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('demo_seed_registry', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify(registry)]
    );

    return registry;
  });

  await auditService.log(req.user.id, req.user.username, 'settings:demo_create', 'settings', 'demo_seed_registry', null, req.ip);
  res.status(201).json({
    message: 'Demo data created',
    counts: {
      assets: created.asset_ids.length,
      services: created.service_ids.length,
      maintenances: created.maintenance_ids.length,
      incidents: created.incident_ids.length,
      blackouts: created.blackout_ids.length,
      suppliers: created.supplier_ids.length,
      licenses: created.license_ids.length,
      probes: created.probe_ids.length,
      local_users: created.local_user_ids.length,
      local_groups: created.local_group_ids.length,
      asset_dependencies: created.asset_dependency_count,
      service_dependencies: created.service_dependency_count,
    },
    seeded_at: created.seeded_at,
  });
});

router.post('/demo/clear', requireAuth, requireSuperAdmin, async (req, res) => {
  const reg = await getDemoRegistry();
  if (!reg) {
    return res.json({
      message: 'No demo data to remove',
      removed: {
        assets: 0,
        services: 0,
        maintenances: 0,
        incidents: 0,
        blackouts: 0,
        suppliers: 0,
          licenses: 0,
          probes: 0,
        local_users: 0,
        local_groups: 0,
      },
    });
  }

  await transaction(async (client) => {
    if (reg.probe_ids.length > 0) {
      await client.query(`DELETE FROM asset_probes WHERE id = ANY($1::uuid[])`, [reg.probe_ids]);
      await client.query(`DELETE FROM service_probes WHERE id = ANY($1::uuid[])`, [reg.probe_ids]);
    }
    if (reg.license_ids.length > 0) {
      await client.query(`DELETE FROM licenses WHERE id = ANY($1::uuid[])`, [reg.license_ids]);
    }
    if (reg.incident_ids.length > 0) {
      await client.query(`DELETE FROM incidents WHERE id = ANY($1::uuid[])`, [reg.incident_ids]);
    }
    if (reg.blackout_ids && reg.blackout_ids.length > 0) {
      await client.query(`DELETE FROM blackout_periods WHERE id = ANY($1::uuid[])`, [reg.blackout_ids]);
    }
    if (reg.maintenance_ids.length > 0) {
      await client.query(`DELETE FROM status_history WHERE entity_type='maintenance' AND entity_id = ANY($1::uuid[])`, [reg.maintenance_ids]);
      await client.query(`DELETE FROM maintenance_windows WHERE id = ANY($1::uuid[])`, [reg.maintenance_ids]);
    }
    if (reg.service_ids.length > 0) {
      await client.query(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [reg.service_ids]);
    }
    if (reg.asset_ids.length > 0) {
      await client.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [reg.asset_ids]);
    }
    if (reg.supplier_ids.length > 0) {
      await client.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [reg.supplier_ids]);
    }
    if (reg.local_user_ids.length > 0) {
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [reg.local_user_ids]);
    }
    if (reg.local_group_ids.length > 0) {
      await client.query(`DELETE FROM local_groups WHERE id = ANY($1::uuid[])`, [reg.local_group_ids]);
    }
    await client.query(`DELETE FROM settings WHERE key='demo_seed_registry'`);
  });

  await auditService.log(req.user.id, req.user.username, 'settings:demo_clear', 'settings', 'demo_seed_registry', null, req.ip);
  res.json({
    message: 'Demo data removed',
    removed: {
      assets: reg.asset_ids.length,
      services: reg.service_ids.length,
      maintenances: reg.maintenance_ids.length,
      incidents: reg.incident_ids.length,
      blackouts: (reg.blackout_ids || []).length,
      suppliers: reg.supplier_ids.length,
      licenses: reg.license_ids.length,
      probes: reg.probe_ids.length,
      local_users: reg.local_user_ids.length,
      local_groups: reg.local_group_ids.length,
    },
  });
});

// ─── GET /api/settings/:key — generic fallback, must be LAST ─────────────────
router.get('/:key', requireAuth, requireAdmin, async (req, res) => {
  const sensitiveKeys = new Set(['ldap_config', 'saml_config', 'general_config']);
  if (sensitiveKeys.has(String(req.params.key || '')) && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin role required' });
  }

  const row = await getOne('SELECT value FROM settings WHERE key=$1', [req.params.key]);
  if (!row) return res.status(404).json({ error: 'Chiave non trovata' });
  try {
    const val = JSON.parse(row.value);
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        if ((k.includes('password') || k.includes('pass') || k.includes('secret')) && val[k]) {
          val[k] = '********';
        }
      }
    }
    res.json(val);
  } catch { res.json(row.value); }
});

module.exports = router;
