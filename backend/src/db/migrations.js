const logger = require('../utils/logger');

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: async (client) => {
      // Enable pgcrypto for UUID generation
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      // ─── USERS ───────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(100) UNIQUE NOT NULL,
          display_name VARCHAR(200),
          email VARCHAR(200),
          password_hash VARCHAR(255),
          role VARCHAR(50) NOT NULL DEFAULT 'viewer',
          auth_type VARCHAR(50) NOT NULL DEFAULT 'local',
          permissions JSONB NOT NULL DEFAULT '{}',
          totp_secret VARCHAR(255),
          totp_enabled BOOLEAN DEFAULT FALSE,
          totp_verified BOOLEAN DEFAULT FALSE,
          password_changed_at TIMESTAMPTZ DEFAULT NOW(),
          last_login_at TIMESTAMPTZ,
          failed_login_count INTEGER DEFAULT 0,
          locked_until TIMESTAMPTZ,
          avatar_color VARCHAR(20) DEFAULT '#6366f1',
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── LOCAL GROUPS ─────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS local_groups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) UNIQUE NOT NULL,
          description TEXT,
          permissions JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_group_members (
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          group_id UUID NOT NULL REFERENCES local_groups(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, group_id)
        )
      `);

      // ─── LDAP GROUP MAPPINGS ──────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS ldap_group_mappings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          ldap_group_dn TEXT NOT NULL,
          local_group_id UUID REFERENCES local_groups(id) ON DELETE SET NULL,
          role VARCHAR(50),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── USER SESSIONS ────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_jti VARCHAR(255) UNIQUE NOT NULL,
          ip_address VARCHAR(100),
          user_agent TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_jti ON user_sessions(token_jti)`);

      // ─── ASSETS ──────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS assets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          slug VARCHAR(200) UNIQUE NOT NULL,
          category VARCHAR(100) NOT NULL DEFAULT 'application',
          criticality VARCHAR(20) NOT NULL DEFAULT 'medium',
          description TEXT,
          owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'operational',
          probe_enabled BOOLEAN DEFAULT FALSE,
          probe_type VARCHAR(20),
          probe_url TEXT,
          probe_interval_seconds INTEGER DEFAULT 300,
          probe_timeout_seconds INTEGER DEFAULT 10,
          expected_status_code INTEGER DEFAULT 200,
          tags JSONB DEFAULT '[]',
          metadata JSONB DEFAULT '{}',
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)`);

      // ─── ASSET DEPENDENCIES ───────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS asset_dependencies (
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          depends_on_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (asset_id, depends_on_id)
        )
      `);

      // ─── SERVICES ────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS services (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          slug VARCHAR(200) UNIQUE NOT NULL,
          description TEXT,
          criticality VARCHAR(20) NOT NULL DEFAULT 'medium',
          owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'operational',
          sla_uptime_percent NUMERIC(5,2) DEFAULT 99.9,
          is_public BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS service_assets (
          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (service_id, asset_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS service_subscribers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          email VARCHAR(200),
          notify_maintenance BOOLEAN DEFAULT TRUE,
          notify_incidents BOOLEAN DEFAULT TRUE,
          notify_recovery BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_user ON service_subscribers(service_id, user_id) WHERE user_id IS NOT NULL`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_email ON service_subscribers(service_id, email) WHERE email IS NOT NULL`);

      // ─── MAINTENANCE TEMPLATES ────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          description TEXT,
          type VARCHAR(50) NOT NULL DEFAULT 'planned',
          impact_level VARCHAR(20) NOT NULL DEFAULT 'medium',
          duration_minutes INTEGER DEFAULT 60,
          checklist JSONB DEFAULT '[]',
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── MAINTENANCE WINDOWS ──────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_windows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(300) NOT NULL,
          description TEXT,
          type VARCHAR(50) NOT NULL DEFAULT 'planned',
          status VARCHAR(50) NOT NULL DEFAULT 'draft',
          impact_level VARCHAR(20) NOT NULL DEFAULT 'medium',
          scheduled_start TIMESTAMPTZ NOT NULL,
          scheduled_end TIMESTAMPTZ NOT NULL,
          actual_start TIMESTAMPTZ,
          actual_end TIMESTAMPTZ,
          recurrence_type VARCHAR(20) DEFAULT 'none',
          recurrence_cron VARCHAR(100),
          recurrence_end_date DATE,
          template_id UUID REFERENCES maintenance_templates(id) ON DELETE SET NULL,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
          approved_at TIMESTAMPTZ,
          rejection_reason TEXT,
          notes TEXT,
          reminders_sent JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_windows(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_scheduled ON maintenance_windows(scheduled_start, scheduled_end)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_assets (
          maintenance_id UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (maintenance_id, asset_id)
        )
      `);

      // ─── BLACKOUT PERIODS ─────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS blackout_periods (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          description TEXT,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── INCIDENTS ───────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS incidents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title VARCHAR(300) NOT NULL,
          description TEXT,
          severity VARCHAR(20) NOT NULL DEFAULT 'medium',
          status VARCHAR(50) NOT NULL DEFAULT 'investigating',
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS incident_assets (
          incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (incident_id, asset_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS incident_updates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
          status VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── NOTIFICATION TEMPLATES ───────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          event_type VARCHAR(100) NOT NULL UNIQUE,
          subject_template TEXT NOT NULL,
          body_html_template TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── NOTIFICATION LOG ─────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(100) NOT NULL,
          channel VARCHAR(50) NOT NULL,
          recipient VARCHAR(300),
          reference_type VARCHAR(50),
          reference_id UUID,
          subject TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          error_message TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_log_ref ON notification_log(reference_type, reference_id)`);

      // ─── IN-APP NOTIFICATIONS ─────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS in_app_notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type VARCHAR(100) NOT NULL,
          title VARCHAR(300) NOT NULL,
          message TEXT,
          reference_type VARCHAR(50),
          reference_id UUID,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_inapp_user ON in_app_notifications(user_id, is_read)`);

      // ─── STATUS HISTORY ───────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS status_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_type VARCHAR(20) NOT NULL,
          entity_id UUID NOT NULL,
          status VARCHAR(50) NOT NULL,
          changed_by VARCHAR(100) DEFAULT 'system',
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_status_hist ON status_history(entity_type, entity_id, created_at DESC)`);

      // ─── PROBE RESULTS ────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS probe_results (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          success BOOLEAN NOT NULL,
          response_time_ms INTEGER,
          status_code INTEGER,
          error_message TEXT,
          probed_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_probe_asset ON probe_results(asset_id, probed_at DESC)`);

      // ─── API KEYS ─────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          key_prefix VARCHAR(12) NOT NULL,
          key_hash VARCHAR(255) NOT NULL,
          permissions JSONB NOT NULL DEFAULT '{}',
          owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
          last_used_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ─── AUDIT LOG ────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          username VARCHAR(100),
          action VARCHAR(200) NOT NULL,
          entity_type VARCHAR(100),
          entity_id VARCHAR(200),
          details TEXT,
          ip_address VARCHAR(100),
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`);

      // ─── SETTINGS ─────────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(200) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    }
  },
  {
    version: 2,
    name: 'seed_notification_templates',
    up: async (client) => {
      const templates = [
        {
          event_type: 'maintenance_scheduled',
          name: 'Manutenzione Programmata',
          subject_template: '[{{impact_level}}] Manutenzione Programmata: {{title}}',
          body_html_template: `<h2>Manutenzione Programmata</h2>
<p>È stata programmata una manutenzione che potrebbe impattare i servizi che utilizzi.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Tipo</td><td style="padding:8px;border:1px solid #e5e7eb">{{type}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Impatto</td><td style="padding:8px;border:1px solid #e5e7eb">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Inizio</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Fine</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Descrizione</td><td style="padding:8px;border:1px solid #e5e7eb">{{description}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#4f46e5;color:white;padding:8px 16px;border-radius:4px;text-decoration:none">Visualizza Dettagli</a></p>`
        },
        {
          event_type: 'maintenance_reminder',
          name: 'Promemoria Manutenzione',
          subject_template: '[PROMEMORIA {{time_before}}] Manutenzione: {{title}}',
          body_html_template: `<h2>Promemoria Manutenzione</h2>
<p><strong>La manutenzione inizierà tra {{time_before}}.</strong></p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Inizio</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Fine</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#4f46e5;color:white;padding:8px 16px;border-radius:4px;text-decoration:none">Visualizza Dettagli</a></p>`
        },
        {
          event_type: 'maintenance_started',
          name: 'Manutenzione Iniziata',
          subject_template: '[IN CORSO] Manutenzione: {{title}}',
          body_html_template: `<h2 style="color:#d97706">⚠️ Manutenzione In Corso</h2>
<p>La manutenzione è iniziata. I servizi associati potrebbero essere temporaneamente non disponibili.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Inizio Effettivo</td><td style="padding:8px;border:1px solid #e5e7eb">{{actual_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Fine Prevista</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_completed',
          name: 'Manutenzione Completata',
          subject_template: '[COMPLETATA] Manutenzione: {{title}}',
          body_html_template: `<h2 style="color:#16a34a">✅ Manutenzione Completata</h2>
<p>La manutenzione è stata completata con successo. I servizi sono stati ripristinati.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Fine Effettiva</td><td style="padding:8px;border:1px solid #e5e7eb">{{actual_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Note</td><td style="padding:8px;border:1px solid #e5e7eb">{{notes}}</td></tr>
</table>`
        },
        {
          event_type: 'incident_created',
          name: 'Incidente Aperto',
          subject_template: '[INCIDENTE {{severity}}] {{title}}',
          body_html_template: `<h2 style="color:#dc2626">🚨 Nuovo Incidente</h2>
<p>È stato aperto un incidente che potrebbe impattare i servizi che utilizzi.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Severità</td><td style="padding:8px;border:1px solid #e5e7eb">{{severity}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Stato</td><td style="padding:8px;border:1px solid #e5e7eb">{{status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Descrizione</td><td style="padding:8px;border:1px solid #e5e7eb">{{description}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/incidents/{{id}}" style="background:#dc2626;color:white;padding:8px 16px;border-radius:4px;text-decoration:none">Visualizza Incidente</a></p>`
        },
        {
          event_type: 'incident_resolved',
          name: 'Incidente Risolto',
          subject_template: '[RISOLTO] Incidente: {{title}}',
          body_html_template: `<h2 style="color:#16a34a">✅ Incidente Risolto</h2>
<p>L'incidente è stato risolto. I servizi sono stati ripristinati.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Risolto Alle</td><td style="padding:8px;border:1px solid #e5e7eb">{{resolved_at}}</td></tr>
</table>`
        }
      ];

      for (const t of templates) {
        await client.query(`
          INSERT INTO notification_templates (name, event_type, subject_template, body_html_template)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (event_type) DO NOTHING
        `, [t.name, t.event_type, t.subject_template, t.body_html_template]);
      }
    }
  },
  {
    version: 3,
    name: 'services_system_name',
    up: async (client) => {
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS system_name VARCHAR(200)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_services_system ON services(system_name)`);
    }
  },
  {
    version: 4,
    name: 'service_owner_extended',
    up: async (client) => {
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_type VARCHAR(20) DEFAULT 'user'`);
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_group_id UUID REFERENCES local_groups(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_ldap_dn TEXT`);
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_ldap_name VARCHAR(200)`);
    }
  },
  {
    version: 5,
    name: 'maintenance_services_link',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_services (
          maintenance_id UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
          service_id     UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          PRIMARY KEY (maintenance_id, service_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_services_maint ON maintenance_services(maintenance_id)`);
    }
  },
  {
    version: 6,
    name: 'maintenance_types',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_types (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug       VARCHAR(100) UNIQUE NOT NULL,
          label      VARCHAR(200) NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_types_sort ON maintenance_types(sort_order)`);
      // Seed existing built-in types
      const seeds = [
        ['planned',         'Planned',         1],
        ['emergency',       'Emergency',        2],
        ['upgrade',         'Upgrade',          3],
        ['security_patch',  'Security Patch',   4],
        ['infrastructure',  'Infrastructure',   5],
        ['other',           'Other',            6],
      ];
      for (const [slug, label, order] of seeds) {
        await client.query(
          `INSERT INTO maintenance_types (slug, label, sort_order) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
          [slug, label, order]
        );
      }
    }
  },
  {
    version: 7,
    name: 'maintenance_types_color',
    up: async (client) => {
      await client.query(`
        ALTER TABLE maintenance_types ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#6366f1'
      `);
      // Assign a distinct default color to each existing seed type
      const colorMap = [
        ['planned',        '#3b82f6'],
        ['emergency',      '#ef4444'],
        ['upgrade',        '#10b981'],
        ['security_patch', '#f59e0b'],
        ['infrastructure', '#8b5cf6'],
        ['other',          '#6b7280'],
      ];
      for (const [slug, color] of colorMap) {
        await client.query(
          `UPDATE maintenance_types SET color = $1 WHERE slug = $2 AND (color IS NULL OR color = '#6366f1')`,
          [color, slug]
        );
      }
    }
  },
  {
    version: 8,
    name: 'asset_categories',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS asset_categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug VARCHAR(50) UNIQUE NOT NULL,
          label VARCHAR(100) NOT NULL,
          color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const seeds = [
        ['application',    'Application',   '#6366f1', 0],
        ['infrastructure', 'Infrastructure','#3b82f6', 1],
        ['database',       'Database',      '#8b5cf6', 2],
        ['network',        'Network',       '#14b8a6', 3],
        ['hardware',       'Hardware',      '#f97316', 4],
        ['api',            'API',           '#10b981', 5],
        ['other',          'Other',         '#6b7280', 6],
      ];
      for (const [slug, label, color, sort_order] of seeds) {
        await client.query(
          `INSERT INTO asset_categories (slug, label, color, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
          [slug, label, color, sort_order]
        );
      }
    }
  },
  {
    version: 9,
    name: 'blackout_service_asset_ids',
    up: async (client) => {
      await client.query(`
        ALTER TABLE blackout_periods
          ADD COLUMN IF NOT EXISTS service_ids UUID[] DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS asset_ids   UUID[] DEFAULT '{}'
      `);
    }
  },
  {
    version: 10,
    name: 'service_dependencies_and_incident_services',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS service_dependencies (
          service_id    UUID REFERENCES services(id) ON DELETE CASCADE,
          depends_on_id UUID REFERENCES services(id) ON DELETE CASCADE,
          PRIMARY KEY (service_id, depends_on_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS incident_services (
          incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
          service_id  UUID REFERENCES services(id)  ON DELETE CASCADE,
          PRIMARY KEY (incident_id, service_id)
        )
      `);
    }
  },
  {
    version: 11,
    name: 'asset_owner_extended',
    up: async (client) => {
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_type VARCHAR(20) DEFAULT 'user'`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_group_id UUID REFERENCES local_groups(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_ldap_dn TEXT`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_ldap_name VARCHAR(200)`);
    }
  },
  {
    version: 12,
    name: 'maintenance_status_subscribers',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_status_subscribers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          maintenance_id UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(maintenance_id, user_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_status_subs_maint ON maintenance_status_subscribers(maintenance_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_status_subs_user ON maintenance_status_subscribers(user_id)`);
    }
  },
  {
    version: 13,
    name: 'local_groups_role_required',
    up: async (client) => {
      await client.query(`ALTER TABLE local_groups ADD COLUMN IF NOT EXISTS role VARCHAR(50)`);
      await client.query(`UPDATE local_groups SET role='viewer' WHERE role IS NULL OR TRIM(role)=''`);
      await client.query(`ALTER TABLE local_groups ALTER COLUMN role SET DEFAULT 'viewer'`);
      await client.query(`ALTER TABLE local_groups ALTER COLUMN role SET NOT NULL`);
    }
  },
  {
    version: 14,
    name: 'licenses_module',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS licenses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(200) NOT NULL,
          description TEXT,
          owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          supplier VARCHAR(200),
          maintainer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          approver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          expiry_date DATE,
          renewal_date DATE,
          reminder_days INTEGER NOT NULL DEFAULT 30,
          approval_required BOOLEAN NOT NULL DEFAULT TRUE,
          approval_status VARCHAR(30) NOT NULL DEFAULT 'pending',
          estimated_cost NUMERIC(12,2),
          currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
          notes TEXT,
          documents JSONB NOT NULL DEFAULT '[]',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          approved_at TIMESTAMPTZ,
          approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
          rejected_at TIMESTAMPTZ,
          rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
          rejection_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_expiry_date ON licenses(expiry_date)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_approval_status ON licenses(approval_status)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS license_assets (
          license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY (license_id, asset_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS license_services (
          license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          PRIMARY KEY (license_id, service_id)
        )
      `);
    }
  },
  {
    version: 15,
    name: 'suppliers_and_license_contacts',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          first_name VARCHAR(120) NOT NULL,
          last_name VARCHAR(120) NOT NULL,
          company VARCHAR(200) NOT NULL,
          nationality VARCHAR(100),
          phone VARCHAR(60),
          mobile VARCHAR(60),
          email VARCHAR(200) NOT NULL,
          vat_number VARCHAR(80),
          notes TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers(email)`);

      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS owner_contact JSONB`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS maintainer_contact JSONB`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS approver_contact JSONB`);
    }
  },
  {
    version: 16,
    name: 'license_approval_token_workflow',
    up: async (client) => {
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS approval_token_hash VARCHAR(128)`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS approval_token_expires_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_approval_token_hash ON licenses(approval_token_hash)`);
    }
  },
  {
    version: 17,
    name: 'license_notification_templates',
    up: async (client) => {
      const templates = [
        {
          event_type: 'license_approval_requested',
          name: 'License Approval Requested',
          subject_template: '[APPROVAL REQUIRED] {{license_name}}',
          body_html_template: `<h2>License Approval Request</h2>
<p>A license approval request is waiting for your action.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">License</td><td style="padding:8px;border:1px solid #e5e7eb">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Supplier</td><td style="padding:8px;border:1px solid #e5e7eb">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Expiry date</td><td style="padding:8px;border:1px solid #e5e7eb">{{expiry_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Link expires at</td><td style="padding:8px;border:1px solid #e5e7eb">{{expires_at}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{approval_url}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>
<p style="font-size:12px;color:#64748b">If the button does not work, open: {{approval_url}}</p>`
        },
        {
          event_type: 'license_approved',
          name: 'License Approved',
          subject_template: '[APPROVED] {{license_name}}',
          body_html_template: `<h2 style="color:#16a34a">License Approved</h2>
<p>The license has been approved.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">License</td><td style="padding:8px;border:1px solid #e5e7eb">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Supplier</td><td style="padding:8px;border:1px solid #e5e7eb">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Status</td><td style="padding:8px;border:1px solid #e5e7eb">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Approved by</td><td style="padding:8px;border:1px solid #e5e7eb">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Approved at</td><td style="padding:8px;border:1px solid #e5e7eb">{{approved_at}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/licenses" style="background:#16a34a;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">Open Licenses</a></p>`
        },
        {
          event_type: 'license_rejected',
          name: 'License Rejected',
          subject_template: '[REJECTED] {{license_name}}',
          body_html_template: `<h2 style="color:#dc2626">License Rejected</h2>
<p>The license has been rejected.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">License</td><td style="padding:8px;border:1px solid #e5e7eb">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Supplier</td><td style="padding:8px;border:1px solid #e5e7eb">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Status</td><td style="padding:8px;border:1px solid #e5e7eb">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Rejected by</td><td style="padding:8px;border:1px solid #e5e7eb">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Rejected at</td><td style="padding:8px;border:1px solid #e5e7eb">{{rejected_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Reason</td><td style="padding:8px;border:1px solid #e5e7eb">{{rejection_reason}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/licenses" style="background:#dc2626;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">Open Licenses</a></p>`
        },
      ];

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (event_type) DO NOTHING`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        );
      }
    }
  },
  {
    version: 18,
    name: 'supplier_contract_and_website',
    up: async (client) => {
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website VARCHAR(500)`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_reference VARCHAR(200)`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_start_date DATE`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_end_date DATE`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS availability_hours VARCHAR(200)`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(60)`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS emergency_email VARCHAR(200)`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sla_resolution_hours INTEGER`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_notes TEXT`);
      await client.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_documents JSONB NOT NULL DEFAULT '[]'::jsonb`);
    }
  },
  {
    version: 19,
    name: 'maintenance_owner_approval_workflow',
    up: async (client) => {
      await client.query(`
        ALTER TABLE maintenance_windows
          ADD COLUMN IF NOT EXISTS owner_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS owner_approval_status VARCHAR(30) NOT NULL DEFAULT 'not_required',
          ADD COLUMN IF NOT EXISTS owner_approval_updated_at TIMESTAMPTZ
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_owner_approvals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          maintenance_id UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
          owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_email VARCHAR(200),
          owner_name VARCHAR(200),
          owner_source_type VARCHAR(20) NOT NULL,
          owner_source_id UUID NOT NULL,
          owner_source_name VARCHAR(300),
          status VARCHAR(30) NOT NULL DEFAULT 'pending',
          response_note TEXT,
          proposed_start TIMESTAMPTZ,
          proposed_end TIMESTAMPTZ,
          creator_response_note TEXT,
          creator_proposed_start TIMESTAMPTZ,
          creator_proposed_end TIMESTAMPTZ,
          requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ,
          creator_responded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(maintenance_id, owner_user_id, owner_source_type, owner_source_id)
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_moa_maintenance ON maintenance_owner_approvals(maintenance_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_moa_owner_user ON maintenance_owner_approvals(owner_user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_moa_status ON maintenance_owner_approvals(status)`);

      const templates = [
        {
          event_type: 'maintenance_owner_approval_requested',
          name: 'Maintenance Owner Approval Requested',
          subject_template: '[APPROVAL REQUIRED] Maintenance: {{title}}',
          body_html_template: `<h2>Maintenance Approval Required</h2>
<p>A maintenance request requires your decision as owner.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Source</td><td style="padding:8px;border:1px solid #e5e7eb">{{owner_source_type}} - {{owner_source_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Start</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">End</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Requested by</td><td style="padding:8px;border:1px solid #e5e7eb">{{created_by_name}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Maintenance</a></p>`
        },
        {
          event_type: 'maintenance_owner_reschedule_proposed',
          name: 'Maintenance Reschedule Proposed by Owner',
          subject_template: '[RESCHEDULE PROPOSED] Maintenance: {{title}}',
          body_html_template: `<h2>Owner Proposed a New Date</h2>
<p>An owner proposed a new schedule for this maintenance.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Owner</td><td style="padding:8px;border:1px solid #e5e7eb">{{owner_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Proposed start</td><td style="padding:8px;border:1px solid #e5e7eb">{{proposed_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Proposed end</td><td style="padding:8px;border:1px solid #e5e7eb">{{proposed_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Note</td><td style="padding:8px;border:1px solid #e5e7eb">{{response_note}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Review Request</a></p>`
        },
        {
          event_type: 'maintenance_owner_reschedule_countered',
          name: 'Maintenance Reschedule Counter Proposal',
          subject_template: '[COUNTER PROPOSAL] Maintenance: {{title}}',
          body_html_template: `<h2>New Date Proposed by Creator</h2>
<p>The maintenance creator proposed another schedule.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">New start</td><td style="padding:8px;border:1px solid #e5e7eb">{{creator_proposed_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">New end</td><td style="padding:8px;border:1px solid #e5e7eb">{{creator_proposed_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Note</td><td style="padding:8px;border:1px solid #e5e7eb">{{creator_response_note}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#b45309;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Maintenance</a></p>`
        }
      ];

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (event_type) DO NOTHING`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        );
      }
    }
  },
  {
    version: 20,
    name: 'public_codes_for_types_and_categories',
    up: async (client) => {
      await client.query(`CREATE SEQUENCE IF NOT EXISTS maintenance_types_code_seq START 1`);
      await client.query(`CREATE SEQUENCE IF NOT EXISTS asset_categories_code_seq START 1`);

      await client.query(`ALTER TABLE maintenance_types ADD COLUMN IF NOT EXISTS code VARCHAR(20)`);
      await client.query(`ALTER TABLE asset_categories ADD COLUMN IF NOT EXISTS code VARCHAR(20)`);

      await client.query(`
        ALTER TABLE maintenance_types
        ALTER COLUMN code SET DEFAULT ('GB' || LPAD(nextval('maintenance_types_code_seq')::text, 6, '0'))
      `);
      await client.query(`
        ALTER TABLE asset_categories
        ALTER COLUMN code SET DEFAULT ('GB' || LPAD(nextval('asset_categories_code_seq')::text, 6, '0'))
      `);

      // Backfill current rows with GB-prefixed progressive codes.
      await client.query(`UPDATE maintenance_types SET code = DEFAULT WHERE code IS NULL`);
      await client.query(`UPDATE asset_categories SET code = DEFAULT WHERE code IS NULL`);

      await client.query(`ALTER TABLE maintenance_types ALTER COLUMN code SET NOT NULL`);
      await client.query(`ALTER TABLE asset_categories ALTER COLUMN code SET NOT NULL`);

      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_types_code ON maintenance_types(code)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_categories_code ON asset_categories(code)`);
    }
  },
  {
    version: 21,
    name: 'public_codes_unbounded_defaults',
    up: async (client) => {
      await client.query(`ALTER TABLE maintenance_types ALTER COLUMN code TYPE VARCHAR(40)`);
      await client.query(`ALTER TABLE asset_categories ALTER COLUMN code TYPE VARCHAR(40)`);

      // Avoid fixed-width truncation in the future.
      await client.query(`
        ALTER TABLE maintenance_types
        ALTER COLUMN code SET DEFAULT ('GB' || nextval('maintenance_types_code_seq')::text)
      `);
      await client.query(`
        ALTER TABLE asset_categories
        ALTER COLUMN code SET DEFAULT ('GB' || nextval('asset_categories_code_seq')::text)
      `);

      // Align sequences to current max numeric suffix to prevent collisions.
      await client.query(`
        SELECT setval(
          'maintenance_types_code_seq',
          COALESCE((SELECT MAX((regexp_replace(code, '\\D', '', 'g'))::bigint) FROM maintenance_types WHERE code ~ '^GB[0-9]+$'), 1),
          true
        )
      `);
      await client.query(`
        SELECT setval(
          'asset_categories_code_seq',
          COALESCE((SELECT MAX((regexp_replace(code, '\\D', '', 'g'))::bigint) FROM asset_categories WHERE code ~ '^GB[0-9]+$'), 1),
          true
        )
      `);
    }
  },
  {
    version: 22,
    name: 'assets_services_multi_owner_targets',
    up: async (client) => {
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_targets JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS owner_targets JSONB NOT NULL DEFAULT '[]'::jsonb`);

      // Backfill assets from legacy owner fields when missing.
      await client.query(`
        UPDATE assets a
        SET owner_targets = jsonb_build_array(
          jsonb_build_object(
            'type', 'user',
            'id', a.owner_id,
            'name', COALESCE(u.display_name, u.username, 'User'),
            'email', u.email
          )
        )
        FROM users u
        WHERE (a.owner_targets IS NULL OR jsonb_array_length(a.owner_targets)=0)
          AND a.owner_type='user' AND a.owner_id IS NOT NULL AND u.id=a.owner_id
      `);
      await client.query(`
        UPDATE assets a
        SET owner_targets = jsonb_build_array(
          jsonb_build_object(
            'type', 'local_group',
            'id', a.owner_group_id,
            'name', lg.name
          )
        )
        FROM local_groups lg
        WHERE (a.owner_targets IS NULL OR jsonb_array_length(a.owner_targets)=0)
          AND a.owner_type='local_group' AND a.owner_group_id IS NOT NULL AND lg.id=a.owner_group_id
      `);
      await client.query(`
        UPDATE assets
        SET owner_targets = jsonb_build_array(
          jsonb_build_object('type', owner_type, 'dn', owner_ldap_dn, 'name', owner_ldap_name)
        )
        WHERE (owner_targets IS NULL OR jsonb_array_length(owner_targets)=0)
          AND owner_type IN ('ldap_user','ldap_group') AND owner_ldap_dn IS NOT NULL
      `);

      // Backfill services from legacy owner fields when missing.
      await client.query(`
        UPDATE services s
        SET owner_targets = jsonb_build_array(
          jsonb_build_object(
            'type', 'user',
            'id', s.owner_id,
            'name', COALESCE(u.display_name, u.username, 'User'),
            'email', u.email
          )
        )
        FROM users u
        WHERE (s.owner_targets IS NULL OR jsonb_array_length(s.owner_targets)=0)
          AND s.owner_type='user' AND s.owner_id IS NOT NULL AND u.id=s.owner_id
      `);
      await client.query(`
        UPDATE services s
        SET owner_targets = jsonb_build_array(
          jsonb_build_object(
            'type', 'local_group',
            'id', s.owner_group_id,
            'name', lg.name
          )
        )
        FROM local_groups lg
        WHERE (s.owner_targets IS NULL OR jsonb_array_length(s.owner_targets)=0)
          AND s.owner_type='local_group' AND s.owner_group_id IS NOT NULL AND lg.id=s.owner_group_id
      `);
      await client.query(`
        UPDATE services
        SET owner_targets = jsonb_build_array(
          jsonb_build_object('type', owner_type, 'dn', owner_ldap_dn, 'name', owner_ldap_name)
        )
        WHERE (owner_targets IS NULL OR jsonb_array_length(owner_targets)=0)
          AND owner_type IN ('ldap_user','ldap_group') AND owner_ldap_dn IS NOT NULL
      `);
    }
  },
  {
    version: 23,
    name: 'incident_severities_catalog',
    up: async (client) => {
      await client.query(`CREATE SEQUENCE IF NOT EXISTS incident_severities_code_seq START 1`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS incident_severities (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug VARCHAR(50) UNIQUE NOT NULL,
          label VARCHAR(100) NOT NULL,
          color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
          code VARCHAR(40) NOT NULL DEFAULT ('GB' || nextval('incident_severities_code_seq')::text),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_severities_code ON incident_severities(code)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_incident_severities_sort ON incident_severities(sort_order)`);

      const seeds = [
        ['critical', 'Critical', '#ef4444', 1],
        ['high', 'High', '#f97316', 2],
        ['medium', 'Medium', '#f59e0b', 3],
        ['low', 'Low', '#10b981', 4],
      ];

      for (const [slug, label, color, sort_order] of seeds) {
        await client.query(
          `INSERT INTO incident_severities (slug, label, color, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING`,
          [slug, label, color, sort_order]
        );
      }

      await client.query(`
        SELECT setval(
          'incident_severities_code_seq',
          COALESCE((SELECT MAX((regexp_replace(code, '\\D', '', 'g'))::bigint) FROM incident_severities WHERE code ~ '^GB[0-9]+$'), 1),
          true
        )
      `);

      // Normalize any incident severities that are missing in the catalog.
      await client.query(`
        INSERT INTO incident_severities (slug, label, color, sort_order)
        SELECT DISTINCT
          lower(trim(i.severity)) AS slug,
          initcap(lower(trim(i.severity))) AS label,
          '#6b7280' AS color,
          999
        FROM incidents i
        WHERE i.severity IS NOT NULL
          AND trim(i.severity) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM incident_severities s WHERE s.slug = lower(trim(i.severity))
          )
      `);
    }
  }
  ,
  {
    version: 24,
    name: 'license_activation_duration_and_reminders',
    up: async (client) => {
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS activation_date DATE`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS duration_months INTEGER`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS custom_expiry_date DATE`);
      await client.query(`ALTER TABLE licenses ALTER COLUMN reminder_days SET DEFAULT 30`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_activation_date ON licenses(activation_date)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_custom_expiry_date ON licenses(custom_expiry_date)`);

      const templates = [
        {
          event_type: 'license_expiry_reminder',
          name: 'License Expiry Reminder',
          subject_template: '[REMINDER] {{license_name}} expires on {{expiry_date}}',
          body_html_template: `<h2 style="color:#b45309">License Expiry Reminder</h2>
<p>The license is approaching its expiry date.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">License</td><td style="padding:8px;border:1px solid #e5e7eb">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Supplier</td><td style="padding:8px;border:1px solid #e5e7eb">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Activation date</td><td style="padding:8px;border:1px solid #e5e7eb">{{activation_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Expiry date</td><td style="padding:8px;border:1px solid #e5e7eb">{{expiry_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Reminder days</td><td style="padding:8px;border:1px solid #e5e7eb">{{reminder_days}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/licenses" style="background:#b45309;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">Open Licenses</a></p>`
        }
      ]

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (event_type) DO NOTHING`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        )
      }
    }
  },
  {
    version: 25,
    name: 'dashboard_scaling_indexes',
    up: async (client) => {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_active_status ON assets(is_active, status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_assets_active_criticality ON assets(is_active, criticality)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_upcoming_dashboard ON maintenance_windows(status, scheduled_start)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_maint_recent_dashboard ON maintenance_windows(status, actual_end DESC)`);
    }
  },
  {
    version: 26,
    name: 'assets_services_user_targets',
    up: async (client) => {
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS user_targets JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS user_targets JSONB NOT NULL DEFAULT '[]'::jsonb`);
    }
  },
  {
    version: 27,
    name: 'users_office_and_ldap_users_cache',
    up: async (client) => {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS office VARCHAR(200)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ldap_users_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          dn TEXT UNIQUE,
          username VARCHAR(200) UNIQUE,
          upn VARCHAR(300),
          display_name VARCHAR(300),
          email VARCHAR(300),
          office VARCHAR(200),
          source_payload JSONB DEFAULT '{}'::jsonb,
          synced_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_ldap_cache_username ON ldap_users_cache(username)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ldap_cache_display_name ON ldap_users_cache(display_name)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ldap_cache_email ON ldap_users_cache(email)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ldap_cache_office ON ldap_users_cache(office)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ldap_cache_synced_at ON ldap_users_cache(synced_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_expiry_name ON licenses(expiry_date, name)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_supplier_id ON licenses(supplier_id)`);
    }
  },
  {
    version: 28,
    name: 'list_performance_indexes',
    up: async (client) => {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_is_active_username ON users(is_active, username)`);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity_created_at ON audit_log(entity_type, created_at DESC)`);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_inapp_user_created_at ON in_app_notifications(user_id, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_inapp_user_unread_created_at ON in_app_notifications(user_id, is_read, created_at DESC)`);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_log_created_at ON notification_log(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_log_event_created_at ON notification_log(event_type, created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_log_status_created_at ON notification_log(status, created_at DESC)`);
    }
  },
  {
    version: 29,
    name: 'maintenance_involved_users_cache',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_involved_users_cache (
          maintenance_id UUID NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(300) NOT NULL,
          office VARCHAR(200),
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (maintenance_id, user_id)
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_miuc_maintenance ON maintenance_involved_users_cache(maintenance_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_miuc_maintenance_refreshed ON maintenance_involved_users_cache(maintenance_id, refreshed_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_miuc_name ON maintenance_involved_users_cache(name)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_miuc_office ON maintenance_involved_users_cache(office)`);
    }
  },
  {
    version: 30,
    name: 'clear_involved_users_cache_for_user_targets_fix',
    up: async (client) => {
      await client.query(`TRUNCATE maintenance_involved_users_cache`);
    }
  },
  {
    version: 31,
    name: 'maintenance_reopen_flow_and_notification_template',
    up: async (client) => {
      await client.query(`ALTER TABLE maintenance_windows ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE maintenance_windows ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES users(id) ON DELETE SET NULL`);
      await client.query(`ALTER TABLE maintenance_windows ADD COLUMN IF NOT EXISTS reopen_reason TEXT`);
      await client.query(`ALTER TABLE maintenance_windows ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0`);

      await client.query(
        `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_type) DO NOTHING`,
        [
          'Manutenzione Riaperta',
          'maintenance_reopened',
          '[RIAPERTA] Manutenzione: {{title}}',
          `<h2 style="color:#b45309">↩️ Manutenzione Riaperta</h2>
<p>Una manutenzione precedentemente completata è stata riaperta per ulteriori attività correttive.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Titolo</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Impatto</td><td style="padding:8px;border:1px solid #e5e7eb">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Riaperta alle</td><td style="padding:8px;border:1px solid #e5e7eb">{{reopened_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Motivo</td><td style="padding:8px;border:1px solid #e5e7eb">{{reopen_reason}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#4f46e5;color:white;padding:8px 16px;border-radius:4px;text-decoration:none">Visualizza Dettagli</a></p>`
        ]
      );
    }
  },
  {
    version: 32,
    name: 'notification_templates_english_refresh',
    up: async (client) => {
      const templates = [
        {
          event_type: 'maintenance_scheduled',
          name: 'Maintenance Scheduled',
          subject_template: '[{{impact_level}}] Maintenance Scheduled: {{title}}',
          body_html_template: `<h2>Maintenance Scheduled</h2>
<p>A maintenance window has been scheduled and may impact the services you use.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Type</td><td style="padding:8px;border:1px solid #e5e7eb">{{type}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Impact</td><td style="padding:8px;border:1px solid #e5e7eb">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Start</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">End</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Description</td><td style="padding:8px;border:1px solid #e5e7eb">{{description}}</td></tr>
</table>
<p style="margin-top:16px"><a href="{{app_url}}/maintenance/{{id}}" style="background:#4f46e5;color:white;padding:8px 16px;border-radius:4px;text-decoration:none">View Details</a></p>`
        },
        {
          event_type: 'maintenance_reminder',
          name: 'Maintenance Reminder',
          subject_template: '[REMINDER {{time_before}}] Maintenance: {{title}}',
          body_html_template: `<h2>Maintenance Reminder</h2>
<p><strong>This maintenance starts in {{time_before}}.</strong></p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Start</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">End</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_started',
          name: 'Maintenance Started',
          subject_template: '[IN PROGRESS] Maintenance: {{title}}',
          body_html_template: `<h2 style="color:#d97706">Maintenance In Progress</h2>
<p>The maintenance has started. Related services may be temporarily unavailable.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Actual Start</td><td style="padding:8px;border:1px solid #e5e7eb">{{actual_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Planned End</td><td style="padding:8px;border:1px solid #e5e7eb">{{scheduled_end}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_completed',
          name: 'Maintenance Completed',
          subject_template: '[COMPLETED] Maintenance: {{title}}',
          body_html_template: `<h2 style="color:#16a34a">Maintenance Completed</h2>
<p>The maintenance has been completed. Services should be fully restored.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Actual End</td><td style="padding:8px;border:1px solid #e5e7eb">{{actual_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Notes</td><td style="padding:8px;border:1px solid #e5e7eb">{{notes}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_reopened',
          name: 'Maintenance Reopened',
          subject_template: '[REOPENED] Maintenance: {{title}}',
          body_html_template: `<h2 style="color:#b45309">Maintenance Reopened</h2>
<p>A previously completed maintenance has been reopened for additional corrective actions.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Impact</td><td style="padding:8px;border:1px solid #e5e7eb">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Reopened At</td><td style="padding:8px;border:1px solid #e5e7eb">{{reopened_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Reason</td><td style="padding:8px;border:1px solid #e5e7eb">{{reopen_reason}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_cancelled',
          name: 'Maintenance Cancelled',
          subject_template: '[CANCELLED] Maintenance: {{title}}',
          body_html_template: `<h2 style="color:#dc2626">Maintenance Cancelled</h2>
<p>The maintenance has been cancelled.</p>
<p><strong>Reason:</strong> {{reason}}</p>`
        },
        {
          event_type: 'maintenance_rejected',
          name: 'Maintenance Rejected',
          subject_template: '[REJECTED] Maintenance: {{title}}',
          body_html_template: `<h2 style="color:#dc2626">Maintenance Rejected</h2>
<p>The maintenance approval request has been rejected.</p>
<p><strong>Reason:</strong> {{reason}}</p>`
        },
        {
          event_type: 'incident_created',
          name: 'Incident Opened',
          subject_template: '[INCIDENT {{severity}}] {{title}}',
          body_html_template: `<h2 style="color:#dc2626">New Incident</h2>
<p>An incident has been opened and may impact the services you use.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Severity</td><td style="padding:8px;border:1px solid #e5e7eb">{{severity}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Status</td><td style="padding:8px;border:1px solid #e5e7eb">{{status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Description</td><td style="padding:8px;border:1px solid #e5e7eb">{{description}}</td></tr>
</table>`
        },
        {
          event_type: 'incident_resolved',
          name: 'Incident Resolved',
          subject_template: '[RESOLVED] Incident: {{title}}',
          body_html_template: `<h2 style="color:#16a34a">Incident Resolved</h2>
<p>The incident has been resolved.</p>
<table style="border-collapse:collapse;width:100%">
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Title</td><td style="padding:8px;border:1px solid #e5e7eb">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">Resolved At</td><td style="padding:8px;border:1px solid #e5e7eb">{{resolved_at}}</td></tr>
</table>`
        },
        {
          event_type: 'maintenance_owner_approval_requested',
          name: 'Maintenance Owner Approval Requested',
          subject_template: '[ACTION REQUIRED] Maintenance approval: {{title}}',
          body_html_template: `<h2>Owner Approval Requested</h2>
<p>You have been requested to review and approve a maintenance window.</p>
<p><strong>Scope:</strong> {{owner_source_type}} - {{owner_source_name}}</p>
<p><strong>Schedule:</strong> {{scheduled_start}} to {{scheduled_end}}</p>`
        },
        {
          event_type: 'maintenance_owner_reschedule_proposed',
          name: 'Owner Proposed Reschedule',
          subject_template: '[RESCHEDULE PROPOSAL] {{title}}',
          body_html_template: `<h2>Owner Proposed a New Schedule</h2>
<p><strong>Maintenance:</strong> {{title}}</p>
<p><strong>Proposed Start:</strong> {{proposed_start}}</p>
<p><strong>Proposed End:</strong> {{proposed_end}}</p>
<p><strong>Note:</strong> {{response_note}}</p>`
        },
        {
          event_type: 'maintenance_owner_reschedule_countered',
          name: 'Creator Counter Proposal',
          subject_template: '[COUNTER PROPOSAL] {{title}}',
          body_html_template: `<h2>Creator Sent a Counter Proposal</h2>
<p><strong>Maintenance:</strong> {{title}}</p>
<p><strong>Counter Start:</strong> {{creator_proposed_start}}</p>
<p><strong>Counter End:</strong> {{creator_proposed_end}}</p>
<p><strong>Note:</strong> {{creator_response_note}}</p>`
        },
        {
          event_type: 'license_approval_requested',
          name: 'License Approval Requested',
          subject_template: '[APPROVAL REQUIRED] License: {{license_name}}',
          body_html_template: `<h2>License Approval Requested</h2>
<p>A license request requires your approval.</p>
<p><strong>License:</strong> {{license_name}}</p>
<p><strong>Requester:</strong> {{requester_name}}</p>`
        },
        {
          event_type: 'license_approved',
          name: 'License Approved',
          subject_template: '[APPROVED] License: {{license_name}}',
          body_html_template: `<h2>License Approved</h2>
<p>Your license request has been approved.</p>
<p><strong>License:</strong> {{license_name}}</p>`
        },
        {
          event_type: 'license_rejected',
          name: 'License Rejected',
          subject_template: '[REJECTED] License: {{license_name}}',
          body_html_template: `<h2>License Rejected</h2>
<p>Your license request has been rejected.</p>
<p><strong>License:</strong> {{license_name}}</p>
<p><strong>Reason:</strong> {{reason}}</p>`
        },
        {
          event_type: 'license_expiry_reminder',
          name: 'License Expiry Reminder',
          subject_template: '[EXPIRY REMINDER] {{license_name}} expires in {{days_left}} days',
          body_html_template: `<h2>License Expiry Reminder</h2>
<p>A license is nearing expiration.</p>
<p><strong>License:</strong> {{license_name}}</p>
<p><strong>Days left:</strong> {{days_left}}</p>
<p><strong>Expiry date:</strong> {{expiry_date}}</p>`
        },
      ];

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template, is_active)
           VALUES ($1,$2,$3,$4,true)
           ON CONFLICT (event_type)
           DO UPDATE SET
             name = EXCLUDED.name,
             subject_template = EXCLUDED.subject_template,
             body_html_template = EXCLUDED.body_html_template,
             is_active = true`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        );
      }
    }
  },
  {
    version: 33,
    name: 'probe_threshold_and_pause_fields',
    up: async (client) => {
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS failure_threshold INTEGER NOT NULL DEFAULT 2`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS recovery_threshold INTEGER NOT NULL DEFAULT 2`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS pause_during_maintenance BOOLEAN NOT NULL DEFAULT TRUE`);
    }
  },
  {
    version: 34,
    name: 'probe_icmp_dns_tls_types',
    up: async (client) => {
      // New probe-type-specific config fields on assets
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS dns_record_type VARCHAR(10) NOT NULL DEFAULT 'A'`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS dns_expected_value TEXT`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS ssl_expiry_warning_days INTEGER NOT NULL DEFAULT 30`);
      // New result detail columns on probe_results
      await client.query(`ALTER TABLE probe_results ADD COLUMN IF NOT EXISTS ssl_cert_expiry TIMESTAMPTZ`);
      await client.query(`ALTER TABLE probe_results ADD COLUMN IF NOT EXISTS dns_response TEXT`);
    }
  },
  {
    version: 35,
    name: 'ticket_ref_for_changes',
    up: async (client) => {
      await client.query(`ALTER TABLE maintenance_windows ADD COLUMN IF NOT EXISTS ticket_ref VARCHAR(100)`);
      await client.query(`ALTER TABLE blackout_periods ADD COLUMN IF NOT EXISTS ticket_ref VARCHAR(100)`);
      await client.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS ticket_ref VARCHAR(100)`);
    }
  },
  {
    version: 36,
    name: 'asset_probes_multi_probe_support',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS asset_probes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          name VARCHAR(200),
          probe_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          probe_type VARCHAR(20) NOT NULL,
          probe_target TEXT NOT NULL,
          probe_interval_seconds INTEGER NOT NULL DEFAULT 300,
          probe_timeout_seconds INTEGER NOT NULL DEFAULT 10,
          expected_status_code INTEGER,
          failure_threshold INTEGER NOT NULL DEFAULT 2,
          recovery_threshold INTEGER NOT NULL DEFAULT 2,
          pause_during_maintenance BOOLEAN NOT NULL DEFAULT TRUE,
          dns_record_type VARCHAR(10) NOT NULL DEFAULT 'A',
          dns_expected_value TEXT,
          ssl_expiry_warning_days INTEGER NOT NULL DEFAULT 30,
          legacy_slot BOOLEAN NOT NULL DEFAULT FALSE,
          last_probed_at TIMESTAMPTZ,
          next_probe_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          consecutive_successes INTEGER NOT NULL DEFAULT 0,
          current_state VARCHAR(30) NOT NULL DEFAULT 'unknown',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_probes_asset ON asset_probes(asset_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_probes_due ON asset_probes(next_probe_at) WHERE probe_enabled = true`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_asset_probes_asset_state ON asset_probes(asset_id, current_state)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_probes_legacy_slot ON asset_probes(asset_id) WHERE legacy_slot = true`);

      await client.query(`ALTER TABLE probe_results ADD COLUMN IF NOT EXISTS probe_id UUID REFERENCES asset_probes(id) ON DELETE SET NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_probe_results_probe_recent ON probe_results(probe_id, probed_at DESC)`);

      // Backfill one legacy probe row per asset using existing asset-level probe config.
      await client.query(`
        INSERT INTO asset_probes (
          asset_id, name, probe_enabled, probe_type, probe_target,
          probe_interval_seconds, probe_timeout_seconds, expected_status_code,
          failure_threshold, recovery_threshold, pause_during_maintenance,
          dns_record_type, dns_expected_value, ssl_expiry_warning_days,
          legacy_slot, next_probe_at, current_state
        )
        SELECT
          a.id,
          'Default probe',
          COALESCE(a.probe_enabled, false),
          COALESCE(a.probe_type, 'http'),
          COALESCE(a.probe_url, ''),
          COALESCE(a.probe_interval_seconds, 300),
          COALESCE(a.probe_timeout_seconds, 10),
          COALESCE(a.expected_status_code, 200),
          COALESCE(a.failure_threshold, 2),
          COALESCE(a.recovery_threshold, 2),
          COALESCE(a.pause_during_maintenance, true),
          COALESCE(a.dns_record_type, 'A'),
          a.dns_expected_value,
          COALESCE(a.ssl_expiry_warning_days, 30),
          true,
          NOW(),
          CASE WHEN a.status = 'major_outage' THEN 'major_outage' WHEN a.status = 'operational' THEN 'operational' ELSE 'unknown' END
        FROM assets a
        WHERE a.probe_type IS NOT NULL
          AND a.probe_url IS NOT NULL
          AND BTRIM(a.probe_url) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM asset_probes ap WHERE ap.asset_id = a.id AND ap.legacy_slot = true
          )
      `);

      await client.query(`
        UPDATE probe_results pr
        SET probe_id = ap.id
        FROM asset_probes ap
        WHERE pr.probe_id IS NULL
          AND ap.legacy_slot = true
          AND pr.asset_id = ap.asset_id
      `);
    }
  },
  {
    version: 37,
    name: 'service_probes_multi_probe_support',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS service_probes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          name VARCHAR(200),
          probe_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          probe_type VARCHAR(20) NOT NULL,
          probe_target TEXT NOT NULL,
          probe_interval_seconds INTEGER NOT NULL DEFAULT 300,
          probe_timeout_seconds INTEGER NOT NULL DEFAULT 10,
          expected_status_code INTEGER,
          failure_threshold INTEGER NOT NULL DEFAULT 2,
          recovery_threshold INTEGER NOT NULL DEFAULT 2,
          pause_during_maintenance BOOLEAN NOT NULL DEFAULT TRUE,
          dns_record_type VARCHAR(10) NOT NULL DEFAULT 'A',
          dns_expected_value TEXT,
          ssl_expiry_warning_days INTEGER NOT NULL DEFAULT 30,
          legacy_slot BOOLEAN NOT NULL DEFAULT FALSE,
          last_probed_at TIMESTAMPTZ,
          next_probe_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          consecutive_successes INTEGER NOT NULL DEFAULT 0,
          current_state VARCHAR(30) NOT NULL DEFAULT 'unknown',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_probes_service ON service_probes(service_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_probes_due ON service_probes(next_probe_at) WHERE probe_enabled = true`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_probes_service_state ON service_probes(service_id, current_state)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_service_probes_legacy_slot ON service_probes(service_id) WHERE legacy_slot = true`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS service_probe_results (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          probe_id UUID REFERENCES service_probes(id) ON DELETE SET NULL,
          success BOOLEAN NOT NULL,
          response_time_ms INTEGER,
          status_code INTEGER,
          error_message TEXT,
          ssl_cert_expiry DATE,
          dns_response TEXT,
          probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_probe_results_service ON service_probe_results(service_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_probe_results_probe_recent ON service_probe_results(probe_id, probed_at DESC)`);
    }
  },
  {
    version: 38,
    name: 'notification_templates_english_cta_refresh',
    up: async (client) => {
      const templates = [
        {
          event_type: 'maintenance_scheduled',
          name: 'Maintenance Scheduled',
          subject_template: '[{{impact_level}}] Maintenance Scheduled: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f172a">Maintenance Scheduled</h2>
<p style="margin:0 0 14px;color:#334155">A maintenance window has been scheduled and may affect one or more services.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Type</td><td style="padding:8px;border:1px solid #e2e8f0">{{type}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Impact</td><td style="padding:8px;border:1px solid #e2e8f0">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">End</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Description</td><td style="padding:8px;border:1px solid #e2e8f0">{{description}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Maintenance</a></p>`,
        },
        {
          event_type: 'maintenance_reminder',
          name: 'Maintenance Reminder',
          subject_template: '[REMINDER {{time_before}}] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f172a">Maintenance Reminder</h2>
<p style="margin:0 0 14px;color:#334155"><strong>This maintenance starts in {{time_before}}.</strong></p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">End</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_end}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Review Maintenance</a></p>`,
        },
        {
          event_type: 'maintenance_started',
          name: 'Maintenance Started',
          subject_template: '[IN PROGRESS] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b45309">Maintenance In Progress</h2>
<p style="margin:0 0 14px;color:#334155">The maintenance has started. Temporary service degradation may occur.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Actual Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{actual_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Planned End</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_end}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Track Progress</a></p>`,
        },
        {
          event_type: 'maintenance_completed',
          name: 'Maintenance Completed',
          subject_template: '[COMPLETED] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#166534">Maintenance Completed</h2>
<p style="margin:0 0 14px;color:#334155">The maintenance has been completed and services should be restored.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Actual End</td><td style="padding:8px;border:1px solid #e2e8f0">{{actual_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Notes</td><td style="padding:8px;border:1px solid #e2e8f0">{{notes}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#15803d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">View Final Details</a></p>`,
        },
        {
          event_type: 'maintenance_reopened',
          name: 'Maintenance Reopened',
          subject_template: '[REOPENED] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#92400e">Maintenance Reopened</h2>
<p style="margin:0 0 14px;color:#334155">A previously completed maintenance was reopened for additional corrective work.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Impact</td><td style="padding:8px;border:1px solid #e2e8f0">{{impact_level}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Reopened At</td><td style="padding:8px;border:1px solid #e2e8f0">{{reopened_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Reason</td><td style="padding:8px;border:1px solid #e2e8f0">{{reopen_reason}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Review Reopened Maintenance</a></p>`,
        },
        {
          event_type: 'maintenance_cancelled',
          name: 'Maintenance Cancelled',
          subject_template: '[CANCELLED] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b91c1c">Maintenance Cancelled</h2>
<p style="margin:0 0 12px;color:#334155">The maintenance activity has been cancelled.</p>
<p style="margin:0 0 14px;color:#0f172a"><strong>Reason:</strong> {{reason}}</p>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Maintenance</a></p>`,
        },
        {
          event_type: 'maintenance_rejected',
          name: 'Maintenance Rejected',
          subject_template: '[REJECTED] Maintenance: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b91c1c">Maintenance Rejected</h2>
<p style="margin:0 0 12px;color:#334155">The maintenance approval request has been rejected.</p>
<p style="margin:0 0 14px;color:#0f172a"><strong>Reason:</strong> {{reason}}</p>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Details</a></p>`,
        },
        {
          event_type: 'incident_created',
          name: 'Incident Opened',
          subject_template: '[INCIDENT {{severity}}] {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b91c1c">New Incident</h2>
<p style="margin:0 0 14px;color:#334155">An incident has been opened and may impact service availability.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Severity</td><td style="padding:8px;border:1px solid #e2e8f0">{{severity}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Description</td><td style="padding:8px;border:1px solid #e2e8f0">{{description}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/incidents/{{id}}" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Incident</a></p>`,
        },
        {
          event_type: 'incident_resolved',
          name: 'Incident Resolved',
          subject_template: '[RESOLVED] Incident: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#166534">Incident Resolved</h2>
<p style="margin:0 0 14px;color:#334155">The incident has been resolved.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Title</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Resolved At</td><td style="padding:8px;border:1px solid #e2e8f0">{{resolved_at}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/incidents/{{id}}" style="background:#15803d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">View Incident</a></p>`,
        },
        {
          event_type: 'maintenance_owner_approval_requested',
          name: 'Maintenance Owner Approval Requested',
          subject_template: '[ACTION REQUIRED] Maintenance approval: {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f172a">Approval Required</h2>
<p style="margin:0 0 14px;color:#334155">A maintenance request requires your review and decision.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Maintenance</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Scope</td><td style="padding:8px;border:1px solid #e2e8f0">{{owner_source_type}} - {{owner_source_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">End</td><td style="padding:8px;border:1px solid #e2e8f0">{{scheduled_end}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>`,
        },
        {
          event_type: 'maintenance_owner_reschedule_proposed',
          name: 'Owner Proposed Reschedule',
          subject_template: '[RESCHEDULE PROPOSAL] {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f766e">Owner Proposed a New Schedule</h2>
<p style="margin:0 0 14px;color:#334155">The owner requested a new schedule for this maintenance window.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Maintenance</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Proposed Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{proposed_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Proposed End</td><td style="padding:8px;border:1px solid #e2e8f0">{{proposed_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Note</td><td style="padding:8px;border:1px solid #e2e8f0">{{response_note}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>`,
        },
        {
          event_type: 'maintenance_owner_reschedule_countered',
          name: 'Creator Counter Proposal',
          subject_template: '[COUNTER PROPOSAL] {{title}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#7c2d12">Creator Sent a Counter Proposal</h2>
<p style="margin:0 0 14px;color:#334155">A counter proposal is available and requires your review.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Maintenance</td><td style="padding:8px;border:1px solid #e2e8f0">{{title}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Counter Start</td><td style="padding:8px;border:1px solid #e2e8f0">{{creator_proposed_start}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Counter End</td><td style="padding:8px;border:1px solid #e2e8f0">{{creator_proposed_end}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Note</td><td style="padding:8px;border:1px solid #e2e8f0">{{creator_response_note}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>`,
        },
        {
          event_type: 'license_approval_requested',
          name: 'License Approval Requested',
          subject_template: '[APPROVAL REQUIRED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f172a">License Approval Required</h2>
<p style="margin:0 0 14px;color:#334155">A license request is waiting for your approval.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Requester</td><td style="padding:8px;border:1px solid #e2e8f0">{{requester_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{approval_url}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>
<p style="margin:8px 0 0;color:#64748b;font-size:12px">If the button does not work, open this URL in your browser: {{approval_url}}</p>`,
        },
        {
          event_type: 'license_approved',
          name: 'License Approved',
          subject_template: '[APPROVED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#166534">License Approved</h2>
<p style="margin:0 0 14px;color:#334155">The license request has been approved.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Approved By</td><td style="padding:8px;border:1px solid #e2e8f0">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Approved At</td><td style="padding:8px;border:1px solid #e2e8f0">{{approved_at}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#15803d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approvals</a></p>`,
        },
        {
          event_type: 'license_rejected',
          name: 'License Rejected',
          subject_template: '[REJECTED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b91c1c">License Rejected</h2>
<p style="margin:0 0 14px;color:#334155">The license request has been rejected.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Rejected By</td><td style="padding:8px;border:1px solid #e2e8f0">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Rejected At</td><td style="padding:8px;border:1px solid #e2e8f0">{{rejected_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Reason</td><td style="padding:8px;border:1px solid #e2e8f0">{{reason}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approvals</a></p>`,
        },
        {
          event_type: 'license_expiry_reminder',
          name: 'License Expiry Reminder',
          subject_template: '[EXPIRY REMINDER] {{license_name}} expires in {{days_left}} days',
          body_html_template: `<h2 style="margin:0 0 12px;color:#92400e">License Expiry Reminder</h2>
<p style="margin:0 0 14px;color:#334155">This license is approaching its expiration date.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Days Left</td><td style="padding:8px;border:1px solid #e2e8f0">{{days_left}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Expiry Date</td><td style="padding:8px;border:1px solid #e2e8f0">{{expiry_date}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Licenses</a></p>`,
        },
      ];

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (event_type)
           DO UPDATE SET
             name = EXCLUDED.name,
             subject_template = EXCLUDED.subject_template,
             body_html_template = EXCLUDED.body_html_template,
             is_active = true`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        );
      }
    }
  },
  {
    version: 39,
    name: 'notification_templates_unify_approval_cta_labels',
    up: async (client) => {
      const templates = [
        {
          event_type: 'maintenance_owner_approval_requested',
          cta_html: '<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
        {
          event_type: 'maintenance_owner_reschedule_proposed',
          cta_html: '<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
        {
          event_type: 'maintenance_owner_reschedule_countered',
          cta_html: '<p style="margin:16px 0 0"><a href="{{app_url}}/maintenance/{{id}}" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
        {
          event_type: 'license_approval_requested',
          cta_html: '<p style="margin:16px 0 0"><a href="{{approval_url}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
        {
          event_type: 'license_approved',
          cta_html: '<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#15803d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
        {
          event_type: 'license_rejected',
          cta_html: '<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>',
        },
      ];

      for (const t of templates) {
        await client.query(
          `UPDATE notification_templates
           SET body_html_template = regexp_replace(
             body_html_template,
             '<p style="margin:16px 0 0"><a[^<]*>[^<]*</a></p>',
             $1,
             'g'
           ),
           updated_at = NOW()
           WHERE event_type = $2`,
          [t.cta_html, t.event_type]
        );
      }
    }
  },
  {
    version: 40,
    name: 'license_templates_add_details_and_documents',
    up: async (client) => {
      const templates = [
        {
          event_type: 'license_approval_requested',
          name: 'License Approval Requested',
          subject_template: '[APPROVAL REQUIRED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#0f172a">License Approval Required</h2>
<p style="margin:0 0 14px;color:#334155">A license request is in approval phase. This is a status update for the involved parties.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Requester</td><td style="padding:8px;border:1px solid #e2e8f0">{{requester_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Expiry Date</td><td style="padding:8px;border:1px solid #e2e8f0">{{expiry_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Documents</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_documents_html}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{approval_url}}" style="background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>
<p style="margin:8px 0 0;color:#64748b;font-size:12px">If the button does not work, open this URL in your browser: {{approval_url}}</p>`,
        },
        {
          event_type: 'license_approved',
          name: 'License Approved',
          subject_template: '[APPROVED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#166534">License Approved</h2>
<p style="margin:0 0 14px;color:#334155">The license has been approved and renewal can proceed.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Approved By</td><td style="padding:8px;border:1px solid #e2e8f0">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Approved At</td><td style="padding:8px;border:1px solid #e2e8f0">{{approved_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Documents</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_documents_html}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#15803d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>`,
        },
        {
          event_type: 'license_rejected',
          name: 'License Rejected',
          subject_template: '[REJECTED] License: {{license_name}}',
          body_html_template: `<h2 style="margin:0 0 12px;color:#b91c1c">License Rejected</h2>
<p style="margin:0 0 14px;color:#334155">The license request has been rejected.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Rejected By</td><td style="padding:8px;border:1px solid #e2e8f0">{{acted_by}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Rejected At</td><td style="padding:8px;border:1px solid #e2e8f0">{{rejected_at}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Reason</td><td style="padding:8px;border:1px solid #e2e8f0">{{reason}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Documents</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_documents_html}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#dc2626;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Page</a></p>`,
        },
        {
          event_type: 'license_expiry_reminder',
          name: 'License Expiry Reminder',
          subject_template: '[EXPIRY REMINDER] {{license_name}} expires in {{days_left}} days',
          body_html_template: `<h2 style="margin:0 0 12px;color:#92400e">License Expiry Reminder</h2>
<p style="margin:0 0 14px;color:#334155">This license is approaching its expiration date and is expected to enter approval flow soon.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Days Left</td><td style="padding:8px;border:1px solid #e2e8f0">{{days_left}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Expiry Date</td><td style="padding:8px;border:1px solid #e2e8f0">{{expiry_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Documents</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_documents_html}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{app_url}}/licenses" style="background:#b45309;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Licenses</a></p>`,
        },
      ];

      for (const t of templates) {
        await client.query(
          `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (event_type)
           DO UPDATE SET
             name = EXCLUDED.name,
             subject_template = EXCLUDED.subject_template,
             body_html_template = EXCLUDED.body_html_template,
             is_active = true,
             updated_at = NOW()`,
          [t.name, t.event_type, t.subject_template, t.body_html_template]
        );
      }
    }
  },
  {
    version: 41,
    name: 'license_role_templates_and_status_token',
    up: async (client) => {
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS status_token_hash VARCHAR(128)`);
      await client.query(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS status_token_expires_at TIMESTAMPTZ`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_licenses_status_token_hash ON licenses(status_token_hash)`);

      await client.query(
        `INSERT INTO notification_templates (name, event_type, subject_template, body_html_template, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (event_type)
         DO UPDATE SET
           name = EXCLUDED.name,
           subject_template = EXCLUDED.subject_template,
           body_html_template = EXCLUDED.body_html_template,
           is_active = true,
           updated_at = NOW()`,
        [
          'License Approval Status Update',
          'license_approval_requested_info',
          '[STATUS UPDATE] License approval started: {{license_name}}',
          `<h2 style="margin:0 0 12px;color:#0f172a">License Approval In Progress</h2>
<p style="margin:0 0 14px;color:#334155">This is a status update. The approval workflow has started for this license.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 14px">
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">License</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_name}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Supplier</td><td style="padding:8px;border:1px solid #e2e8f0">{{supplier_company}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Expiry Date</td><td style="padding:8px;border:1px solid #e2e8f0">{{expiry_date}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Current Status</td><td style="padding:8px;border:1px solid #e2e8f0">{{approval_status}}</td></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600">Documents</td><td style="padding:8px;border:1px solid #e2e8f0">{{license_documents_html}}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="{{status_url}}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open Approval Status</a></p>
<p style="margin:8px 0 0;color:#64748b;font-size:12px">If the button does not work, open this URL in your browser: {{status_url}}</p>`,
        ]
      );
    }
  },
];

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already-applied versions
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = new Set(applied.rows.map(r => r.version));

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;

      logger.info(`[DB] Running migration ${migration.version}: ${migration.name}`);
      await client.query('BEGIN');
      try {
        await migration.up(client);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
        logger.info(`[DB] Migration ${migration.version} applied successfully`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`[DB] Migration ${migration.version} failed: ${err.message}`);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
