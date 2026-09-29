# GB Maintenance Wiki

This document is the operational reference for GB Maintenance. It complements the [Product Manual](manual/README.md), which contains the visual walkthrough and screenshots.

## Contents

- [Product Scope](#product-scope)
- [Application Modules](#application-modules)
- [Roles and Permissions](#roles-and-permissions)
- [Authentication](#authentication)
- [Assets and Services](#assets-and-services)
- [Maintenance and Approvals](#maintenance-and-approvals)
- [Incidents and Status](#incidents-and-status)
- [Licenses and Suppliers](#licenses-and-suppliers)
- [Monitoring and Probes](#monitoring-and-probes)
- [Dashboard and Reports](#dashboard-and-reports)
- [Notifications](#notifications)
- [Settings](#settings)
- [Data Migration](#data-migration)
- [Backup and Restore](#backup-and-restore)
- [API and Integrations](#api-and-integrations)
- [Security Checklist](#security-checklist)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Product Scope

GB Maintenance is an operations platform for tracking infrastructure assets, IT services, maintenance windows, incidents, software licenses, suppliers, ownership, approvals, notifications, and service health.

The application consists of:

- React and Vite frontend served by Nginx.
- Express backend API.
- PostgreSQL database with automatic migrations.
- Background scheduler for reminders and probes.
- WebSocket service for live updates.
- Optional LDAP/Active Directory, SAML 2.0, reverse-proxy SSO, SMTP, and PWA support.

## Application Modules

| Area | Main capabilities | Route |
|---|---|---|
| Dashboard | KPIs, asset charts, maintenance charts, expiring licenses, pending owner approvals | `/` |
| Assets | Inventory, categories, owners, users, licenses, maintenance, probes, dependencies, correlation graph | `/assets` |
| Services | Service catalog, SLA, owners, subscribers, linked assets, dependencies, probes, licenses, correlation graph | `/services` |
| Maintenance | Scheduling, impact, affected scope, approvals, status lifecycle, recurrence, calendar, subscribers | `/maintenance` |
| Incidents | Severity, status lifecycle, timeline updates, affected assets/services, involved users | `/incidents` |
| Calendar | Monthly maintenance planning and event overview | `/calendar` |
| Licenses | Expiry, renewal, approval, suppliers, linked assets/services, documents, renewal history, CSV report | `/licenses` |
| Suppliers | Company contacts, SLA details, contracts, emergency contacts, documents | `/licenses` |
| Notifications | In-app notifications, read state, notification log, linked detail previews | `/notifications` |
| Reports | Maintenance, asset, and license reports with CSV/Excel/PDF exports; uptime analytics | `/reports` |
| Users and Groups | Local users, roles, permissions, groups, LDAP mappings, sessions | `/users` |
| Settings | SMTP, templates, LDAP, SAML, API keys, system governance, migration and deletion | `/settings` |
| Audit | Operation history for privileged users | `/audit` |
| Public status | Public service health and maintenance view | `/status` |
| API documentation | Authenticated Swagger/OpenAPI reference | `/docs` |

## Roles and Permissions

| Role | Intended use | Default access |
|---|---|---|
| `superadmin` | Full platform administration | All permissions and superadmin-only settings |
| `admin` | Operational administration | Users, assets, services, maintenance, settings, reports and API keys |
| `change_manager` | Change approval and governance | Assets, services, maintenance approvals, incidents, reports and audit |
| `operator` | Day-to-day operations | Assets, services, maintenance, incidents, calendar, status and notifications |
| `viewer` | Read-only access | Dashboard, assets, services, maintenance, incidents, calendar, status and notifications |
| `subscriber` | Status and notification consumer | Calendar, status page and notifications |

Permission checks are enforced by the backend. The frontend hides unavailable navigation items, but backend authorization remains the source of truth.

## Authentication

### Local accounts

Local passwords are stored as bcrypt hashes. Password changes enforce minimum length, uppercase, number, and special-character rules. Sessions are JWT-backed and can be revoked individually or all at once.

TOTP can be enabled per user. When enabled, login requires the TOTP code after password validation.

### Passkeys / WebAuthn

Local accounts can register one or more passkeys (fingerprint, face, or a security key) from `Settings -> Security`. Login with a passkey is usernameless: the browser's discoverable-credential prompt identifies the account, so no username field is required on the login screen. Passkeys are restricted to local accounts — SAML and LDAP identities remain the sole authority for those users, and a stale passkey stops working if an account is later converted to SAML/LDAP.

### LDAP / Active Directory

LDAP supports:

- Service-account bind with encrypted bind password.
- Configurable server, domain, base DN, user filter, and AD mode.
- User and group search from owner pickers.
- Office attribute synchronization.
- LDAP group-to-local-group mappings.
- Role and permission assignment from mappings.
- Cached directory search results for repeated lookups.

LDAP users are represented in the local `users` table with `auth_type=ldap`; their external password is never imported.

### SAML 2.0

SAML is configured from `Settings -> SAML / SSO` by a superadmin. The identity provider remains authoritative for authentication. The application stores the local profile, role, permissions, and identity mapping.

The destination installation must configure its own callback URL, entity ID, certificates, and private key. SAML users are not recreated inside the identity provider by a data migration.

### Reverse-proxy SSO

Authentik, NetScaler, or another trusted reverse proxy can provide a username through a configured header. The proxy must be protected so clients cannot forge that header directly.

## Assets and Services

### Assets

Assets can include applications, infrastructure, databases, hardware, networks, APIs, and other operational components. Each asset supports:

- Status and criticality.
- Category and Part-IS relevance.
- Description and metadata.
- One or more owners: local users, local groups, LDAP users, or LDAP groups.
- User targets.
- Linked services, licenses, maintenance windows, incidents, and dependencies.
- One or more probe configurations.

### Services

Services support:

- Status, criticality, public visibility, and SLA target.
- Owners, user targets, and subscribers.
- Linked assets and licenses.
- Service-to-service dependencies.
- One or more probes.
- Maintenance and incident scope.
- Part-IS relevance, with visual badges and approval impact.

### Correlation graph

Asset and service detail pages provide an interactive graph with:

- Direct and derived relationships.
- Depth expansion from one to three levels.
- Pan and zoom.
- Type and status coloring.
- License status key indicator on nodes.
- Node detail modal with status, criticality, category, and licenses.
- Legend and bounded multi-line node labels.

## Maintenance and Approvals

Maintenance lifecycle statuses include draft, pending approval, scheduled, in progress, completed, cancelled, and extended.

A maintenance window can define:

- Type, impact, start/end dates, recurrence, notes, ticket reference.
- Selected assets and services.
- Affected users and offices.
- Owner approval requirement.
- Subscribers and notifications.

Selecting a Part-IS asset or Part-IS service automatically forces the owner approval flow.

Owner approval targets include the selected assets/services and their recursive direct dependencies. A maintenance can start only after every required owner approval is approved. The approval-status modal lists each subject, source entity, current state, owner action, creator action, request time, response time, and any proposed or counter-proposed dates.

When owner approval is required, the backend resolves owners from selected assets/services and creates approval rows. Owners can approve, reject, or propose a new schedule. Creators and change managers can accept, reject, or counter-propose.

Approval links are token-based and can be used from the public maintenance approval page. Approval tokens expire automatically.

## Incidents and Status

Incidents support configurable severities, status transitions, descriptions, timeline updates, affected assets/services, and impacted users/offices.

Each incident also has a **Root Cause Analysis** tab: root cause, resolution summary, and preventive actions, optionally marked as completed (records who and when), exportable as a standalone PDF report.

The public status page shows service availability, active incidents, planned maintenance, affected scope, and subscription actions for authenticated users.

## Licenses and Suppliers

Licenses support:

- Approval status and approval tokens.
- Expiry and renewal dates.
- Configurable reminder days.
- Owner, maintainer, and approver contacts.
- Supplier and estimated cost.
- Linked assets and services.
- Uploaded documents with links.
- Renewal history with previous expiry, new expiry, notes, actor, and timestamp.
- CSV report export.

The dashboard counts active licenses that are expired or inside their configured reminder window. Expiring licenses are individually clickable from the dashboard.

The scheduler sends expiry reminders and in-app notifications to license stakeholders when configured recipients are available.

## Monitoring and Probes

Assets and services support scheduled probes such as HTTP, HTTPS, TCP, ICMP, DNS, and TLS where configured by the deployment version.

Probe features include:

- Multiple probe definitions per entity.
- Enable/disable state.
- Interval, timeout, expected status, failure and recovery thresholds.
- Maintenance pause behavior.
- DNS and TLS-specific settings.
- Current state and consecutive success/failure counters.
- Historical probe results.
- Manual probe execution.

The scheduler runs due probes using the configured tick interval.

## PWA Installation

The frontend is installable on supported Chrome, Edge, Android, macOS, Windows, and Linux browsers. When the browser exposes the install prompt, GB Maintenance shows an install suggestion with an Install app button. On iPhone and iPad, use the browser Share menu and choose Add to Home Screen.

The application registers a service worker and uses the public web app manifest. The install hint can be dismissed locally and the application can still be installed later from the browser menu.

## Dashboard and Reports

The dashboard provides:

- Total assets.
- Services.
- Active maintenances.
- Open incidents.
- Licenses expiring soon.
- Licenses already expired.
- Asset status and criticality charts.
- Maintenance type and status charts.
- Upcoming maintenances.
- Recently completed maintenance.
- Pending owner approvals, shown only when at least one exists.
- Clickable expiring license list.

Reports include:

- Maintenance table and duration chart.
- Maintenance CSV export.
- Maintenance PDF export.
- Service uptime and SLA view.
- Asset report.
- License CSV report.

Maintenance, asset, and license reports can be exported as CSV, formatted Excel (`.xlsx` with headers and columns), or PDF from the Reports page. The Assets and Licenses tabs are shown only when the current user has the corresponding application visibility permission.

Maintenance PDF and CSV exports use English labels and column headers.

## Notifications

Notification templates are managed from Settings. The system supports email, in-app, outbound webhook, and browser push notifications for:

- Maintenance scheduled, started, completed, reopened, cancelled, rejected, and owner approval.
- Incident opened and resolved.
- Blackout periods.
- License approval, rejection, status updates, and expiry reminders.

Notification logs keep delivery status and references. In-app notifications can be marked read individually or in bulk and can open linked detail previews.

Users can enable **browser push notifications** from `Settings -> Security` — maintenance and incident alerts then arrive as native OS notifications even when the app tab isn't open. Push delivery uses per-browser VAPID subscriptions; a stale or revoked subscription is removed automatically on the next failed delivery.

## Settings

Settings sections include:

- SMTP and test email.
- Email notification templates.
- LDAP / Active Directory.
- SAML / SSO.
- API keys.
- Webhooks (outgoing to Teams/Slack/generic URLs, and incoming secret-token URLs to auto-create incidents).
- Branding, app name, app URL, logo and PWA identity.
- Audit retention and automatic purge.
- NTP server and timezone verification.
- Demo data creation and cleanup.
- Asset categories and maintenance types.

### Data migration (superadmin only)

The System section includes a collapsed migration panel with selectable groups:

- Users and groups.
- Assets.
- Services.
- Maintenance.
- Incidents.
- Licenses.
- Configuration.
- Templates (email and Portal branding/configuration).
- Monitoring.

Exports are JSON files. Related groups are included automatically when required to preserve relationships. Sensitive values are excluded by default; including password hashes or SSO secrets is an explicit option and should only be used for a controlled migration.

Import behavior:

- Preview/dry-run validates the import and rolls back all changes.
- Existing users are matched by username.
- Assets and services are matched by slug.
- Groups and configuration are matched by natural keys where available.
- Foreign keys are remapped to destination IDs.
- JSON/JSONB values are normalized before insertion.
- A sanitized backup is created before a real import.
- Import is transactional and reports the failing table and detail on errors.

### Data deletion (superadmin only)

The System section also provides a collapsed destructive-data panel. The operator can select groups or all application data. A confirmation dialog is mandatory. Relationship tables are deleted first and the current superadmin account is preserved. System settings, default notification templates, and template placeholders are intentionally preserved. A sanitized backup is created before deletion.

## Backup and Restore

For full infrastructure backup and restore, use [Backup and Restore](BACKUP.md). It covers PostgreSQL, uploads, backend uploads, logs, configuration snapshots, and manifest metadata.

Recommended practice:

1. Keep scheduled database and file backups.
2. Keep daily, weekly, and monthly retention points.
3. Test restoration regularly.
4. Use application data migration for selective moves and full backup scripts for disaster recovery.

## API and Integrations

The API is available under `/api`. Swagger/OpenAPI is available at `/docs` after authentication.

Main API areas:

- `/api/auth`
- `/api/users`
- `/api/groups`
- `/api/assets`
- `/api/services`
- `/api/maintenance`
- `/api/incidents`
- `/api/blackout`
- `/api/licenses`
- `/api/suppliers`
- `/api/notifications`
- `/api/reports`
- `/api/settings`
- `/api/status`
- `/api/uploads`
- `/api/apikeys`
- `/api/inbound-webhooks`

The frontend uses JWT bearer authentication. Most write endpoints (`incidents`, `maintenance`, `blackout`) also accept an **API Key** sent as the `X-Api-Key` header, which is the recommended way for third-party systems and scripts to integrate — no user login/session is required.

### Authenticating with an API Key

1. In the app, go to `Settings -> API Keys -> New API Key`, give it a name and (optionally) an expiration date.
2. Copy the generated key immediately — it is shown only once and stored as a hash, it cannot be retrieved again later.
3. Send it on every request as the `X-Api-Key` header. The key acts with the role/permissions of the user who created it.

```bash
curl -X POST https://your-domain/api/incidents \
  -H "X-Api-Key: gbm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Database Server Upgrade",
    "severity": "high",
    "description": "Detected by external monitoring",
    "asset_ids": ["11111111-1111-1111-1111-111111111111"]
  }'
```

Response:

```json
{ "id": "22222222-2222-2222-2222-222222222222" }
```

The same pattern works for maintenance windows and blackout periods:

```bash
# Create a maintenance window
curl -X POST https://your-domain/api/maintenance \
  -H "X-Api-Key: gbm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Firewall firmware update",
    "type": "planned",
    "impact_level": "medium",
    "scheduled_start": "2026-10-01T22:00:00Z",
    "scheduled_end": "2026-10-02T00:00:00Z",
    "asset_ids": ["11111111-1111-1111-1111-111111111111"]
  }'

# Create a blackout period (change-freeze window)
curl -X POST https://your-domain/api/blackout \
  -H "X-Api-Key: gbm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Year-end freeze",
    "start_date": "2026-12-20",
    "end_date": "2027-01-05"
  }'
```

### Outgoing Webhooks (`Settings -> Webhooks -> Outgoing`)

GB Maintenance can POST a JSON payload to an external URL whenever a maintenance, incident, or blackout event occurs. Configure one or more webhooks with a target URL, a format (`generic`, `teams`, or `slack`), and an optional list of events to filter on (leave empty to receive every event).

Supported events: `maintenance_scheduled`, `maintenance_reminder`, `maintenance_started`, `maintenance_completed`, `maintenance_reopened`, `maintenance_cancelled`, `maintenance_rejected`, `incident_created`, `incident_resolved`, `blackout_scheduled`.

Payload shape by format:

```jsonc
// generic
{ "event": "incident_created", "timestamp": "2026-09-29T10:00:00.000Z", "incident": { "title": "...", "severity": "high", "...": "..." } }

// slack
{ "text": "*[incident created] Database Server Upgrade*\nCPU usage above threshold" }

// teams (classic MessageCard, for the legacy "Incoming Webhook" connector or a Power Automate flow expecting it)
{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "summary": "[incident created] Database Server Upgrade",
  "themeColor": "1e40af",
  "title": "[incident created] Database Server Upgrade",
  "text": "CPU usage above threshold"
}
```

Use the **Send test** button in the webhook edit form to verify connectivity/formatting without waiting for a real event.

### Inbound Webhooks (`Settings -> Webhooks -> Incoming`)

Lets an external tool (monitoring, alerting) open an incident here by calling a secret URL — no API key or login required, access is controlled entirely by that URL.

1. `Settings -> Webhooks -> Incoming -> New Inbound Webhook`: give it a name (e.g. "Zabbix") and a default severity.
2. Copy the generated URL immediately — it is shown only once (`https://your-domain/api/inbound-webhooks/receive/gbmih_...`).
3. Configure the external tool to POST to that URL:

```bash
curl -X POST https://your-domain/api/inbound-webhooks/receive/gbmih_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -d '{
    "title": "CPU usage above threshold",
    "description": "db-prod-01 at 96% for 10 minutes",
    "severity": "high",
    "source": "Zabbix",
    "asset_slugs": ["db-prod-01"],
    "service_slugs": ["customer-portal"],
    "ticket_ref": "TKT-12345"
  }'
```

Only `title` is required; `severity` overrides the webhook's default when provided, and `source` is prefixed onto the incident title (e.g. `[Zabbix] CPU usage above threshold`). `asset_slugs`/`service_slugs` (or their `_ids` equivalents with internal UUIDs) correlate the incident to existing assets/services, exactly like the regular incident creation endpoint - affected users, subscribers, owners, and the status page are recomputed the same way. Response:

```json
{ "id": "22222222-2222-2222-2222-222222222222", "message": "Incident created" }
```

Disabling or deleting the inbound webhook in Settings stops all traffic instantly; the endpoint is also rate-limited (30 requests/minute) against abuse.

## Security Checklist

Before production:

- Set strong random `JWT_SECRET` and `ENCRYPTION_SECRET` values.
- Set a strong `SUPERADMIN_PASSWORD` and change it after first login.
- Use HTTPS for the frontend, API, SAML callbacks, and public approval pages.
- Restrict CORS to trusted origins instead of `*`.
- Protect reverse-proxy SSO headers from direct client injection.
- Treat sensitive export files as secrets.
- Store uploads and migration backups outside public static paths where possible.
- Review superadmin and admin memberships.
- Configure SMTP securely.
- Test PostgreSQL and file restoration.
- Keep Docker images and npm dependencies updated.

## Deployment

### Docker

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

The frontend is normally published on port `4681` and the backend listens internally on `4680`.

### Development

```bash
cd backend
npm install
node src/index.js

cd frontend
npm install
npm run dev
```

The backend runs migrations on startup. Restart the backend after deploying a migration change.

## Troubleshooting

### Login fails

- Check `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD`.
- Confirm PostgreSQL is healthy.
- Check `backend/logs/app.log`.
- Verify the backend health endpoint at `/health`.

### LDAP login fails

- Test the LDAP connection from Settings.
- Check URL, bind credentials, base DN, user filter, and group mappings.
- Confirm the backend container can resolve and reach the directory server.

### SAML login fails

- Verify `APP_URL`, callback URL, entity ID, certificate, and private key.
- Confirm system time is synchronized.
- Check the SAML ACS logs in the backend.

### Import fails

- Run Preview import first.
- Import related groups together or let dependency expansion include them.
- Check the displayed table and database detail.
- Keep the generated sanitized backup before retrying.
- Avoid including sensitive data unless the destination encryption secret is managed correctly.

### Probes do not update

- Confirm the scheduler is running.
- Check `PROBE_TICK_SECONDS`.
- Verify target reachability from the backend container, not only from a workstation.
- Inspect probe history and backend logs.

### Public approval link fails

- Check `APP_URL` and reverse-proxy routing.
- Verify that the token has not expired.
- Confirm the selected owner/approver has a valid email or account mapping.
