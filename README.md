# GB Maintenance — Maintenance & Asset Management System

![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-UI-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)

---

## 📋 Description

**GB Maintenance** is a complete system for managing IT assets, services, licenses, maintenance activities, and suppliers. It provides a centralized view of your infrastructure with full lifecycle tracking, approval workflows, contract management, and configurable notification templates.

Ideal for IT departments that need to track hardware, software licenses, service agreements, and scheduled maintenance operations in one place.

---

### ✨ Key Features

- 🖥️ **Asset Management** — Full inventory of hardware and software assets with categories, location, status, and linked services/licenses
- 🔧 **Services** — Track IT services, their owners, SLA, and linked assets
- 📄 **License Management** — Software licenses with expiry tracking, renewal dates, approval workflows, and email notifications
- ✅ **Approval Workflow** — Token-based public approval page, fully brandable (logo, colors, texts) per-customer
- 🏢 **Supplier Management** — Supplier registry with contact info, website (with favicon preview), and contract details (SLA, emergency contacts, availability, documents)
- 🔔 **Notifications** — Configurable email templates for approval requests, approval and rejection events
- 📊 **Probes** — Scheduled connectivity checks on assets/services with status history
- 🔐 **Authentication** — Local users, LDAP/Active Directory, SSO (Authentik, NetScaler), SAML 2.0
- 👥 **User Management** — `superadmin`, `admin`, `user` roles with per-section permissions
- 📋 **Audit Log** — Full operation log (superadmin only)
- 📖 **Swagger UI / API Docs** — Interactive REST API reference at `/docs`
- 🌓 **Dark mode** — Full light/dark theme support
- 📱 **PWA** — Installable as a progressive web app on desktop and mobile

---

## 🚀 Installation

### Option 1: Docker (Recommended)

**Prerequisites:**
- Docker and Docker Compose installed
- Available port: `4681` (web frontend, configurable via `FRONTEND_PORT`)

**Quick deploy:**

```bash
# Choose your install path (Synology NAS example)
cd /volume3/docker
# or: cd /opt/docker  # Linux VPS

git clone https://git.ballarini.app/guido/GB_Maintenance.git gbmaintenance
cd gbmaintenance

# Create the configuration file
cp .env.example .env

# Edit required variables
vi .env   # set JWT_SECRET, ENCRYPTION_SECRET, SUPERADMIN_PASSWORD, POSTGRES_PASSWORD

# Start the containers
docker compose up -d --build

# Check status
docker ps

# View logs
docker logs gbmaintenance-backend
docker logs gbmaintenance-frontend
```

Access the application at `http://localhost:4681`

---

**`docker-compose.yml` overview:**

```yaml
services:
  init-dirs:       # creates ./data/postgres, ./logs, ./uploads on host (Synology compat)
    image: alpine

  postgres:        # PostgreSQL 16, internal only (no exposed port)
    image: postgres:16-alpine

  backend:         # Express API, internal port 4680
    depends_on: postgres (healthy)

  frontend:        # React UI via nginx, published port 4681
    ports:
      - "${FRONTEND_PORT:-4681}:80"
```

**Persistent volumes (host paths):**

| Path | Content |
|------|---------|
| `./data/postgres/` | PostgreSQL data directory |
| `./logs/app.log` | Application log |
| `./uploads/` | Uploaded files (documents, logos, images) |

---

**Update:**

```bash
cd gbmaintenance
git pull
docker compose down
docker compose up -d --build
```

---

### Option 2: Manual installation (development)

**Prerequisites:**
- Node.js 20+
- PostgreSQL 16+

**Steps:**

```bash
git clone https://git.ballarini.app/guido/GB_Maintenance.git
cd GB_Maintenance

# Backend
cd backend
npm install
cp ../.env.example ../.env   # configure variables
node src/index.js

# Frontend (in another terminal)
cd frontend
npm install
npm run dev   # Vite dev server → http://localhost:5173
```

The frontend Vite dev server proxies `/api` and `/uploads` to the backend on `localhost:4680`.

---

## 🔑 First Login

On startup, the system automatically creates the super-administrator user:

- **Username**: `sysadmin` (configurable via `SUPERADMIN_USERNAME`)
- **Password**: as set in `SUPERADMIN_PASSWORD`

> ⚠️ **IMPORTANT**: Change the password immediately after first login! Set long, random values for `JWT_SECRET` and `ENCRYPTION_SECRET` in `.env` before going to production.

---

## ⚙️ Configuration (`.env`)

