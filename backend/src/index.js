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
