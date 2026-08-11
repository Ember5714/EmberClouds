/**
 * WebSocket signaling service module
 * Handles device status broadcast, transfer progress push, real-time notifications
 */
const crypto = require('crypto');

class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { id, deviceName }
    this._tokenValidator = null; // async function(token) => user|null
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
      const clientId = crypto.randomUUID();
      const clientIp = req.socket.remoteAddress;

      this.clients.set(ws, {
        id: clientId,
        ip: clientIp,
        connectedAt: Date.now(),
        authenticated: false,
      });

      console.log(`[WS] New client connected: ${clientId} (${clientIp})`);

      this._send(ws, { type: 'connected', payload: { clientId } });

      // Set authentication timeout — close if not authenticated within 10 seconds
      const authTimeout = setTimeout(() => {
        const client = this.clients.get(ws);
        if (client && !client.authenticated) {
          console.log(`[WS] Auth timeout for client: ${clientId}`);
          this._send(ws, { type: 'error', payload: { message: 'Authentication timeout' } });
          ws.close(4001, 'Authentication timeout');
        }
      }, 10000);

      ws.on('message', (data) => this._handleMessage(ws, data, authTimeout));

      ws.on('close', () => {
        clearTimeout(authTimeout);
        console.log(`[WS] Client disconnected: ${clientId}`);
        this.clients.delete(ws);
        this.emit('client-disconnected', clientId);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error: ${clientId}`, err.message);
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
  async _handleMessage(ws, data, authTimeout) {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'auth': {
          // Authenticate the WebSocket connection
          if (!this._tokenValidator) {
            this._send(ws, { type: 'error', payload: { message: 'Auth not configured' } });
            ws.close(4002, 'Auth not configured');
            return;
          }
          const user = await this._tokenValidator(msg.payload?.token);
          if (!user) {
            this._send(ws, { type: 'error', payload: { message: 'Invalid token' } });
            ws.close(4003, 'Invalid token');
            return;
          }
          const client = this.clients.get(ws);
          if (client) {
            client.authenticated = true;
            client.username = user.username;
            client.email = user.email;
          }
          clearTimeout(authTimeout);
          this._send(ws, { type: 'auth-ok', payload: { username: user.username } });
          console.log(`[WS] Client authenticated: ${user.username}`);
          break;
        }
        case 'ping':
          this._send(ws, { type: 'pong' });
          break;
        case 'device-info':
          this.clients.get(ws).deviceName = msg.payload?.name;
          break;
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

  /** Get online client count */
  getClientCount() {
    return this.clients.size;
  }
}

module.exports = new WsServer();