```dotenv
# ─── Application ────────────────────────────────────────────────────
NODE_ENV=production
PORT=4680
FRONTEND_PORT=4681

# ─── Authentication ─────────────────────────────────────────────────
JWT_SECRET=change-with-long-random-string-min-32-chars
JWT_EXPIRES_IN=8h

# ─── Encryption (LDAP/SMTP password storage) ────────────────────────
ENCRYPTION_SECRET=change-with-another-long-random-string

# ─── PostgreSQL ─────────────────────────────────────────────────────
POSTGRES_HOST=postgres        # Docker: service name; dev: localhost
POSTGRES_PORT=5432
POSTGRES_DB=gbmaintenance
POSTGRES_USER=gbmaint
POSTGRES_PASSWORD=change-in-production

# ─── SuperAdmin (seeded on first run) ───────────────────────────────
SUPERADMIN_USERNAME=sysadmin
SUPERADMIN_PASSWORD=ChangeMe!

# ─── SMTP (optional — can also be configured via UI → Settings) ─────
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=notifications@example.com
# SMTP_PASS=yourpassword
# SMTP_FROM=GB Maintenance <notifications@example.com>

# ─── SSO via reverse proxy (Authentik, NetScaler) ───────────────────
# SSO_HEADER_ENABLED=false
# SSO_HEADER=X-Remote-User

# ─── Public App URL (SAML ACS callback) ─────────────────────────────
# APP_URL=https://maintenance.yourcompany.com

# ─── Probe scheduler tick interval (seconds, default 60) ────────────
# PROBE_TICK_SECONDS=60
```

> SMTP, LDAP, SAML and branding settings can also be configured directly from **Settings** in the web interface.

---

## 🔐 Authentication

### Local users
Passwords hashed with bcrypt (cost 12). Managed from **User management**.

### LDAP / Active Directory
Configurable from the UI → **User management → LDAP / Active Directory**:
- Bind with a service account
- User search via customizable filter (default: `sAMAccountName`)
- Nested group resolution (AD `LDAP_MATCHING_RULE_IN_CHAIN` or standard BFS)
- DN group → role/permission mapping
- Automatic user sync on each LDAP login

### SSO (Authentik / NetScaler / Nginx)
Set `SSO_HEADER_ENABLED=true` and configure the header name (default: `X-Remote-User`). The proxy authenticates the user and forwards their username in the configured header. The backend reads it, resolves via LDAP (if configured), and issues a JWT without requiring a password.

### SAML 2.0
SP-initiated flow configurable from the UI → **Settings → SAML / SSO** (Superadmin only).

| SAML field | Value |
|------------|-------|
| ACS URL | `https://yourdomain/api/auth/saml/callback` |
| SP Entity ID | `https://yourdomain/api/auth/saml/metadata` |
| Binding | HTTP-POST |
| SP Metadata | `https://yourdomain/api/auth/saml/metadata` |

---

## 📖 Module Overview

### Assets
Full hardware/software inventory with:
- Name, category, serial number, location, status, purchase/warranty dates
- Linked licenses and services
- Primary supplier reference

### Services
IT services with owner, SLA, status, and linked assets.

### Licenses
Software licenses with:
- Expiry and renewal date tracking with configurable reminder days
- Approval workflow (pending / approved / rejected)
- Token-based public approval page (brandable per-customer)
- Email notifications on request, approval, and rejection
- Linked assets and services

### Suppliers
Supplier registry with:
- Contact details (name, company, email, phone, mobile, VAT, website)
- Website favicon shown inline in the supplier list
- **Contract tab**: contract reference, start/end dates, availability hours, emergency contacts, SLA resolution hours, contract notes, document attachments

### Probes
Scheduled connectivity checks (ping, HTTP, TCP) on assets/services with configurable intervals and status history.

### Settings
- General settings (app name, branding, logo)
- Date & time (timezone)
- SMTP configuration
- LDAP / Active Directory
- SAML / SSO
- Notification templates (email templates for approval flow)

---

## 📖 API Documentation

The interactive API documentation (Swagger UI) is available at:

```
http://localhost:4681/docs
```

When accessed while already logged in, the Swagger UI is automatically authenticated. You can also paste a JWT token manually. API calls are collapsed by default; expand a section to view details and try requests.

---

## 🗂️ Project Structure

```
GB_Maintenance/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── database.js        # PostgreSQL connection pool
│   │   │   └── migrations.js      # Versioned schema migrations
│   │   ├── middleware/
│   │   │   └── authMiddleware.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── assets.js
│   │   │   ├── licenses.js
│   │   │   ├── suppliers.js
│   │   │   ├── services.js
│   │   │   ├── uploads.js
│   │   │   └── ...
│   │   ├── openapi.js             # OpenAPI spec (Swagger)
│   │   └── index.js               # Express app entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/            # Shared UI components
│   │   ├── pages/                 # Route-level page components
│   │   ├── api.js                 # Axios API client
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🔒 Security notes

- **Never commit `.env`** — always use `.env.example` as a template
- Set `JWT_SECRET` and `ENCRYPTION_SECRET` to long random strings before deploying
- The PostgreSQL port is **not** exposed outside the Docker network
- Uploaded files are served only to authenticated users through the backend
- All API routes require authentication; admin-only routes additionally require the `admin` or `superadmin` role

---

## 📜 License

Internal use — © Ballarini

---

## 👨‍💻 Author

**Guido Ballarini**

- 💼 LinkedIn: [Guido Ballarini](https://www.linkedin.com/in/guido-ballarini/)
- ☕ Buy Me a Coffee: [guidoballau](https://buymeacoffee.com/guidoballau)

---

## 💶 Support the project

If you find this project useful, buy me a coffee! ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-guidoballau-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/guidoballau)
[![PayPal](https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/donate/?hosted_button_id=8RF28JBPLYASN)
