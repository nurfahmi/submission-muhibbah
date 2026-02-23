const { WebSocketServer } = require('ws');

let wss = null;

const WsService = {
  init(server) {
    wss = new WebSocketServer({ server, path: '/ws/notifications' });

    wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
    });

    // Heartbeat to clean dead connections
    setInterval(() => {
      wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  },

  notifyNewCase(caseId, applicantName) {
    if (!wss) return;
    const payload = JSON.stringify({
      type: 'NEW_CASE',
      caseId,
      applicantName: applicantName || 'Unknown',
      timestamp: Date.now()
    });
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }
};

module.exports = WsService;
