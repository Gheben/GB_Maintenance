'use strict';

/** @type {import('swagger-ui-express').JsonObject} */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'GB Maintenance API',
    version: '1.0.0',
    description: `
## Authentication

Most endpoints require a **JWT Bearer token**.

**How to get the token:**

\`\`\`
POST /api/auth/login
{ "username": "sysadmin", "password": "sysadminpassword!" }
\`\`\`

Copy the \`token\` field from the response, click **"Authorize"** (🔓) at the top of this page, and paste it.

The token is valid for the duration configured in \`JWT_EXPIRES_IN\` (default **8 hours**).

---

### Date format for license approval APIs

For license approval/status endpoints, date fields are returned as **formatted strings** for UI/email consistency:

- Date only: \`dd/MM/yyyy\`
- Date+time: \`dd/MM/yyyy, HH:mm\`

---

### Role hierarchy

| Role | Level |
|---|---|
| \`superadmin\` | Full access |
| \`admin\` | Manage users, assets, services, maintenance, settings |
| \`change_manager\` | Approve/reject maintenance |
| \`operator\` | Create and manage assets, services, maintenance, incidents |
| \`viewer\` | Read-only |
| \`subscriber\` | Status page and notifications only |

---

### API Keys

As an alternative to JWT, you can use an **API Key** in the header:
\`\`\`
X-Api-Key: gbm_your_api_key_here
\`\`\`

API keys are created from **Settings -> API Keys**.
    `,
  },
  servers: [{ url: '/api', description: 'Current server' }],
  tags: [
    { name: 'Auth',          description: 'Authentication, sessions, TOTP, SAML' },
    { name: 'Users',         description: 'User management' },
    { name: 'Groups',        description: 'Local groups and LDAP mappings' },
    { name: 'Assets',        description: 'Company assets (servers, VMs, network services)' },
    { name: 'Services',      description: 'Application services' },
    { name: 'Licenses',      description: 'License lifecycle, approval workflow, and public approval/status pages' },
    { name: 'Maintenance',   description: 'Scheduled and unscheduled maintenance windows' },
    { name: 'Incidents',     description: 'Incidents and status updates' },
    { name: 'Notifications', description: 'In-app notifications and logs' },
    { name: 'Settings',      description: 'SMTP, LDAP, SAML, webhook, and general configuration' },
    { name: 'Status',        description: 'Public status page' },
    { name: 'Reports',       description: 'Reports and dashboard' },
    { name: 'Templates',     description: 'Maintenance templates' },
    { name: 'Blackout',      description: 'Blackout periods (maintenance not allowed)' },
    { name: 'ApiKeys',       description: 'API Keys for programmatic access' },
    { name: 'Audit',         description: 'Audit log' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT obtained from POST /api/auth/login',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Api-Key',
        description: 'API Key created from Settings -> API Keys',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Unauthorized' } },
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
          office:       { type: 'string', example: 'Milan HQ', nullable: true },
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
          title:           { type: 'string', example: 'Web server kernel update' },
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
          title:       { type: 'string', example: 'Database unreachable' },
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
          name:             { type: 'string', example: 'Monthly patch' },
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
          name:        { type: 'string', example: 'Christmas freeze' },
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
        tags: ['Auth'], summary: 'Login (local or LDAP)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['username','password'],
            properties: {
              username:  { type: 'string', example: 'sysadmin' },
              password:  { type: 'string', example: 'sysadminpassword!' },
              totp_code: { type: 'string', example: '123456', description: 'Required if TOTP is enabled' },
            },
          }}},
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: {
            type: 'object', properties: {
              token: { type: 'string' },
              user:  { $ref: '#/components/schemas/User' },
              totp_required: { type: 'boolean', description: 'If true, provide totp_code and retry' },
            },
          }}}},
          401: { description: 'Invalid credentials' },
          423: { description: 'Account locked (too many attempts)' },
        },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Logout (revoke current session)',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } } },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user profile',
        responses: { 200: { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/auth/change-password': {
      post: { tags: ['Auth'], summary: 'Change password',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['current_password','new_password'],
          properties: { current_password: { type: 'string' }, new_password: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'Password changed' }, 400: { description: 'Current password is incorrect' } },
      },
    },
    '/auth/sessions': {
      get: { tags: ['Auth'], summary: 'Active session list',
        responses: { 200: { description: 'Sessions', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
      delete: { tags: ['Auth'], summary: 'Revoke all sessions',
        responses: { 200: { description: 'Sessions revoked' } },
      },
    },
    '/auth/totp/setup': {
      post: { tags: ['Auth'], summary: 'Start TOTP setup - returns QR code and secret',
        responses: { 200: { description: 'Setup TOTP', content: { 'application/json': { schema: {
          type: 'object', properties: { qr_url: { type: 'string' }, secret: { type: 'string' } },
        }}}},
        },
      },
    },
    '/auth/totp/verify': {
      post: { tags: ['Auth'], summary: 'Verify and enable TOTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'],
          properties: { token: { type: 'string', example: '123456' } },
        }}}},
        responses: { 200: { description: 'TOTP enabled' }, 400: { description: 'Invalid code' } },
      },
    },
    '/auth/totp/disable': {
      post: { tags: ['Auth'], summary: 'Disable TOTP',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['token'],
          properties: { token: { type: 'string' } },
        }}}},
        responses: { 200: { description: 'TOTP disabled' } },
      },
    },
    '/auth/saml/metadata': {
      get: { tags: ['Auth'], summary: 'SP Metadata XML for SAML IdP configuration', security: [],
        responses: { 200: { description: 'XML metadata', content: { 'application/xml': {} } } },
      },
    },
    '/auth/saml/login': {
      get: { tags: ['Auth'], summary: 'Redirect to SAML IdP for login', security: [],
        responses: { 302: { description: 'Redirect to IdP' } },
      },
    },
    '/auth/webauthn/register/options': {
      post: { tags: ['Auth'], summary: 'Get passkey registration options (local accounts only)',
        responses: { 200: { description: 'WebAuthn registration options' }, 403: { description: 'Not a local account' } },
      },
    },
    '/auth/webauthn/register/verify': {
      post: { tags: ['Auth'], summary: 'Verify and store a newly registered passkey',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['response'],
          properties: { response: { type: 'object' }, name: { type: 'string', nullable: true, example: 'Work laptop' } },
        }}}},
        responses: { 200: { description: 'Passkey registered' }, 400: { description: 'Verification failed' } },
      },
    },
    '/auth/webauthn/credentials': {
      get: { tags: ['Auth'], summary: 'List the current user\'s registered passkeys',
        responses: { 200: { description: 'Passkey list', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
    },
    '/auth/webauthn/credentials/{id}': {
      delete: { tags: ['Auth'], summary: 'Remove a registered passkey', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Passkey removed' } },
      },
    },
    '/auth/webauthn/login/options': {
      post: { tags: ['Auth'], summary: 'Get passkey (usernameless) login options', security: [],
        responses: { 200: { description: 'WebAuthn authentication options' } },
      },
    },
    '/auth/webauthn/login/verify': {
      post: { tags: ['Auth'], summary: 'Verify a passkey login assertion and issue a session token', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['response'],
          properties: { response: { type: 'object' } },
        }}}},
        responses: { 200: { description: 'Login successful', content: { 'application/json': { schema: {
          type: 'object', properties: { token: { type: 'string' }, user: { $ref: '#/components/schemas/User' } },
        }}}}, 401: { description: 'Verification failed' } },
      },
    },

    // ─── USERS ────────────────────────────────────────────────────────────────
    '/users': {
      get: { tags: ['Users'], summary: 'User list (admin)',
        parameters: [
          { in: 'query', name: 'page',  schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'User list', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
      },
      post: { tags: ['Users'], summary: 'Create local user (admin)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username','password','email'],
          properties: {
            username:     { type: 'string' },
            password:     { type: 'string' },
            email:        { type: 'string', format: 'email' },
            office:       { type: 'string', nullable: true },
            display_name: { type: 'string' },
            role:         { type: 'string', enum: ['admin','change_manager','operator','viewer','subscriber'], default: 'operator' },
            permissions:  { type: 'object' },
          },
        }}}},
        responses: { 201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/users/assignable': {
      get: { tags: ['Users'], summary: 'Minimal user list for owner pickers (any authenticated user)',
        parameters: [
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: { 200: { description: 'Users', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, display_name: { type: 'string' }, email: { type: 'string' }, auth_type: { type: 'string' },
        } } } } } } },
      },
    },
    '/users/{id}': {
      get:    { tags: ['Users'], summary: 'User details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } },
      put:    { tags: ['Users'], summary: 'Update user', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        responses: { 200: { description: 'User updated' } } },
      delete: { tags: ['Users'], summary: 'Delete user', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Deleted' } } },
    },

    // ─── GROUPS ───────────────────────────────────────────────────────────────
    '/groups': {
      get:  { tags: ['Groups'], summary: 'Local group list',
        responses: { 200: { description: 'Groups', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, description: { type: 'string' } } } } } } } },
      },
      post: { tags: ['Groups'], summary: 'Create group',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 201: { description: 'Group created' } },
      },
    },
    '/groups/assignable': {
      get: { tags: ['Groups'], summary: 'Minimal local group list for owner pickers (any authenticated user)',
        parameters: [{ in: 'query', name: 'q', schema: { type: 'string' } }],
        responses: { 200: { description: 'Groups', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, ldap_mapping_count: { type: 'integer' },
        } } } } } } },
      },
    },
    '/groups/{id}': {
      get:    { tags: ['Groups'], summary: 'Group details with members and LDAP mappings', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Group' } } },
      put:    { tags: ['Groups'], summary: 'Update group', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Groups'], summary: 'Delete group', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/groups/{id}/members': {
      post:   { tags: ['Groups'], summary: 'Add member', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['user_id'], properties: { user_id: { type: 'string', format: 'uuid' } } } } } }, responses: { 201: { description: 'Member added' } } },
    },
    '/groups/{id}/members/{userId}': {
      delete: { tags: ['Groups'], summary: 'Remove member', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'userId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removed' } } },
    },
    '/groups/ldap/mappings': {
      get:  { tags: ['Groups'], summary: 'LDAP-to-group mapping list', responses: { 200: { description: 'Mappings' } } },
      post: { tags: ['Groups'], summary: 'Create LDAP mapping',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ldap_group_dn','local_group_id'], properties: { ldap_group_dn: { type: 'string' }, local_group_id: { type: 'string', format: 'uuid' } } } } } },
        responses: { 201: { description: 'Mapping created' } },
      },
    },

    // ─── ASSETS ───────────────────────────────────────────────────────────────
    '/assets': {
      get: { tags: ['Assets'], summary: 'Asset list',
        parameters: [
          { in: 'query', name: 'page',   schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit',  schema: { type: 'integer', default: 20 } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'criticality', schema: { type: 'string', enum: ['critical','high','medium','low'] } },
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'type',   schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Paginated assets', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
      },
      post: { tags: ['Assets'], summary: 'Create asset',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } },
        responses: { 201: { description: 'Asset created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } } },
      },
    },
    '/assets/{id}': {
      get:    { tags: ['Assets'], summary: 'Asset details with dependencies and services', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Asset', content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } } } },
      put:    { tags: ['Assets'], summary: 'Update asset', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Assets'], summary: 'Deactivate asset (soft delete)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deactivated' } } },
    },
    '/assets/{id}/status': {
      patch: { tags: ['Assets'], summary: 'Update asset status manually',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['operational','degraded','partial_outage','major_outage','maintenance','unknown'] } } } } } },
        responses: { 200: { description: 'Status updated' } },
      },
    },
    '/assets/{id}/probe': {
      post: { tags: ['Assets'], summary: 'Run manual probe now',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Probe result' } },
      },
    },
    '/assets/{id}/probes': {
      get: { tags: ['Assets'], summary: 'Asset probe history',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 50 } },
        ],
        responses: { 200: { description: 'Probe results' } },
      },
    },
    '/assets/{id}/history': {
      get: { tags: ['Assets'], summary: 'Asset status history',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Status history' } },
      },
    },
    '/assets/{id}/dependencies': {
      post:   { tags: ['Assets'], summary: 'Add dependency',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['depends_on_id'], properties: { depends_on_id: { type: 'string', format: 'uuid' } } } } } },
        responses: { 201: { description: 'Dependency created' } },
      },
    },
    '/assets/{id}/dependencies/{depId}': {
      delete: { tags: ['Assets'], summary: 'Remove dependency',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'depId', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Removed' } },
      },
    },

    // ─── SERVICES ─────────────────────────────────────────────────────────────
    '/services': {
      get: { tags: ['Services'], summary: 'Service list',
        parameters: [
          { in: 'query', name: 'page',   schema: { type: 'integer' } },
          { in: 'query', name: 'limit',  schema: { type: 'integer' } },
          { in: 'query', name: 'search', schema: { type: 'string' } },
          { in: 'query', name: 'public', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'Paginated services' } },
      },
      post: { tags: ['Services'], summary: 'Create service',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Service' } } } },
        responses: { 201: { description: 'Service created' } },
      },
    },
    '/services/{id}': {
      get:    { tags: ['Services'], summary: 'Service details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Service' } } },
      put:    { tags: ['Services'], summary: 'Update service', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Services'], summary: 'Delete service', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/services/{id}/uptime': {
      get: { tags: ['Services'], summary: 'Uptime data for last 30 days',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Daily uptime array' } },
      },
    },
    '/services/{id}/assets': {
      post:   { tags: ['Services'], summary: 'Attach asset to service', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['asset_id'], properties: { asset_id: { type: 'string', format: 'uuid' } } } } } }, responses: { 201: { description: 'Attached' } } },
    },
    '/services/{id}/assets/{assetId}': {
      delete: { tags: ['Services'], summary: 'Remove asset from service', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }, { in: 'path', name: 'assetId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removed' } } },
    },
    '/services/{id}/subscribe': {
      post:   { tags: ['Services'], summary: 'Subscribe to service notifications', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Subscribed' } } },
    },
    '/services/{id}/unsubscribe': {
      post:   { tags: ['Services'], summary: 'Unsubscribe from service notifications', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Unsubscribed' } } },
    },

    // ─── MAINTENANCE ──────────────────────────────────────────────────────────
    '/licenses': {
      get: { tags: ['Licenses'], summary: 'License list (paginated) with formatted date fields',
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 25 } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Paginated licenses. Date fields are returned as dd/MM/yyyy or dd/MM/yyyy, HH:mm.' } },
      },
    },
    '/licenses/{id}': {
      get: { tags: ['Licenses'], summary: 'License details with linked assets/services and formatted date fields',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'License details' } },
      },
    },
    '/licenses/{id}/request-approval': {
      post: { tags: ['Licenses'], summary: 'Send approval request email + in-app notifications to internal actors',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { expiry_hours: { type: 'integer', minimum: 1, maximum: 168 } } } } },
        },
        responses: {
          200: { description: 'Approval request sent. Response dates are formatted string values.' },
          400: { description: 'Validation/configuration error' },
          404: { description: 'License not found' },
        },
      },
    },
    '/licenses/approval/{token}': {
      get: { tags: ['Licenses'], summary: 'Public approval link details (formatted date fields)', security: [],
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Approval request info' },
          404: { description: 'Approval link not found' },
          410: { description: 'Approval link expired' },
        },
      },
    },
    '/licenses/approval/{token}/requests': {
      get: { tags: ['Licenses'], summary: 'Public approval list scoped by approver identity (formatted date fields)', security: [],
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Pending requests for this approver scope' } },
      },
    },
    '/licenses/approval/{token}/request/{id}': {
      get: { tags: ['Licenses'], summary: 'Public approval request details by request id (formatted date fields)', security: [],
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Approval request detail' } },
      },
    },
    '/licenses/status/{token}': {
      get: { tags: ['Licenses'], summary: 'Public approval status by status token (formatted date fields)', security: [],
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Approval status details (dates are formatted strings)' },
          404: { description: 'Status link not found' },
          410: { description: 'Status link expired' },
        },
      },
    },
    '/assets/{id}/licenses': {
      get: { tags: ['Assets'], summary: 'Asset-license assignments with formatted license expiry date',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'License rows linked/available for the asset' } },
      },
    },
    '/services/{id}/licenses': {
      get: { tags: ['Services'], summary: 'Service-license assignments with formatted license expiry date',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'License rows linked/available for the service' } },
      },
    },

    // ─── MAINTENANCE ──────────────────────────────────────────────────────────
    '/maintenance': {
      get: { tags: ['Maintenance'], summary: 'Maintenance list',
        parameters: [
          { in: 'query', name: 'page',     schema: { type: 'integer' } },
          { in: 'query', name: 'limit',    schema: { type: 'integer' } },
          { in: 'query', name: 'status',   schema: { type: 'string' } },
          { in: 'query', name: 'upcoming', schema: { type: 'boolean' }, description: 'Only future/in-progress maintenance' },
          { in: 'query', name: 'asset_id', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Paginated maintenance' } },
      },
      post: { tags: ['Maintenance'], summary: 'Create maintenance',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MaintenanceWindow' } } } },
        responses: { 201: { description: 'Maintenance created - auto pending_approval for high/critical/emergency' } },
      },
    },
    '/maintenance/calendar': {
      get: { tags: ['Maintenance'], summary: 'Maintenance by date range (for calendar)',
        parameters: [
          { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',   required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Maintenance array in range' } },
      },
    },
    '/maintenance/{id}': {
      get:    { tags: ['Maintenance'], summary: 'Maintenance details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Maintenance' } } },
      put:    { tags: ['Maintenance'], summary: 'Update maintenance', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Maintenance'], summary: 'Delete maintenance (admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/maintenance/{id}/approve': {
      post: { tags: ['Maintenance'], summary: 'Approve maintenance (change_manager)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Approved' } } },
    },
    '/maintenance/{id}/reject': {
      post: { tags: ['Maintenance'], summary: 'Reject maintenance (change_manager)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { 200: { description: 'Rejected' } },
      },
    },
    '/maintenance/{id}/start': {
      post: { tags: ['Maintenance'], summary: 'Start maintenance (operator)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Started' } } },
    },
    '/maintenance/{id}/complete': {
      post: { tags: ['Maintenance'], summary: 'Complete maintenance', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Completed' } } },
    },
    '/maintenance/{id}/cancel': {
      post: { tags: ['Maintenance'], summary: 'Cancel maintenance', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Cancelled' } } },
    },

    // ─── INCIDENTS ────────────────────────────────────────────────────────────
    '/incidents': {
      get: { tags: ['Incidents'], summary: 'Incident list',
        parameters: [
          { in: 'query', name: 'page',     schema: { type: 'integer' } },
          { in: 'query', name: 'limit',    schema: { type: 'integer' } },
          { in: 'query', name: 'status',   schema: { type: 'string', enum: ['investigating','identified','monitoring','resolved'] } },
          { in: 'query', name: 'severity', schema: { type: 'string', enum: ['critical','high','medium','low'] } },
        ],
        responses: { 200: { description: 'Paginated incidents' } },
      },
      post: { tags: ['Incidents'], summary: 'Create incident',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } } },
        responses: { 201: { description: 'Incident created' } },
      },
    },
    '/incidents/active': {
      get: { tags: ['Incidents'], summary: 'Active incidents (unresolved)',
        responses: { 200: { description: 'Active incidents' } },
      },
    },
    '/incidents/{id}': {
      get:    { tags: ['Incidents'], summary: 'Incident details with assets and updates', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Incident' } } },
      put:    { tags: ['Incidents'], summary: 'Update incident', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Incidents'], summary: 'Delete incident (admin)', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },
    '/incidents/{id}/updates': {
      post: { tags: ['Incidents'], summary: 'Add incident update',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message','status'], properties: {
          message: { type: 'string' },
          status:  { type: 'string', enum: ['investigating','identified','monitoring','resolved'] },
        }}}}},
        responses: { 201: { description: 'Update added - if resolved, restore asset status' } },
      },
    },    '/incidents/{id}/rca': {
      put: { tags: ['Incidents'], summary: 'Save the root cause analysis for an incident',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          root_cause: { type: 'string' }, resolution_summary: { type: 'string' }, preventive_actions: { type: 'string' },
          mark_completed: { type: 'boolean' },
        }}}}},
        responses: { 200: { description: 'RCA saved' }, 404: { description: 'Incident not found' } },
      },
    },
    '/incidents/{id}/rca/export': {
      get: { tags: ['Incidents'], summary: 'Export the root cause analysis as a PDF report',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PDF file', content: { 'application/pdf': {} } } },
      },
    },
    // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
    '/notifications': {
      get: { tags: ['Notifications'], summary: 'Current user in-app notifications (includes license workflow/expiry events for internal users)',
        parameters: [{ in: 'query', name: 'unread', schema: { type: 'boolean' } }],
        responses: { 200: { description: 'Notifications + unread_count' } },
      },
    },
    '/notifications/read': {
      post: { tags: ['Notifications'], summary: 'Mark notifications as read',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Array of IDs, or omit to mark all' } } } } } },
        responses: { 200: { description: 'Notifications updated' } },
      },
    },
    '/notifications/log': {
      get: { tags: ['Notifications'], summary: 'Sent notifications log (admin)',
        parameters: [
          { in: 'query', name: 'page',    schema: { type: 'integer' } },
          { in: 'query', name: 'channel', schema: { type: 'string', enum: ['email','webhook','in_app'] } },
          { in: 'query', name: 'status',  schema: { type: 'string', enum: ['sent','failed'] } },
        ],
        responses: { 200: { description: 'Notification logs' } },
      },
    },
    '/notifications/templates': {
      get: { tags: ['Notifications'], summary: 'Email template list (admin)', responses: { 200: { description: 'Template' } } },
    },
    '/notifications/templates/{id}': {
      put: { tags: ['Notifications'], summary: 'Update email template',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { subject_template: { type: 'string' }, body_html_template: { type: 'string' } } } } } },
        responses: { 200: { description: 'Template updated' } },
      },
    },
    '/notifications/push/public-key': {
      get: { tags: ['Notifications'], summary: 'Get the VAPID public key for Web Push subscriptions',
        responses: { 200: { description: 'Public key', content: { 'application/json': { schema: { type: 'object', properties: { publicKey: { type: 'string' } } } } } } },
      },
    },
    '/notifications/push/subscribe': {
      post: { tags: ['Notifications'], summary: 'Register a browser push subscription for the current user',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['subscription'], properties: { subscription: { type: 'object' } } } } } },
        responses: { 200: { description: 'Subscription saved' } },
      },
    },
    '/notifications/push/unsubscribe': {
      post: { tags: ['Notifications'], summary: 'Remove a browser push subscription for the current user',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string' } } } } } },
        responses: { 200: { description: 'Subscription removed' } },
      },
    },

    // ─── SETTINGS ─────────────────────────────────────────────────────────────
    '/settings': {
      get: { tags: ['Settings'], summary: 'All settings (admin)', responses: { 200: { description: 'Settings object' } } },
    },
    '/settings/smtp': {
      put: { tags: ['Settings'], summary: 'Save SMTP configuration',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' }, secure: { type: 'boolean' }, user: { type: 'string' }, pass: { type: 'string' }, from: { type: 'string' } } } } } },
        responses: { 200: { description: 'Saved' } },
      },
    },
    '/settings/smtp/test': {
      post: { tags: ['Settings'], summary: 'Send SMTP test email',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { type: 'string', format: 'email' } } } } } },
        responses: { 200: { description: 'Email sent' }, 500: { description: 'SMTP error' } },
      },
    },
    '/settings/ldap': {
      get: { tags: ['Settings'], summary: 'LDAP configuration', responses: { 200: { description: 'Config LDAP' } } },
      put: { tags: ['Settings'], summary: 'Save LDAP configuration', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Saved' } } },
    },
    '/settings/ldap/test': {
      post: { tags: ['Settings'], summary: 'Test LDAP connection', responses: { 200: { description: 'Connection successful' } } },
    },
    '/settings/saml': {
      get: { tags: ['Settings'], summary: 'SAML configuration', responses: { 200: { description: 'Config SAML' } } },
      put: { tags: ['Settings'], summary: 'Save SAML configuration', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Saved' } } },
    },
    '/settings/webhooks': {
      get: { tags: ['Settings'], summary: 'Webhook list', responses: { 200: { description: 'Webhook' } } },
      put: { tags: ['Settings'], summary: 'Save webhooks', requestBody: { required: true, content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['teams','slack','generic'] }, events: { type: 'array', items: { type: 'string' } } } } } } } }, responses: { 200: { description: 'Saved' } } },
    },
    '/settings/general': {
      get: { tags: ['Settings'], summary: 'General settings', responses: { 200: { description: 'General settings' } } },
      put: { tags: ['Settings'], summary: 'Save general settings', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Saved' } } },
    },

    // ─── STATUS ───────────────────────────────────────────────────────────────
    '/status': {
      get: { tags: ['Status'], summary: 'Public status page (no auth)', security: [],
        responses: { 200: { description: 'Global status, services, active incidents, scheduled maintenance' } },
      },
    },
    '/status/services/{slug}': {
      get: { tags: ['Status'], summary: 'Service details on status page', security: [],
        parameters: [{ in: 'path', name: 'slug', required: true, schema: { type: 'string', example: 'erp-gestionale' } }],
        responses: { 200: { description: 'Service with 90-day history' } },
      },
    },

    // ─── REPORTS ──────────────────────────────────────────────────────────────
    '/reports/dashboard': {
      get: { tags: ['Reports'], summary: 'Dashboard data (counters, average uptime...)',
        responses: { 200: { description: 'Dashboard stats' } },
      },
    },
    '/reports/maintenance': {
      get: { tags: ['Reports'], summary: 'Maintenance report',
        parameters: [
          { in: 'query', name: 'from',   schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',     schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'format', schema: { type: 'string', enum: ['json','csv','xlsx','pdf'], default: 'json' } },
        ],
        responses: {
          200: { description: 'JSON / CSV / PDF based on the format parameter' },
        },
      },
    },
    '/reports/uptime': {
      get: { tags: ['Reports'], summary: 'Uptime per service',
        parameters: [
          { in: 'query', name: 'from', schema: { type: 'string', format: 'date' } },
          { in: 'query', name: 'to',   schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Uptime % per service' } },
      },
    },
    '/reports/assets': {
      get: { tags: ['Reports'], summary: 'Asset report with CSV/Excel export',
        parameters: [{ in: 'query', name: 'format', schema: { type: 'string', enum: ['json','csv','xlsx','pdf'], default: 'json' } }],
        responses: { 200: { description: 'Stats asset' } },
      },
    },
    '/reports/licenses': {
      get: { tags: ['Reports'], summary: 'License report with CSV/Excel/PDF export',
        parameters: [{ in: 'query', name: 'format', schema: { type: 'string', enum: ['json','csv','xlsx','pdf'], default: 'json' } }],
        responses: { 200: { description: 'License report' } },
      },
    },

    // ─── TEMPLATES ────────────────────────────────────────────────────────────
    '/templates/maintenance': {
      get:  { tags: ['Templates'], summary: 'Maintenance template list', responses: { 200: { description: 'Template' } } },
      post: { tags: ['Templates'], summary: 'Create template',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Template' } } } },
        responses: { 201: { description: 'Template created' } },
      },
    },
    '/templates/maintenance/{id}': {
      get:    { tags: ['Templates'], summary: 'Template details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Template' } } },
      put:    { tags: ['Templates'], summary: 'Update template', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Templates'], summary: 'Delete template', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },

    // ─── BLACKOUT ─────────────────────────────────────────────────────────────
    '/blackout': {
      get:  { tags: ['Blackout'], summary: 'Blackout period list', responses: { 200: { description: 'Periods' } } },
      post: { tags: ['Blackout'], summary: 'Create blackout period',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BlackoutPeriod' } } } },
        responses: { 201: { description: 'Period created' } },
      },
    },
    '/blackout/check': {
      get: { tags: ['Blackout'], summary: 'Check whether a range falls in a blackout period',
        parameters: [
          { in: 'query', name: 'from', required: true, schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'to',   required: true, schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Check result: { in_blackout: boolean, period?: BlackoutPeriod }' } },
      },
    },
    '/blackout/{id}': {
      get:    { tags: ['Blackout'], summary: 'Period details', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Period' } } },
      put:    { tags: ['Blackout'], summary: 'Update period', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: {} } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['Blackout'], summary: 'Delete period', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
    },

    // ─── API KEYS ─────────────────────────────────────────────────────────────
    '/apikeys': {
      get:  { tags: ['ApiKeys'], summary: 'API key list (masked)',
        responses: { 200: { description: 'Keys', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, key_prefix: { type: 'string' }, expires_at: { type: 'string', format: 'date-time', nullable: true }, last_used_at: { type: 'string', format: 'date-time', nullable: true } } } } } } } },
      },
      post: { tags: ['ApiKeys'], summary: 'Create API key - returns the full key ONLY once',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, expires_at: { type: 'string', format: 'date-time' } } } } } },
        responses: { 201: { description: 'Key created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string', description: 'Full value - store it, it will not be visible again' } } } } } } },
      },
    },
    '/apikeys/{id}': {
      patch:  { tags: ['ApiKeys'], summary: 'Update key name/expiration', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: { description: 'Updated' } } },
      delete: { tags: ['ApiKeys'], summary: 'Revoke API key', parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Revoked' } } },
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
        responses: { 200: { description: 'Paginated logs', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pagination' } } } } },
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
