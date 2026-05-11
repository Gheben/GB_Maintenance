'use strict';

/** @type {import('swagger-ui-express').JsonObject} */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'GB Maintenance API',
    version: '1.0.0',
    description: `
## Autenticazione

La maggior parte degli endpoint richiede un **JWT Bearer token**.

**Come ottenere il token:**

\`\`\`
POST /api/auth/login
{ "username": "sysadmin", "password": "Ballarini1993!" }
\`\`\`

Copia il campo \`token\` dalla risposta, clicca **"Authorize"** (🔓) in cima a questa pagina e incollalo.

Il token è valido per la durata impostata in \`JWT_EXPIRES_IN\` (default **8 ore**).

---

### Gerarchia dei ruoli

| Ruolo | Livello |
|---|---|
| \`superadmin\` | Accesso totale |
| \`admin\` | Gestione utenti, asset, servizi, manutenzioni, impostazioni |
| \`change_manager\` | Approva/rifiuta manutenzioni |
| \`operator\` | Crea e gestisce asset, servizi, manutenzioni, incidenti |
| \`viewer\` | Sola lettura |
| \`subscriber\` | Solo status page e notifiche |

---

### API Keys

In alternativa al JWT puoi usare una **API Key** nell'header:
\`\`\`
X-Api-Key: gbm_your_api_key_here
\`\`\`

Le API key si creano da **Impostazioni → API Keys**.
    `,
  },
  servers: [{ url: '/api', description: 'Server corrente' }],
  tags: [
    { name: 'Auth',          description: 'Autenticazione, sessioni, TOTP, SAML' },
    { name: 'Users',         description: 'Gestione utenti' },
    { name: 'Groups',        description: 'Gruppi locali e mappature LDAP' },
    { name: 'Assets',        description: 'Asset aziendali (server, VM, servizi di rete…)' },
    { name: 'Services',      description: 'Servizi applicativi' },
    { name: 'Maintenance',   description: 'Finestre di manutenzione programmate e non' },
    { name: 'Incidents',     description: 'Incidenti e aggiornamenti di stato' },
    { name: 'Notifications', description: 'Notifiche in-app e log' },
    { name: 'Settings',      description: 'Configurazione SMTP, LDAP, SAML, webhook, generali' },
    { name: 'Status',        description: 'Status page pubblica' },
    { name: 'Reports',       description: 'Report e dashboard' },
    { name: 'Templates',     description: 'Template di manutenzione' },
    { name: 'Blackout',      description: 'Periodi di blackout (manutenzioni vietate)' },
    { name: 'ApiKeys',       description: 'API Keys per accesso programmatico' },
    { name: 'Audit',         description: 'Audit log' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT ottenuto da POST /api/auth/login',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'API Key creata da Impostazioni → API Keys',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Non autorizzato' } },
      },
      Ok: {
        type: 'object',
        properties: { ok: { type: 'boolean', example: true } },
      },
      Pagination: {
        type: 'object',
        properties: {
          data:  { type: 'array', items: {} },
          total: { type: 'integer', example: 42 },
          page:  { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
        },
      },
      User: {
        type: 'object',
        properties: {
          id:           { type: 'string', format: 'uuid' },
          username:     { type: 'string', example: 'mario.rossi' },
          display_name: { type: 'string', example: 'Mario Rossi' },
          email:        { type: 'string', format: 'email' },
          role:         { type: 'string', enum: ['superadmin','admin','change_manager','operator','viewer','subscriber'] },
          source:       { type: 'string', enum: ['local','ldap','saml','sso'] },
          is_active:    { type: 'boolean' },
          permissions:  { type: 'object', additionalProperties: { type: 'boolean' } },
          created_at:   { type: 'string', format: 'date-time' },
          last_login:   { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Asset: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          name:           { type: 'string', example: 'srv-web-01' },
          asset_type:     { type: 'string', enum: ['server','vm','network','storage','application','database','service','other'] },
          criticality:    { type: 'string', enum: ['critical','high','medium','low'] },
          current_status: { type: 'string', enum: ['operational','degraded','partial_outage','major_outage','maintenance','unknown'] },
          ip_address:     { type: 'string', nullable: true },
          hostname:       { type: 'string', nullable: true },
          environment:    { type: 'string', enum: ['production','staging','development','test'] },
          is_active:      { type: 'boolean' },
          probe_enabled:  { type: 'boolean' },
          probe_type:     { type: 'string', enum: ['http','https','tcp','none'], nullable: true },
          probe_url:      { type: 'string', nullable: true },
          probe_interval: { type: 'integer' },
          tags:           { type: 'array', items: { type: 'string' } },
          created_at:     { type: 'string', format: 'date-time' },
        },
      },
      Service: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          name:           { type: 'string', example: 'ERP Gestionale' },
          slug:           { type: 'string', example: 'erp-gestionale' },
          description:    { type: 'string', nullable: true },
          current_status: { type: 'string', enum: ['operational','degraded','partial_outage','major_outage','maintenance','unknown'] },
          is_public:      { type: 'boolean' },
          sla_target:     { type: 'number', nullable: true },
          url:            { type: 'string', nullable: true },
        },
      },
      MaintenanceWindow: {
        type: 'object',
        properties: {
          id:              { type: 'string', format: 'uuid' },
          title:           { type: 'string', example: 'Aggiornamento kernel server web' },
          type:            { type: 'string', enum: ['planned','emergency','upgrade','security_patch','infrastructure','other'] },
          status:          { type: 'string', enum: ['draft','pending_approval','approved','in_progress','completed','cancelled'] },
          impact_level:    { type: 'string', enum: ['critical','high','medium','low'] },
          scheduled_start: { type: 'string', format: 'date-time' },
          scheduled_end:   { type: 'string', format: 'date-time' },
          description:     { type: 'string', nullable: true },
          created_by:      { type: 'string', format: 'uuid' },
          created_at:      { type: 'string', format: 'date-time' },
        },
      },
      Incident: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          title:       { type: 'string', example: 'Database non raggiungibile' },
          status:      { type: 'string', enum: ['investigating','identified','monitoring','resolved'] },
          severity:    { type: 'string', enum: ['critical','high','medium','low'] },
          description: { type: 'string', nullable: true },
          started_at:  { type: 'string', format: 'date-time' },
          resolved_at: { type: 'string', format: 'date-time', nullable: true },
          created_at:  { type: 'string', format: 'date-time' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id:         { type: 'string', format: 'uuid' },
          title:      { type: 'string' },
          message:    { type: 'string' },
          type:       { type: 'string', enum: ['info','warning','error','success'] },
          is_read:    { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Template: {
        type: 'object',
        properties: {
          id:               { type: 'string', format: 'uuid' },
          name:             { type: 'string', example: 'Patch mensile' },
          type:             { type: 'string' },
          impact_level:     { type: 'string' },
          duration_minutes: { type: 'integer' },
          description:      { type: 'string', nullable: true },
        },
      },
      BlackoutPeriod: {
        type: 'object',
        properties: {
          id:          { type: 'string', format: 'uuid' },
          name:        { type: 'string', example: 'Freeze natalizio' },
          start_date:  { type: 'string', format: 'date' },
          end_date:    { type: 'string', format: 'date' },
          description: { type: 'string', nullable: true },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {

    // ─── AUTH ──────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login (locale o LDAP)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['username','password'],
            properties: {
              username:  { type: 'string', example: 'sysadmin' },
              password:  { type: 'string', example: 'Ballarini1993!' },
              totp_code: { type: 'string', example: '123456', description: 'Richiesto se TOTP è abilitato' },
            },
          }}},
        },
        responses: {
          200: { description: 'Login riuscito', content: { 'application/json': { schema: {
            type: 'object', properties: {
              token: { type: 'string' },
              user:  { $ref: '#/components/schemas/User' },
              totp_required: { type: 'boolean', description: 'Se true, fornire totp_code e ripetere' },
            },
          }}}},
          401: { description: 'Credenziali non valide' },
          423: { description: 'Account bloccato (troppi tentativi)' },
        },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Logout (revoca sessione corrente)',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } } },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Profilo utente corrente',
        responses: { 200: { description: 'Utente', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/auth/change-password': {
      post: { tags: ['Auth'], summary: 'Cambio password',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['current_password','new_password'],
          properties: { current_password: { type: 'string' }, new_password: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'Password cambiata' }, 400: { description: 'Password attuale non corretta' } },
      },
    },
    '/auth/sessions': {
      get: { tags: ['Auth'], summary: 'Lista sessioni attive',
        responses: { 200: { description: 'Sessioni', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
      delete: { tags: ['Auth'], summary: 'Revoca tutte le sessioni',
        responses: { 200: { description: 'Sessioni revocate' } },
      },
    },
    '/auth/totp/setup': {
      post: { tags: ['Auth'], summary: 'Inizia setup TOTP — restituisce QR code e secret',
        responses: { 200: { description: 'Setup TOTP', content: { 'application/json': { schema: {
          type: 'object', properties: { qr_url: { type: 'string' }, secret: { type: 'string' } },
        }}}},
        },
      },
    },
    '/auth/totp/verify': {
      post: { tags: ['Auth'], summary: 'Verifica e attiva TOTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'],
          properties: { token: { type: 'string', example: '123456' } },
        }}}},
        responses: { 200: { description: 'TOTP attivato' }, 400: { description: 'Codice non valido' } },
      },
    },
    '/auth/totp/disable': {
      post: { tags: ['Auth'], summary: 'Disabilita TOTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'],
          properties: { token: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'TOTP disabilitato' } },
      },
    },
    '/auth/saml/metadata': {
      get: { tags: ['Auth'], summary: 'SP Metadata XML per configurazione IdP SAML', security: [],
        responses: { 200: { description: 'XML metadata', content: { 'application/xml': {} } } },
      },
    },
    '/auth/saml/login': {
      get: { tags: ['Auth'], summary: 'Redirect a IdP SAML per login', security: [],
        responses: { 302: { description: 'Redirect a IdP' } },
      },
    },

    // ─── USERS ────────────────────────────────────────────────────────────────
    '/users': {
      get: { tags: ['Users'], summary: 'Lista utenti (admin)',
        parameters: [
          { in: 'query', name: 'page',  schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista utenti', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
      },
      post: { tags: ['Users'], summary: 'Crea utente locale (admin)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username','password','email'],
          properties: {
            username:     { type: 'string' },
            password:     { type: 'string' },
            email:        { type: 'string', format: 'email' },
            display_name: { type: 'string' },
            role:         { type: 'string', enum: ['admin','change_manager','operator','viewer','subscriber'], default: 'operator' },
            permissions:  { type: 'object' },
          },
        }}}},
        responses: { 201: { description: 'Utente creato', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/users/{id}': {
      get:    { tags: ['Users'], summary: 'Dettaglio utente', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Utente', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } },
      put:    { tags: ['Users'], summary: 'Aggiorna utente', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        responses: { 200: { description: 'Utente aggiornato' } } },
      delete: { tags: ['Users'], summary: 'Elimina utente', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Eliminato' } } },
    },

    // ─── GROUPS ───────────────────────────────────────────────────────────────
    '/groups': {
      get:  { tags: ['Groups'], summary: 'Lista gruppi locali',
        responses: { 200: { description: 'Gruppi', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, description: { type: 'string' } } } } } } } },
      },
      post: { tags: ['Groups'], summary: 'Crea gruppo',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 201: { description: 'Gruppo creato' } },
      },
    },
    '/groups/{id}': {
      get:    { tags: ['Groups'], summary: 'Dettaglio gruppo con membri e mappature LDAP', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Gruppo' } } },
      put:    { tags: ['Groups'], summary: 'Aggiorna gruppo', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Groups'], summary: 'Elimina gruppo', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminato' } } },
    },
    '/groups/{id}/members': {
      post:   { tags: ['Groups'], summary: 'Aggiungi membro', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string', format: 'uuid' } } } } } }, responses: { 201: { description: 'Membro aggiunto' } } },
    },
    '/groups/{id}/members/{userId}': {
      delete: { tags: ['Groups'], summary: 'Rimuovi membro', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'userId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rimosso' } } },
    },
    '/groups/ldap/mappings': {
      get:  { tags: ['Groups'], summary: 'Lista mappature LDAP→gruppo', responses: { 200: { description: 'Mappature' } } },
      post: { tags: ['Groups'], summary: 'Crea mappatura LDAP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ldap_group_dn','local_group_id'], properties: { ldap_group_dn: { type: 'string' }, local_group_id: { type: 'string', format: 'uuid' } } } } } },
        responses: { 201: { description: 'Mappatura creata' } },
      },
    },

    // ─── ASSETS ───────────────────────────────────────────────────────────────
    '/assets': {
      get: { tags: ['Assets'], summary: 'Lista asset',
        parameters: [
          { in: 'query', name: 'page',   schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit',  schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'criticality', schema: { type: 'string', enum: ['critical','high','medium','low'] } },
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'type',   schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Asset paginati', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
      },
      post: { tags: ['Assets'], summary: 'Crea asset',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } },
        responses: { 201: { description: 'Asset creato', content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } } },
      },
    },
    '/assets/{id}': {
      get:    { tags: ['Assets'], summary: 'Dettaglio asset con dipendenze e servizi', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Asset', content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } } } },
      put:    { tags: ['Assets'], summary: 'Aggiorna asset', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Assets'], summary: 'Disattiva asset (soft-delete)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Disattivato' } } },
    },
    '/assets/{id}/status': {
      patch: { tags: ['Assets'], summary: 'Aggiorna stato asset manualmente',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['operational','degraded','partial_outage','major_outage','maintenance','unknown'] } } } } } },
        responses: { 200: { description: 'Stato aggiornato' } },
      },
    },
    '/assets/{id}/probe': {
      post: { tags: ['Assets'], summary: 'Avvia probe manuale immediato',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Risultato probe' } },
      },
    },
    '/assets/{id}/probes': {
      get: { tags: ['Assets'], summary: 'Storico probe asset',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 50 } },
        ],
        responses: { 200: { description: 'Risultati probe' } },
      },
    },
    '/assets/{id}/history': {
      get: { tags: ['Assets'], summary: 'Storico stati asset',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Storico stati' } },
      },
    },
    '/assets/{id}/dependencies': {
      post:   { tags: ['Assets'], summary: 'Aggiungi dipendenza',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['depends_on_id'], properties: { depends_on_id: { type: 'string', format: 'uuid' } } } } } },
        responses: { 201: { description: 'Dipendenza creata' } },
      },
    },
    '/assets/{id}/dependencies/{depId}': {
      delete: { tags: ['Assets'], summary: 'Rimuovi dipendenza',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'depId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Rimossa' } },
      },
    },

    // ─── SERVICES ─────────────────────────────────────────────────────────────
    '/services': {
      get: { tags: ['Services'], summary: 'Lista servizi',
        parameters: [
          { in: 'query', name: 'page',   schema: { type: 'integer' } },
          { in: 'query', name: 'limit',  schema: { type: 'integer' } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'public', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'Servizi paginati' } },
      },
      post: { tags: ['Services'], summary: 'Crea servizio',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Service' } } } },
        responses: { 201: { description: 'Servizio creato' } },
      },
    },
    '/services/{id}': {
      get:    { tags: ['Services'], summary: 'Dettaglio servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Servizio' } } },
      put:    { tags: ['Services'], summary: 'Aggiorna servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Services'], summary: 'Elimina servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminato' } } },
    },
    '/services/{id}/uptime': {
      get: { tags: ['Services'], summary: 'Dati uptime ultimi 30 giorni',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Array uptime giornaliero' } },
      },
    },
    '/services/{id}/assets': {
      post:   { tags: ['Services'], summary: 'Associa asset al servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['asset_id'], properties: { asset_id: { type: 'string', format: 'uuid' } } } } } }, responses: { 201: { description: 'Associato' } } },
    },
    '/services/{id}/assets/{assetId}': {
      delete: { tags: ['Services'], summary: 'Rimuovi asset dal servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'assetId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rimosso' } } },
    },
    '/services/{id}/subscribe': {
      post:   { tags: ['Services'], summary: 'Iscriviti alle notifiche del servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Iscritto' } } },
    },
    '/services/{id}/unsubscribe': {
      post:   { tags: ['Services'], summary: 'Disiscrivi dalle notifiche del servizio', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Disiscritto' } } },
    },

    // ─── MAINTENANCE ──────────────────────────────────────────────────────────
    '/maintenance': {
      get: { tags: ['Maintenance'], summary: 'Lista manutenzioni',
        parameters: [
          { in: 'query', name: 'page',     schema: { type: 'integer' } },
          { in: 'query', name: 'limit',    schema: { type: 'integer' } },
          { in: 'query', name: 'status',   schema: { type: 'string' } },
          { in: 'query', name: 'upcoming', schema: { type: 'boolean' }, description: 'Solo manutenzioni future/in corso' },
          { in: 'query', name: 'asset_id', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Manutenzioni paginate' } },
      },
      post: { tags: ['Maintenance'], summary: 'Crea manutenzione',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MaintenanceWindow' } } } },
        responses: { 201: { description: 'Manutenzione creata — auto-pending_approval se high/critical/emergency' } },
      },
    },
    '/maintenance/calendar': {
      get: { tags: ['Maintenance'], summary: 'Manutenzioni per range date (per calendario)',
        parameters: [
          { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',   required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Array manutenzioni nel range' } },
      },
    },
    '/maintenance/{id}': {
      get:    { tags: ['Maintenance'], summary: 'Dettaglio manutenzione', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Manutenzione' } } },
      put:    { tags: ['Maintenance'], summary: 'Aggiorna manutenzione', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Aggiornata' } } },
      delete: { tags: ['Maintenance'], summary: 'Elimina manutenzione (admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminata' } } },
    },
    '/maintenance/{id}/approve': {
      post: { tags: ['Maintenance'], summary: 'Approva manutenzione (change_manager)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Approvata' } } },
    },
    '/maintenance/{id}/reject': {
      post: { tags: ['Maintenance'], summary: 'Rifiuta manutenzione (change_manager)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { 200: { description: 'Rifiutata' } },
      },
    },
    '/maintenance/{id}/start': {
      post: { tags: ['Maintenance'], summary: 'Avvia manutenzione (operator)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Avviata' } } },
    },
    '/maintenance/{id}/complete': {
      post: { tags: ['Maintenance'], summary: 'Completa manutenzione', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Completata' } } },
    },
    '/maintenance/{id}/cancel': {
      post: { tags: ['Maintenance'], summary: 'Cancella manutenzione', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cancellata' } } },
    },

    // ─── INCIDENTS ────────────────────────────────────────────────────────────
    '/incidents': {
      get: { tags: ['Incidents'], summary: 'Lista incidenti',
        parameters: [
          { in: 'query', name: 'page',     schema: { type: 'integer' } },
          { in: 'query', name: 'limit',    schema: { type: 'integer' } },
          { in: 'query', name: 'status',   schema: { type: 'string', enum: ['investigating','identified','monitoring','resolved'] } },
          { in: 'query', name: 'severity', schema: { type: 'string', enum: ['critical','high','medium','low'] } },
        ],
        responses: { 200: { description: 'Incidenti paginati' } },
      },
      post: { tags: ['Incidents'], summary: 'Crea incidente',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } } },
        responses: { 201: { description: 'Incidente creato' } },
      },
    },
    '/incidents/active': {
      get: { tags: ['Incidents'], summary: 'Incidenti attivi (non risolti)',
        responses: { 200: { description: 'Incidenti attivi' } },
      },
    },
    '/incidents/{id}': {
      get:    { tags: ['Incidents'], summary: 'Dettaglio incidente con asset e aggiornamenti', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Incidente' } } },
      put:    { tags: ['Incidents'], summary: 'Aggiorna incidente', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Incidents'], summary: 'Elimina incidente (admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminato' } } },
    },
    '/incidents/{id}/updates': {
      post: { tags: ['Incidents'], summary: 'Aggiungi aggiornamento a incidente',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message','status'], properties: {
          message: { type: 'string' },
          status:  { type: 'string', enum: ['investigating','identified','monitoring','resolved'] },
        }}}}},
        responses: { 201: { description: 'Aggiornamento aggiunto — se resolved, ripristina stato asset' } },
      },
    },

    // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
    '/notifications': {
      get: { tags: ['Notifications'], summary: 'Notifiche in-app utente corrente',
        parameters: [{ in: 'query', name: 'unread', schema: { type: 'boolean' } }],
        responses: { 200: { description: 'Notifiche + unread_count' } },
      },
    },
    '/notifications/read': {
      post: { tags: ['Notifications'], summary: 'Segna notifiche come lette',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Array di id, o ometti per segnare tutte' } } } } } },
        responses: { 200: { description: 'Notifiche aggiornate' } },
      },
    },
    '/notifications/log': {
      get: { tags: ['Notifications'], summary: 'Log notifiche inviate (admin)',
        parameters: [
          { in: 'query', name: 'page',    schema: { type: 'integer' } },
          { in: 'query', name: 'channel', schema: { type: 'string', enum: ['email','webhook','in_app'] } },
          { in: 'query', name: 'status',  schema: { type: 'string', enum: ['sent','failed'] } },
        ],
        responses: { 200: { description: 'Log notifiche' } },
      },
    },
    '/notifications/templates': {
      get: { tags: ['Notifications'], summary: 'Lista template email (admin)', responses: { 200: { description: 'Template' } } },
    },
    '/notifications/templates/{id}': {
      put: { tags: ['Notifications'], summary: 'Aggiorna template email',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { subject_template: { type: 'string' }, body_html_template: { type: 'string' } } } } } },
        responses: { 200: { description: 'Template aggiornato' } },
      },
    },

    // ─── SETTINGS ─────────────────────────────────────────────────────────────
    '/settings': {
      get: { tags: ['Settings'], summary: 'Tutte le impostazioni (admin)', responses: { 200: { description: 'Settings object' } } },
    },
    '/settings/smtp': {
      put: { tags: ['Settings'], summary: 'Salva configurazione SMTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' }, secure: { type: 'boolean' }, user: { type: 'string' }, pass: { type: 'string' }, from: { type: 'string' } } } } } },
        responses: { 200: { description: 'Salvato' } },
      },
    },
    '/settings/smtp/test': {
      post: { tags: ['Settings'], summary: 'Invia email di test SMTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { type: 'string', format: 'email' } } } } } },
        responses: { 200: { description: 'Email inviata' }, 500: { description: 'Errore SMTP' } },
      },
    },
    '/settings/ldap': {
      get: { tags: ['Settings'], summary: 'Configurazione LDAP', responses: { 200: { description: 'Config LDAP' } } },
      put: { tags: ['Settings'], summary: 'Salva configurazione LDAP', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Salvato' } } },
    },
    '/settings/ldap/test': {
      post: { tags: ['Settings'], summary: 'Test connessione LDAP', responses: { 200: { description: 'Connessione riuscita' } } },
    },
    '/settings/saml': {
      get: { tags: ['Settings'], summary: 'Configurazione SAML', responses: { 200: { description: 'Config SAML' } } },
      put: { tags: ['Settings'], summary: 'Salva configurazione SAML', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Salvato' } } },
    },
    '/settings/webhooks': {
      get: { tags: ['Settings'], summary: 'Lista webhook', responses: { 200: { description: 'Webhook' } } },
      put: { tags: ['Settings'], summary: 'Salva webhook', requestBody: { required: true, content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['teams','slack','generic'] }, events: { type: 'array', items: { type: 'string' } } } } } } } }, responses: { 200: { description: 'Salvati' } } },
    },
    '/settings/general': {
      get: { tags: ['Settings'], summary: 'Impostazioni generali', responses: { 200: { description: 'General settings' } } },
      put: { tags: ['Settings'], summary: 'Salva impostazioni generali', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Salvato' } } },
    },

    // ─── STATUS ───────────────────────────────────────────────────────────────
    '/status': {
      get: { tags: ['Status'], summary: 'Status page pubblica (no auth)', security: [],
        responses: { 200: { description: 'Stato globale, servizi, incidenti attivi, manutenzioni programmate' } },
      },
    },
    '/status/services/{slug}': {
      get: { tags: ['Status'], summary: 'Dettaglio servizio su status page', security: [],
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string', example: 'erp-gestionale' } }],
        responses: { 200: { description: 'Servizio con storico 90 giorni' } },
      },
    },

    // ─── REPORTS ──────────────────────────────────────────────────────────────
    '/reports/dashboard': {
      get: { tags: ['Reports'], summary: 'Dati dashboard (contatori, uptime medio…)',
        responses: { 200: { description: 'Dashboard stats' } },
      },
    },
    '/reports/maintenance': {
      get: { tags: ['Reports'], summary: 'Report manutenzioni',
        parameters: [
          { in: 'query', name: 'from',   schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',     schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'format', schema: { type: 'string', enum: ['json','csv','pdf'], default: 'json' } },
        ],
        responses: {
          200: { description: 'JSON / CSV / PDF in base al parametro format' },
        },
      },
    },
    '/reports/uptime': {
      get: { tags: ['Reports'], summary: 'Uptime per servizio',
        parameters: [
          { in: 'query', name: 'from', schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',   schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Uptime % per servizio' } },
      },
    },
    '/reports/assets': {
      get: { tags: ['Reports'], summary: 'Report asset (contatori per tipo/stato/criticità)',
        responses: { 200: { description: 'Stats asset' } },
      },
    },

    // ─── TEMPLATES ────────────────────────────────────────────────────────────
    '/templates/maintenance': {
      get:  { tags: ['Templates'], summary: 'Lista template manutenzione', responses: { 200: { description: 'Template' } } },
      post: { tags: ['Templates'], summary: 'Crea template',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Template' } } } },
        responses: { 201: { description: 'Template creato' } },
      },
    },
    '/templates/maintenance/{id}': {
      get:    { tags: ['Templates'], summary: 'Dettaglio template', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Template' } } },
      put:    { tags: ['Templates'], summary: 'Aggiorna template', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Templates'], summary: 'Elimina template', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminato' } } },
    },

    // ─── BLACKOUT ─────────────────────────────────────────────────────────────
    '/blackout': {
      get:  { tags: ['Blackout'], summary: 'Lista periodi di blackout', responses: { 200: { description: 'Periodi' } } },
      post: { tags: ['Blackout'], summary: 'Crea periodo blackout',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BlackoutPeriod' } } } },
        responses: { 201: { description: 'Periodo creato' } },
      },
    },
    '/blackout/check': {
      get: { tags: ['Blackout'], summary: 'Verifica se un intervallo cade in un blackout',
        parameters: [
          { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'to',   required: true, schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Risultato check: { in_blackout: boolean, period?: BlackoutPeriod }' } },
      },
    },
    '/blackout/{id}': {
      get:    { tags: ['Blackout'], summary: 'Dettaglio periodo', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Periodo' } } },
      put:    { tags: ['Blackout'], summary: 'Aggiorna periodo', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Aggiornato' } } },
      delete: { tags: ['Blackout'], summary: 'Elimina periodo', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Eliminato' } } },
    },

    // ─── API KEYS ─────────────────────────────────────────────────────────────
    '/apikeys': {
      get:  { tags: ['ApiKeys'], summary: 'Lista API keys (masked)',
        responses: { 200: { description: 'Keys', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, key_prefix: { type: 'string' }, expires_at: { type: 'string', format: 'date-time', nullable: true }, last_used_at: { type: 'string', format: 'date-time', nullable: true } } } } } } } },
      },
      post: { tags: ['ApiKeys'], summary: 'Crea API key — restituisce la chiave completa UNA sola volta',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, expires_at: { type: 'string', format: 'date-time' } } } } } },
        responses: { 201: { description: 'Key creata', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string', description: 'Valore completo — conservare, non sarà più visibile' } } } } } } },
      },
    },
    '/apikeys/{id}': {
      patch:  { tags: ['ApiKeys'], summary: 'Aggiorna nome/scadenza key', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Aggiornata' } } },
      delete: { tags: ['ApiKeys'], summary: 'Revoca API key', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Revocata' } } },
    },

    // ─── AUDIT ────────────────────────────────────────────────────────────────
    '/audit': {
      get: { tags: ['Audit'], summary: 'Audit log (admin)',
        parameters: [
          { in: 'query', name: 'page',        schema: { type: 'integer' } },
          { in: 'query', name: 'limit',       schema: { type: 'integer' } },
          { in: 'query', name: 'user_id',     schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'username',    schema: { type: 'string' } },
          { in: 'query', name: 'action',      schema: { type: 'string' } },
          { in: 'query', name: 'entity_type', schema: { type: 'string' } },
          { in: 'query', name: 'from',        schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',          schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Log paginati', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
      },
    },

    // ─── HEALTH ───────────────────────────────────────────────────────────────
    '/health': {
      get: { tags: ['Auth'], summary: 'Health check (no auth)', security: [],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, ts: { type: 'string', format: 'date-time' } } } } } } },
      },
    },
  },
};

module.exports = spec;
