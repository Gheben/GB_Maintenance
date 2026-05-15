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
  }
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
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
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
