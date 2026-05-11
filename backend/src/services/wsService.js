// WebSocket service for real-time in-app notifications
let wss = null;

// Map: userId → Set<WebSocket>
const userConnections = new Map();

function init(wsServer) {
  wss = wsServer;

  wss.on('connection', (ws, req) => {
    // Authenticate via ?token= query param
    const url = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');
    let userId = null;

    try {
      const { verifyToken } = require('./authService');
      const payload = verifyToken(token);
      userId = payload.sub;
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (!userConnections.has(userId)) userConnections.set(userId, new Set());
    userConnections.get(userId).add(ws);

    ws.on('close', () => {
      const conns = userConnections.get(userId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) userConnections.delete(userId);
      }
    });

    ws.on('error', () => { /* ignore */ });
    ws.send(JSON.stringify({ type: 'connected', userId }));
  });
}

function sendToUser(userId, message) {
  const conns = userConnections.get(String(userId));
  if (!conns) return;
  const payload = JSON.stringify(message);
  conns.forEach(ws => {
    try { ws.send(payload); } catch { /* ignore */ }
  });
}

function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach(ws => {
    try { ws.send(payload); } catch { /* ignore */ }
  });
}

function getConnectedCount() {
  let count = 0;
  userConnections.forEach(set => { count += set.size; });
  return count;
}

module.exports = { init, sendToUser, broadcast, getConnectedCount };
