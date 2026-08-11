/**
 * Device discovery module — per-subnet UDP broadcast + mDNS auxiliary
 * Key fix: targets each NIC's subnet broadcast address instead of 255.255.255.255
 * Security: UDP messages include HMAC-SHA256 signature to prevent spoofing
 */
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');
const config = require('./config');

const BROADCAST_PORT = 3001;
const BROADCAST_INTERVAL = 5000;
const DEVICE_TIMEOUT = 15000;

function getHMACKey() {
  return crypto.createHash('sha256').update(config.DEVICE_ID).digest();
}

function signMessage(payload) {
  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', getHMACKey()).update(json).digest('hex');
  return { payload: json, sig: hmac };
}

function verifyMessage(data) {
  try {
    const { payload, sig } = JSON.parse(data.toString('utf8'));
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', getHMACKey()).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(payload);
  } catch { return null; }
}

class Discovery extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.devices = new Map();
    this.cleanupTimer = null;
    this.broadcastTimer = null;
    this.mdns = null;
    this.port = config.PORT;
    this._localAddrs = [];
    this._broadcastAddrs = [];
  }

  start(port) {
    this.port = port;
    this._scanInterfaces();
    this._startUdp();
    this._startMdns();

    this.cleanupTimer = setInterval(() => this._cleanup(), DEVICE_TIMEOUT);

    console.log(`[Discovery] Started. Local IPs: ${this._localAddrs.join(', ')}`);
    console.log(`[Discovery] Broadcast targets: ${this._broadcastAddrs.join(', ')}`);
  }

  stop() {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.socket) {
      try { this._sendGoodbye(); } catch (e) {}
      this.socket.close();
      this.socket = null;
    }
    if (this.mdns) {
      try { this._mdnsGoodbye(); } catch (e) {}
      this.mdns.destroy();
      this.mdns = null;
    }
  }

  getDevices() {
    return Array.from(this.devices.values()).map(d => ({
      id: d.id, name: d.name, address: d.address, port: d.port,
    }));
  }

  getNetworkInfo() {
    return {
      localAddresses: this._localAddrs,
      broadcastTargets: this._broadcastAddrs,
      boundPort: this.socket ? this.socket.address().port : null,
    };
  }

  // ==================== Interface scanning ====================

  _scanInterfaces() {
    const interfaces = os.networkInterfaces();
    this._localAddrs = [];
    this._broadcastAddrs = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          this._localAddrs.push(iface.address);
          const broadcast = this._calcBroadcast(iface.address, iface.netmask);
          if (broadcast && !this._broadcastAddrs.includes(broadcast)) {
            this._broadcastAddrs.push(broadcast);
          }
        }
      }
    }
    // Always include global broadcast as fallback
    if (!this._broadcastAddrs.includes('255.255.255.255')) {
      this._broadcastAddrs.push('255.255.255.255');
    }
  }

  _calcBroadcast(ip, mask) {
    try {
      const ipParts = ip.split('.').map(Number);
      const maskParts = mask.split('.').map(Number);
      if (ipParts.length !== 4 || maskParts.length !== 4) return null;
      const broadcast = ipParts.map((o, i) => (o | (~maskParts[i] & 255))).join('.');
      return broadcast;
    } catch { return null; }
  }

  // ==================== UDP ====================

  _startUdp() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('listening', () => {
      this.socket.setBroadcast(true);
      const addr = this.socket.address();
      console.log(`[Discovery] UDP listening: ${addr.address}:${addr.port}`);

      this._broadcastPresence();
      this.broadcastTimer = setInterval(() => this._broadcastPresence(), BROADCAST_INTERVAL);
    });

    this.socket.on('message', (msg, rinfo) => {
      this._handleMessage(msg, rinfo);
    });

    this.socket.on('error', (err) => {
      console.error('[Discovery] UDP error:', err.message);
    });

    this.socket.bind(BROADCAST_PORT);
  }

  _broadcastPresence() {
    if (!this.socket) return;
    const signed = signMessage({
      type: 'hello',
      id: config.DEVICE_ID,
      name: config.DEVICE_NAME,
      port: this.port,
    });
    const buf = Buffer.from(JSON.stringify(signed), 'utf8');

    for (const addr of this._broadcastAddrs) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr, (err) => {
        if (err) console.error(`[Discovery] Broadcast to ${addr} failed:`, err.message);
      });
    }
  }

  _sendGoodbye() {
    if (!this.socket) return;
    const signed = signMessage({ type: 'goodbye', id: config.DEVICE_ID });
    const buf = Buffer.from(JSON.stringify(signed), 'utf8');
    for (const addr of this._broadcastAddrs) {
      this.socket.send(buf, 0, buf.length, BROADCAST_PORT, addr);
    }
  }

  _handleMessage(msg, rinfo) {
    const data = verifyMessage(msg);
    if (!data) return;
    if (data.id === config.DEVICE_ID) return;
    if (rinfo.address.startsWith('127.')) return;

    if (data.type === 'hello') {
      const isNew = !this.devices.has(data.id);
      this.devices.set(data.id, {
        id: data.id,
        name: data.name || 'Unknown',
        address: rinfo.address,
        port: data.port || this.port,
        lastSeen: Date.now(),
      });

      if (isNew) {
        console.log(`[Discovery] Found (UDP): ${data.name} @ ${rinfo.address}:${data.port}`);
        this.emit('device-online', {
          id: data.id, name: data.name, address: rinfo.address, port: data.port || this.port,
        });
      } else {
        this.devices.get(data.id).lastSeen = Date.now();
      }
    } else if (data.type === 'goodbye') {
      if (this.devices.has(data.id)) {
        const d = this.devices.get(data.id);
        console.log(`[Discovery] Offline (UDP): ${d.name}`);
        this.devices.delete(data.id);
        this.emit('device-offline', { id: data.id, name: d.name });
      }
    }
  }

  // ==================== mDNS ====================

  _startMdns() {
    try {
      const multicastDNS = require('multicast-dns');
      this.mdns = multicastDNS();
      const svc = `${config.DEVICE_NAME}._${config.MDNS_SERVICE_TYPE}`;

      this.mdns.on('response', (r) => {
        const answers = r.answers || [];
        let id = null, name = '', port = null;
        for (const a of answers) {
          if (!a.name || !a.name.includes(config.MDNS_SERVICE_TYPE.replace('_', ''))) continue;
          if (a.type === 'TXT' && a.data) {
            const txt = typeof a.data === 'string' ? a.data : a.data.toString();
            const p = new URLSearchParams(txt);
            id = p.get('id'); name = decodeURIComponent(p.get('name') || '');
          }
          if (a.type === 'SRV' && a.data) port = a.data.port;
        }
        if (!id || id === config.DEVICE_ID || this.devices.has(id)) return;
        this.devices.set(id, {
          id, name: name || 'Unknown', address: 'unknown', port: port || this.port, lastSeen: Date.now(),
        });
        console.log(`[Discovery] Found (mDNS): ${name}`);
      });

      this.mdns.on('query', (q) => {
        if (q.questions.some((x) => x.name && x.name.includes(config.MDNS_SERVICE_TYPE.replace('_', '')))) {
          this.mdns.respond({
            answers: [
              { name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` } },
              { name: svc, type: 'TXT', data: Buffer.from(`id=${config.DEVICE_ID}&name=${encodeURIComponent(config.DEVICE_NAME)}`) },
            ],
          });
        }
      });

      this.mdns.respond({
        answers: [
          { name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` } },
          { name: svc, type: 'TXT', data: Buffer.from(`id=${config.DEVICE_ID}&name=${encodeURIComponent(config.DEVICE_NAME)}`) },
        ],
      });
    } catch (err) {
      console.log('[Discovery] mDNS start failed (non-fatal):', err.message);
    }
  }

  _mdnsGoodbye() {
    if (!this.mdns) return;
    const svc = `${config.DEVICE_NAME}._${config.MDNS_SERVICE_TYPE}`;
    this.mdns.respond({ answers: [{ name: svc, type: 'SRV', data: { port: this.port, target: `${config.DEVICE_ID}.local` }, ttl: 0 }] });
  }

  // ==================== Cleanup ====================

  _cleanup() {
    const now = Date.now();
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > DEVICE_TIMEOUT) {
        console.log(`[Discovery] Timeout: ${d.name}`);
        this.devices.delete(id);
        this.emit('device-offline', { id, name: d.name });
      }
    }
  }
}

module.exports = new Discovery();