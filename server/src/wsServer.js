/**
 * WebSocket signaling service module
 * Handles device status broadcast, transfer progress push, real-time notifications
 */
const crypto = require('crypto');

const MAX_UNAUTHENTICATED = 10; // Max unauthenticated connections before rejecting new ones

class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Map();       // ws -> { id, username, email, authenticated }
    this._pendingClients = new Map(); // ws -> { id, connectedAt } (unauthenticated)
    this._tokenValidator = null;    // async function(token) => user|null
  }

  /** Set token validation function for WebSocket auth */
  setTokenValidator(fn) {
    this._tokenValidator = fn;
  }

  /** Initialize WebSocket service */
  init(server) {
    const WebSocket = require('ws');
    this.wss = new WebSocket.Server({ server });

    this.wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // HTTP server error handler will handle this
      } else {
        console.error('[WS] Server error:', err.message);
      }
    });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;

      // Reject if too many unauthenticated connections
      if (this._pendingClients.size >= MAX_UNAUTHENTICATED) {
        console.log(`[WS] Rejected connection from ${clientIp}: too many unauthenticated`);
        ws.close(4013, 'Too many unauthenticated connections');
        return;
      }

      // Track pending client (not yet in this.clients — prevents HIGH-1)
      const pendingId = crypto.randomUUID();
      this._pendingClients.set(ws, { id: pendingId, connectedAt: Date.now() });
      console.log(`[WS] Pending client connected: ${pendingId} (${clientIp})`);

      // Set authentication timeout — close if not authenticated within 10 seconds
      const authTimeout = setTimeout(() => {
        if (this._pendingClients.has(ws)) {
          console.log(`[WS] Auth timeout for pending client: ${pendingId}`);
          this._send(ws, { type: 'error', payload: { message: 'Authentication timeout' } });
          ws.close(4001, 'Authentication timeout');
          // CRIT-1: Force terminate if close doesn't work within 1 second
          setTimeout(() => {
            if (ws.readyState !== 3) {
              try { ws.terminate(); } catch {}
            }
          }, 1000);
        }
      }, 10000);

      ws.on('message', (data) => this._handleMessage(ws, data, authTimeout, pendingId));

      ws.on('close', () => {
        clearTimeout(authTimeout);
        this._pendingClients.delete(ws);
        // Also clean up from authenticated clients
        const client = this.clients.get(ws);
        if (client) {
          console.log(`[WS] Client disconnected: ${client.id}`);
          this.clients.delete(ws);
          this.emit('client-disconnected', client.id);
        } else {
          console.log(`[WS] Pending client disconnected: ${pendingId}`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error: ${pendingId}`, err.message);
      });
    });

    console.log('[WS] WebSocket service started');
  }

  /** Event emitter compatibility */
  _handlers = {};
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  }
  emit(event, ...args) {
    const handlers = this._handlers[event] || [];
    handlers.forEach((h) => h(...args));
  }

  /** Handle incoming messages */
  async _handleMessage(ws, data, authTimeout, pendingId) {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'auth': {
          // Authenticate the WebSocket connection
          if (!this._tokenValidator) {
            this._send(ws, { type: 'error', payload: { message: 'Auth not configured' } });
            ws.close(4002, 'Auth not configured');
            setTimeout(() => { if (ws.readyState !== 3) { try { ws.terminate(); } catch {} } }, 1000);
            return;
          }
          const user = await this._tokenValidator(msg.payload?.token);
          if (!user) {
            this._send(ws, { type: 'error', payload: { message: 'Invalid token' } });
            ws.close(4003, 'Invalid token');
            setTimeout(() => { if (ws.readyState !== 3) { try { ws.terminate(); } catch {} } }, 1000);
            return;
          }
          // Move from pending to authenticated clients
          this._pendingClients.delete(ws);
          this.clients.set(ws, {
            id: pendingId,
            username: user.username,
            email: user.email,
            authenticated: true,
            connectedAt: Date.now(),
          });
          clearTimeout(authTimeout);
          // HIGH-1: Only send connected + clientId after auth succeeds
          this._send(ws, { type: 'connected', payload: { clientId: pendingId } });
          this._send(ws, { type: 'auth-ok', payload: { username: user.username } });
          console.log(`[WS] Client authenticated: ${user.username} (${pendingId})`);
          break;
        }
        case 'ping':
          this._send(ws, { type: 'pong' });
          break;
        case 'device-info': {
          const client = this.clients.get(ws);
          if (client) client.deviceName = msg.payload?.name;
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('[WS] Message parse failed:', err.message);
    }
  }

  /** Send message to a specific client */
  _send(ws, message) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Broadcast to all authenticated clients */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const [ws, client] of this.clients) {
      if (ws.readyState === 1 && client.authenticated) ws.send(data);
    }
  }

  /** Push device list update */
  sendDeviceList(devices) {
    this.broadcast({ type: 'device-list', payload: { devices } });
  }

  /** Push device online event */
  sendDeviceOnline(device) {
    this.broadcast({ type: 'device-online', payload: device });
  }

  /** Push device offline event */
  sendDeviceOffline(device) {
    this.broadcast({ type: 'device-offline', payload: device });
  }

  /** Push manually added device */
  sendManualDevice(device) {
    this.broadcast({ type: 'manual-device', payload: device });
  }

  /** Push transfer progress */
  sendTransferProgress(transferId, progress, status, extra = {}) {
    this.broadcast({ type: 'transfer-progress', payload: { transferId, progress, status, ...extra } });
  }

  /** Push file received notification */
  sendFileReceived(fileInfo) {
    this.broadcast({ type: 'file-received', payload: fileInfo });
  }

  /** Get online client count (authenticated only) */
  getClientCount() {
    return this.clients.size;
  }
}

module.exports = new WsServer();