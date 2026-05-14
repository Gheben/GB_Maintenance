const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { WebSocketServer } = require('ws');

const logger = require('./utils/logger');
const { initDb } = require('./db/database');
const { runMigrations } = require('./db/migrations');
const { seedSuperAdmin } = require('./services/authService');
const wsService = require('./services/wsService');
const schedulerService = require('./services/schedulerService');
const probeService = require('./services/probeService');

const { requireAuth } = require('./middleware/authMiddleware');
const openApiSpec = require('./openapi');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const localGroupRoutes = require('./routes/localGroups');
const assetRoutes = require('./routes/assets');
const serviceRoutes = require('./routes/services');
const maintenanceRoutes = require('./routes/maintenance');
const incidentRoutes = require('./routes/incidents');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const statusRoutes = require('./routes/status');
const reportRoutes = require('./routes/reports');
const apikeyRoutes = require('./routes/apikeys');
const auditRoutes = require('./routes/audit');
const templateRoutes = require('./routes/templates');
const blackoutRoutes = require('./routes/blackout');
const maintenanceTypesRoutes = require('./routes/maintenanceTypes');
const assetCategoriesRoutes = require('./routes/assetCategories');
const licenseRoutes = require('./routes/licenses');
const supplierRoutes = require('./routes/suppliers');
const uploadRoutes = require('./routes/uploads');

const app = express();
const server = http.createServer(app);

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined', {
  stream: { write: msg => logger.info(msg.trim()) },
}));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Swagger / API Docs ───────────────────────────────────────────────────────
const swaggerDistPath = path.join(__dirname, '../node_modules/swagger-ui-dist');

// Expose spec JSON — requires auth (admin/superadmin or api permission)
app.get('/api/docs.json', requireAuth, (req, res) => {
  const role  = req.user.role;
  const perms = req.user.permissions || {};
  if (role !== 'admin' && role !== 'superadmin' && !perms.api && !perms.apikeys) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  res.json(openApiSpec);
});

// Loosen CSP for /docs (Swagger needs inline scripts)
app.use('/docs', (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  );
  next();
});

// Swagger UI HTML wrapper — must be before express.static catch-all
app.get(['/docs', '/docs/'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GB Maintenance — API Docs</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body { background: #0f1117; color: #e2e8f0; font-family: 'Inter','Segoe UI',system-ui,sans-serif; }

    #docs-header {
      display: flex; align-items: center; gap: 14px;
      padding: 18px 32px; background: #1a1d27;
      border-bottom: 1px solid #2d3044;
      position: sticky; top: 0; z-index: 999;
    }
    #docs-header .logo {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #1e40af, #3b82f6);
      border-radius: 10px; display: flex; align-items: center;
      justify-content: center; font-size: 18px; flex-shrink: 0;
    }
    #docs-header h1 { margin: 0; font-size: 17px; font-weight: 600; color: #f1f5f9; letter-spacing: -0.01em; }
    #docs-header .badge { margin-left: auto; background: #1e40af; color: #fff; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; letter-spacing: 0.04em; text-transform: uppercase; }
    #docs-header .download-btn {
      background: transparent; border: 1px solid #1e40af; color: #60a5fa;
      border-radius: 6px; padding: 5px 14px; font-size: 12px; font-weight: 500;
      cursor: pointer; transition: background .15s,color .15s;
      display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    #docs-header .download-btn:hover { background: #1e40af; color: #fff; }
    #docs-header .download-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    #docs-header .back-btn {
      background: transparent; border: 1px solid #334155; color: #94a3b8;
      border-radius: 6px; padding: 5px 14px; font-size: 12px; font-weight: 500;
      cursor: pointer; display: none; align-items: center; gap: 6px;
      text-decoration: none; white-space: nowrap; transition: background .15s,color .15s;
    }
    #docs-header .back-btn:hover { background: #1e293b; color: #e2e8f0; }

    #swagger-ui { max-width: 1200px; margin: 0 auto; padding: 28px 24px 60px; }
    .swagger-ui .topbar { display: none !important; }
    .swagger-ui .scheme-container { background: #1a1d27 !important; border: 1px solid #2d3044 !important; border-radius: 10px !important; padding: 14px 20px !important; box-shadow: none !important; margin-bottom: 20px !important; }
    .swagger-ui .info { margin-bottom: 24px; }
    .swagger-ui .info .title { color: #f1f5f9 !important; font-size: 26px !important; font-weight: 700 !important; }
    .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info .description p { color: #94a3b8 !important; }
    .swagger-ui .info a { color: #60a5fa !important; }
    .swagger-ui .info .base-url { color: #64748b !important; }
    .swagger-ui .opblock-tag { background: #1a1d27 !important; border: 1px solid #2d3044 !important; border-radius: 10px !important; margin-bottom: 8px !important; padding: 12px 18px !important; color: #e2e8f0 !important; font-size: 15px !important; font-weight: 600 !important; }
    .swagger-ui .opblock-tag:hover { background: #1e2234 !important; }
    .swagger-ui .opblock-tag small { color: #94a3b8 !important; font-weight: 400 !important; }
    .swagger-ui .opblock { border-radius: 8px !important; border: 1px solid #2d3044 !important; margin-bottom: 6px !important; box-shadow: none !important; background: #161924 !important; }
    .swagger-ui .opblock .opblock-summary { border-bottom: none !important; padding: 10px 14px !important; }
    .swagger-ui .opblock .opblock-summary-description { color: #94a3b8 !important; }
    .swagger-ui .opblock .opblock-summary-path { color: #e2e8f0 !important; }
    .swagger-ui .opblock.is-open { border-color: #1e40af !important; }
    .swagger-ui .opblock-body { background: #1a1d27 !important; border-radius: 0 0 8px 8px !important; }
    .swagger-ui .opblock-summary-method { border-radius: 6px !important; font-size: 12px !important; font-weight: 700 !important; min-width: 72px !important; text-align: center !important; }
    .swagger-ui .opblock.opblock-get    .opblock-summary-method { background: #1e3a5f !important; color: #60a5fa !important; }
    .swagger-ui .opblock.opblock-post   .opblock-summary-method { background: #1a3a2a !important; color: #4ade80 !important; }
    .swagger-ui .opblock.opblock-put    .opblock-summary-method { background: #3a2e1a !important; color: #fb923c !important; }
    .swagger-ui .opblock.opblock-patch  .opblock-summary-method { background: #2e2a1a !important; color: #fbbf24 !important; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #3a1a1a !important; color: #f87171 !important; }
    .swagger-ui .btn { border-radius: 6px !important; font-weight: 600 !important; }
    .swagger-ui .btn.try-out__btn, .swagger-ui .btn.execute { background: #1e40af !important; color: #fff !important; border: none !important; }
    .swagger-ui .btn.try-out__btn:hover, .swagger-ui .btn.execute:hover { background: #1d4ed8 !important; }
    .swagger-ui .btn.cancel { background: transparent !important; color: #f87171 !important; border-color: #f87171 !important; }
    .swagger-ui .auth-wrapper .authorize { border-color: #1e40af !important; color: #60a5fa !important; }
    .swagger-ui .auth-wrapper .authorize svg { fill: #60a5fa !important; }
    .swagger-ui table thead tr th { background: #1e2234 !important; color: #94a3b8 !important; border-color: #2d3044 !important; }
    .swagger-ui table tbody tr td { background: #161924 !important; color: #cbd5e1 !important; border-color: #2d3044 !important; }
    .swagger-ui .parameter__name { color: #e2e8f0 !important; }
    .swagger-ui .parameter__type { color: #60a5fa !important; }
    .swagger-ui .parameter__in   { color: #64748b !important; }
    .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: #e2e8f0 !important; }
    .swagger-ui .response-col_status { color: #4ade80 !important; font-weight: 700 !important; }
    .swagger-ui .response-col_description { color: #94a3b8 !important; }
    .swagger-ui .microlight, .swagger-ui textarea, .swagger-ui .highlight-code { background: #0d1117 !important; color: #c9d1d9 !important; border-radius: 6px !important; }
    .swagger-ui input[type=text], .swagger-ui input[type=password], .swagger-ui select, .swagger-ui textarea { background: #0f1117 !important; color: #e2e8f0 !important; border: 1px solid #2d3044 !important; border-radius: 6px !important; }
    .swagger-ui section.models { background: #1a1d27 !important; border: 1px solid #2d3044 !important; border-radius: 10px !important; }
    .swagger-ui section.models h4 { color: #e2e8f0 !important; }
    .swagger-ui .model-box { background: #161924 !important; border-radius: 6px !important; }
    .swagger-ui .model-title { color: #60a5fa !important; }
    .swagger-ui .prop-type   { color: #60a5fa !important; }
    .swagger-ui .prop-format { color: #64748b !important; }

    #auth-banner { display: none; align-items: center; gap: 12px; padding: 10px 32px; background: #0f1e3d; border-bottom: 1px solid #1e3a78; font-size: 13px; color: #93c5fd; }
    #auth-banner.visible { display: flex; }
    #auth-banner .dot { width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; flex-shrink: 0; }
    #auth-banner strong { color: #bfdbfe; }
    #auth-banner .copy-btn { margin-left: auto; background: transparent; border: 1px solid #1e3a78; color: #93c5fd; border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; transition: background .15s; }
    #auth-banner .copy-btn:hover { background: #1e3a78; }

    #no-auth-banner { display: none; align-items: center; gap: 12px; padding: 10px 32px; background: #1e1a10; border-bottom: 1px solid #4a3800; font-size: 13px; color: #fbbf24; }
    #no-auth-banner.visible { display: flex; }
    #no-auth-banner .dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; flex-shrink: 0; }

    body.not-authed .swagger-ui .auth-wrapper .authorize { border-color: #f59e0b !important; color: #fbbf24 !important; animation: pulse-border 2s infinite; }
    body.not-authed .swagger-ui .auth-wrapper .authorize svg { fill: #fbbf24 !important; }
    @keyframes pulse-border { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)} 50%{box-shadow:0 0 0 4px rgba(245,158,11,0)} }
  </style>
</head>
<body>
  <div id="docs-header">
    <div class="logo">🔧</div>
    <h1>GB Maintenance &mdash; API Reference</h1>
    <span class="badge">v1</span>
    <a class="back-btn" id="back-btn" href="/">&#x2190; App</a>
    <button class="download-btn" onclick="downloadPostman()" title="Scarica OpenAPI 3.0 per Postman">&#x2B07; Postman</button>
  </div>

  <div id="auth-banner">
    <div class="dot"></div>
    <span>Autenticato come <strong id="auth-user"></strong> &mdash; token iniettato automaticamente.</span>
    <button class="copy-btn" onclick="copyToken()">Copia token</button>
  </div>

  <div id="no-auth-banner">
    <div class="dot"></div>
    <span>
      Non autenticato. Clicca <strong>Authorize 🔓</strong> e incolla il tuo JWT, oppure
      <a href="/" style="color:#fbbf24;text-decoration:underline">effettua il login</a> e torna qui &mdash; il token sarà iniettato in automatico.
      &nbsp;&nbsp;<strong>Come ottenere il token:</strong>
      POST <code style="background:#2a200a;padding:1px 6px;border-radius:4px">/api/auth/login</code>
      con <code style="background:#2a200a;padding:1px 6px;border-radius:4px">{"username":"…","password":"…"}</code>
      e copia il campo <code style="background:#2a200a;padding:1px 6px;border-radius:4px">token</code>.
    </span>
  </div>

  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
    (function guardDocs() {
      var token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
      if (!token) { window.location.replace('/'); return; }
      var payload = null;
      try {
        var b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        payload = JSON.parse(atob(b64));
      } catch(e) { window.location.replace('/'); return; }
      var role  = payload.role || '';
      var perms = payload.permissions || {};
      var allowed = role === 'admin' || role === 'superadmin' || perms.api || perms.apikeys;
      if (!allowed) {
        document.body.innerHTML = [
          '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f1117;font-family:system-ui,sans-serif;">',
          '  <div style="text-align:center;color:#f1f5f9;max-width:420px;padding:40px;">',
          '    <div style="font-size:64px;margin-bottom:16px;">&#x1F512;</div>',
          '    <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f87171;">Accesso negato</h1>',
          '    <p style="color:#94a3b8;margin:0 0 28px;line-height:1.6;">Non hai i permessi per accedere alla documentazione API. Contatta un amministratore.</p>',
          '    <a href="/" style="display:inline-block;padding:10px 28px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Torna all&rsquo;App</a>',
          '  </div>',
          '</div>'
        ].join('');
      }
    })();

    function getStoredToken() {
      return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    }
    function getStoredUser() {
      try {
        var u = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || 'null');
        return (u && (u.username || u.display_name)) || '';
      } catch { return ''; }
    }

    function copyToken() {
      var t = getStoredToken(); if (!t) return;
      var btn = document.querySelector('.copy-btn');
      var done = function() { btn.textContent = 'Copiato!'; setTimeout(function(){ btn.textContent = 'Copia token'; }, 1500); };
      var fail = function() { btn.textContent = 'Errore!';  setTimeout(function(){ btn.textContent = 'Copia token'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(function(){ fallbackCopy(t, done, fail); });
      } else { fallbackCopy(t, done, fail); }
    }
    function fallbackCopy(text, done, fail) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy') ? done() : fail(); } catch(e) { fail(); }
      document.body.removeChild(ta);
    }

    async function downloadPostman() {
      var btn = document.querySelector('.download-btn');
      var orig = btn.innerHTML;
      var token = getStoredToken();
      btn.innerHTML = '&#x23F3; Download...'; btn.disabled = true;
      try {
        var resp = await fetch('/api/docs.json', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var spec = await resp.json();
        var blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'GBMaintenance_OpenAPI.json'; a.click();
        URL.revokeObjectURL(url);
        btn.innerHTML = '&#x2705; Scaricato!';
        setTimeout(function(){ btn.innerHTML = orig; btn.disabled = false; }, 2000);
      } catch(e) {
        btn.innerHTML = '&#x274C; Errore';
        setTimeout(function(){ btn.innerHTML = orig; btn.disabled = false; }, 2000);
      }
    }

    window.onload = function() {
      var token = getStoredToken();
      var user  = getStoredUser();
      if (token) {
        document.getElementById('auth-banner').classList.add('visible');
        document.getElementById('auth-user').textContent = user || 'utente';
      } else {
        document.getElementById('no-auth-banner').classList.add('visible');
        document.body.classList.add('not-authed');
      }
      if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
        var backBtn = document.getElementById('back-btn');
        if (backBtn) backBtn.style.display = 'inline-flex';
      }

      var ui = SwaggerUIBundle({
        url: '/api/docs.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        persistAuthorization: true,
        deepLinking: true,
        docExpansion: 'full',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        displayRequestDuration: true,
        requestSnippetsEnabled: true,
        showMutatedRequest: true,
        filter: true,
        tryItOutEnabled: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete'],
        requestInterceptor: function(req) {
          var t = getStoredToken();
          if (t && !req.headers['Authorization']) { req.headers['Authorization'] = 'Bearer ' + t; }
          return req;
        },
        onComplete: function() {
          var t = getStoredToken();
          if (t) { ui.preauthorizeApiKey('bearerAuth', t); }
        },
      });
    };
  </script>
</body>
</html>`);
});

// Serve swagger-ui-dist static assets (CSS, JS, maps)
app.use('/docs', express.static(swaggerDistPath));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', localGroupRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/apikeys', apikeyRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/maintenance-types', maintenanceTypesRoutes);
app.use('/api/asset-categories', assetCategoriesRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/blackout', blackoutRoutes);

// ─── 404 & Error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Errore interno del server' });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  await initDb(); // includes migrations
  await seedSuperAdmin();

  // WebSocket server
  const wss = new WebSocketServer({ server });
  wsService.init(wss);

  // Background services
  schedulerService.start();
  probeService.start();

  const PORT = process.env.PORT || 4680;
  server.listen(PORT, () => {
    logger.info(`GB Maintenance backend in ascolto sulla porta ${PORT}`);
  });
}

bootstrap().catch(err => {
  logger.error(`Startup fallito: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
