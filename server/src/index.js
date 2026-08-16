/**
 * Emberclouds — Server entry point
 */
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const cors = require('cors');
const config = require('./config');
const auth = require('./auth');
const userSystem = require('./users');
const repoCli = require('./repo-cli');
const discovery = require('./discovery');
const fileServer = require('./fileServer');
const wsServer = require('./wsServer');
const rateLimit = require('./rateLimit');
const Tui = require('./tui');

const app = express();
const server = http.createServer(app);

// ============ Firewall ============
function registerFirewall() {
  const ruleExe = 'Emberclouds', rulePort = 'Emberclouds-Port';
  try {
    execSync(`netsh advfirewall firewall show rule name="${ruleExe}"`, { stdio: 'ignore' });
    console.log('[Firewall] Program rule already exists');
  } catch {
    try {
      execSync(`netsh advfirewall firewall add rule name="${ruleExe}" dir=in action=allow program="${process.execPath}" enable=yes`, { stdio: 'ignore' });
      console.log('[Firewall] Added program inbound rule');
    } catch (e) { console.log('[Firewall] Failed to add program rule:', e.message); }
  }
  try {
    execSync(`netsh advfirewall firewall show rule name="${rulePort}"`, { stdio: 'ignore' });
    console.log('[Firewall] Port rule already exists');
  } catch {
    try {
      execSync(`netsh advfirewall firewall add rule name="${rulePort}" dir=in action=allow protocol=TCP localport=${config.PORT} enable=yes`, { stdio: 'ignore' });
      console.log(`[Firewall] Added port ${config.PORT} inbound rule`);
    } catch (e) { console.log('[Firewall] Failed to add port rule:', e.message); }
  }
}

// ============ Public IP ============
function fetchPublicIP(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.trim()) ? body.trim() : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getPublicIP() {
  for (const url of ['http://ipinfo.io/ip', 'http://icanhazip.com', 'http://ifconfig.me/ip', 'https://api.ipify.org']) {
    const ip = await fetchPublicIP(url);
    if (ip) return ip;
  }
  return null;
}

function getLanIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

function getDiskUsage() {
  try {
    let totalSize = 0, fileCount = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); }
        else if (entry.isFile()) { totalSize += fs.statSync(p).size; fileCount++; }
      }
    };
    if (fs.existsSync(config.UPLOAD_DIR)) walk(config.UPLOAD_DIR);
    return repoCli.formatSize(totalSize) + ` (${fileCount} files)`;
  } catch { return '-'; }
}

// ============ Middleware ============
app.set('trust proxy', true);
app.disable('x-powered-by');

const corsOrigin = (origin, callback) => {
  // Allow same-origin requests (no Origin header) — needed for non-browser clients
  // Security: all sensitive endpoints are protected by Bearer token auth, not cookie-based
  if (!origin) return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return callback(null, true);
  callback(null, false);
};
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0', // Deprecated, use CSP instead
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// Path sanitization
app.use((req, res, next) => {
  const sanitize = (val) => {
    if (typeof val !== 'string') return val;
    let decoded;
    try { decoded = decodeURIComponent(val); } catch { decoded = val; }
    return decoded.split('/').filter(s => s && s !== '..' && s !== '.').join('/');
  };
  ['path', 'dir', 'filePath'].forEach(k => {
    if (req.query && req.query[k]) req.query[k] = sanitize(req.query[k]);
    if (req.body && req.body[k]) req.body[k] = sanitize(req.body[k]);
  });
  next();
});

// Auth middleware
app.use(auth);

// ============ Auth API ============

app.post('/api/auth/register', async (req, res) => {
  if (!config.REGISTRATION_OPEN) return res.status(403).json({ error: 'Registration is closed' });
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: 'Please fill in all fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: 'Password must contain letters and numbers' });
  const result = await userSystem.register({ email, username, password, ip: rateLimit.getIP(req) });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/auth/verify', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'verify')) return res.status(429).json({ error: 'Too many verification attempts, please try again later' });
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing parameters' });
  const result = await userSystem.verify(email, code);
  if (!result.success) { rateLimit.recordLoginFailure(ip); return res.status(400).json({ error: result.error }); }
  res.json({ success: true });
});

app.post('/api/auth/resend', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'resend')) return res.status(429).json({ error: 'Too many requests, please try again later' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const result = await userSystem.resendCode(email);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
  const ip = rateLimit.getIP(req);
  const delay = rateLimit.getLoginDelay(ip);
  if (delay > 0) return res.status(429).json({ error: `Too many login attempts, please wait ${Math.ceil(delay / 1000)} second(s) before retrying` });
  if (rateLimit.check(ip, 'login')) return res.status(429).json({ error: 'Too many login attempts, please try again later' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Please enter email and password' });
  const result = await userSystem.login(email, password);
  if (!result.success) { rateLimit.recordLoginFailure(ip); return res.status(401).json({ error: result.error }); }
  rateLimit.resetLoginFailures(ip);
  res.json({ token: result.token, refreshToken: result.refreshToken, user: result.user });
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
  const result = await userSystem.refreshToken(refreshToken);
  if (!result) return res.status(401).json({ error: 'refreshToken invalid or expired' });
  res.json(result);
});

app.post('/api/auth/logout', async (req, res) => {
  if (req.token) await userSystem.logout(req.token);
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.user });
});

app.patch('/api/auth/profile', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const result = await userSystem.setPublicProfile(req.user.email, !!req.body.publicProfile);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.patch('/api/auth/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { code, newPassword } = req.body;
  if (!code || !newPassword) return res.status(400).json({ error: 'Please enter verification code and new password' });
  const result = await userSystem.changePassword(req.user.email, code, newPassword);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/auth/send-op-code', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { operation } = req.body;
  if (!operation || !['changePassword', 'deleteAccount'].includes(operation)) return res.status(400).json({ error: 'Invalid operation type' });
  const result = await userSystem.sendOperationCode(req.user.email, operation);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, smtpSent: result.smtpSent });
});

app.patch('/api/auth/username', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username cannot be empty' });
  const result = await userSystem.changeUsername(req.user.email, username);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, username: result.username });
});

app.patch('/api/auth/signature', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const result = await userSystem.setSignature(req.user.email, req.body.signature || '');
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, signature: result.signature });
});

// Avatar upload
const avatarUpload = fileServer.createAvatarUploadHandler();
app.post('/api/auth/avatar', avatarUpload.single('avatar'), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.file) return res.status(400).json({ error: 'Please select an avatar image' });
  try {
    const avatarBuffer = await fs.promises.readFile(req.file.path);
    const result = await userSystem.setAvatar(req.user.email, avatarBuffer);
    try { await fs.promises.unlink(req.file.path); } catch {}
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, avatar: result.avatar });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/auth/account', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Please enter verification code' });
  const result = await userSystem.deleteAccount(req.user.email, code);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/auth/send-reset-code', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'resend')) return res.status(429).json({ error: 'Too many requests, please try again later' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Please enter your email' });
  const result = await userSystem.sendResetCode(email);
  res.json({ success: true, smtpSent: result.smtpSent });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const ip = rateLimit.getIP(req);
  if (rateLimit.check(ip, 'verify')) return res.status(429).json({ error: 'Too many attempts, please try again later' });
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'Please fill in all fields' });
  const result = await userSystem.resetPassword(email, code, newPassword);
  if (!result.success) { rateLimit.recordLoginFailure(ip); return res.status(400).json({ error: result.error }); }
  res.json({ success: true });
});

app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(await userSystem.searchUsers(q));
});

// ============ WebSocket ============
wsServer.setTokenValidator(async (token) => {
  if (!token) return null;
  return userSystem.validateToken(token);
});
wsServer.init(server);
discovery.on('device-online', (device) => { wsServer.sendDeviceOnline(device); wsServer.sendDeviceList(discovery.getDevices()); });
discovery.on('device-offline', (device) => { wsServer.sendDeviceOffline(device); wsServer.sendDeviceList(discovery.getDevices()); });

// ============ API Routes ============

app.get('/api/self', (req, res) => {
  res.json({ id: config.DEVICE_ID, name: config.DEVICE_NAME, port: config.PORT, storage: config.UPLOAD_DIR, authEnabled: !!(config.AUTH_USER && config.AUTH_PASS), network: discovery.getNetworkInfo() });
});

app.get('/api/diagnose', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ self: { name: config.DEVICE_NAME, port: config.PORT }, wsClients: wsServer.getClientCount() });
});

app.get('/api/ping', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ ok: true, time: Date.now() });
});

// ============ Profile ============

app.get('/api/auth/profile-bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ bio: await userSystem.getProfileBio(req.user.id) });
});

app.put('/api/auth/profile-bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (req.body.content === undefined) return res.status(400).json({ error: 'Missing content' });
  res.json(await userSystem.saveProfileBio(req.user.id, req.body.content));
});

// Background upload
const bgUpload = fileServer.createBackgroundUploadHandler();
app.post('/api/auth/profile-background', bgUpload.single('background'), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.file) return res.status(400).json({ error: 'Please select a background image' });
  try {
    const bgBuffer = await fs.promises.readFile(req.file.path);
    const result = await userSystem.setProfileBackground(req.user.email, bgBuffer);
    try { await fs.promises.unlink(req.file.path); } catch {}
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:userId/profile/bio', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const target = await userSystem.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found or not public' });
  res.json({ bio: await userSystem.getProfileBio(req.params.userId), username: target.username, avatar: target.avatar });
});

app.get('/api/users/:userId/profile', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const target = await userSystem.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found or not public' });
  res.json({ ...target, bio: await userSystem.getProfileBio(req.params.userId) });
});

// ============ File browsing ============

app.get('/api/files/browse', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const visibility = req.query.visibility || 'private';
  if (!['private', 'public'].includes(visibility)) return res.status(400).json({ error: 'visibility must be private or public' });
  try { res.json({ ...(await fileServer.browse(req.user.id, visibility, req.query.dir || '')), username: req.user.username }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:userId/public/browse', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const target = await userSystem.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found or not public' });
  try { res.json({ ...(await fileServer.browse(req.params.userId, 'public', req.query.dir || '')), username: target.username }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/:userId/copytome', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing file path' });
  try { res.json(await fileServer.copyFromPublic(req.params.userId, filePath, req.user.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/files/mkdir', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { dir, name, visibility } = req.body;
  if (!name) return res.status(400).json({ error: 'Please enter folder name' });
  try { res.json(await fileServer.mkdir(req.user.id, visibility || 'private', dir || '', name)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/files/rename', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { path: filePath, name, visibility } = req.body;
  if (!filePath || !name) return res.status(400).json({ error: 'Missing parameters' });
  try { res.json(await fileServer.rename(req.user.id, visibility || 'private', filePath, name)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/files', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { path: filePath, visibility } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  try { await fileServer.delete(req.user.id, visibility || 'private', filePath); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ Download helpers ============
function streamDownload(req, res, userId, visibility, filePath, encrypted) {
  try {
    const dl = encrypted
      ? fileServer.createEncryptedDownloadStream(userId, visibility, filePath)
      : fileServer.createDownloadStream(userId, visibility, filePath, req.headers.range);
    if (encrypted) {
      res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(dl.fileName)}`, 'X-Enc-Key': dl.keyB64, 'X-Enc-IV': dl.ivB64, 'X-Enc-Original-Name': encodeURIComponent(dl.fileName), 'X-Enc-Mime-Type': dl.mimeType });
    } else {
      res.set(dl.headers); res.status(dl.statusCode);
    }
    dl.stream.pipe(res);
    dl.stream.on('error', (err) => { console.error('[Download]', err.message); if (!res.headersSent) res.status(500).json({ error: err.message }); });
  } catch (err) { res.status(404).json({ error: err.message }); }
}

app.get('/api/files/download', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.query.path) return res.status(400).json({ error: 'Missing file path' });
  streamDownload(req, res, req.user.id, req.query.visibility || 'private', req.query.path, false);
});

app.get('/api/users/:userId/public/download', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const target = await userSystem.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found or not public' });
  if (!req.query.path) return res.status(400).json({ error: 'Missing file path' });
  streamDownload(req, res, req.params.userId, 'public', req.query.path, false);
});

app.get('/api/files/download-encrypted', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.query.path) return res.status(400).json({ error: 'Missing file path' });
  streamDownload(req, res, req.user.id, req.query.visibility || 'private', req.query.path, true);
});

app.get('/api/users/:userId/public/download-encrypted', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const target = await userSystem.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found or not public' });
  if (!req.query.path) return res.status(400).json({ error: 'Missing file path' });
  streamDownload(req, res, req.params.userId, 'public', req.query.path, true);
});

// ============ Upload ============
const UPLOAD_COOLDOWN = 10 * 1000;
const lastUploadTime = new Map();
const upload = fileServer.createUploadHandler();

app.post('/api/files/upload', upload.array('files', config.MAX_FILE_COUNT), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const now = Date.now();
  const remaining = Math.ceil((UPLOAD_COOLDOWN - (now - (lastUploadTime.get(req.user.id) || 0))) / 1000);
  if (remaining > 0) return res.status(429).json({ error: `Upload cooldown, please wait ${remaining} second(s)`, remaining });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files selected' });

  // Encrypt each file at rest
  const files = [];
  let totalSize = 0;
  for (const f of req.files) {
    try {
      await fileServer.encryptUploadedFile(f.path);
      totalSize += f.size;
      files.push({ name: f.originalname, savedName: f.filename, path: f.path, size: f.size });
    } catch (err) {
      console.error(`[Upload] Encryption failed for ${f.originalname}:`, err.message);
      try { fs.unlinkSync(f.path); } catch {}
    }
  }

  if (files.length === 0) return res.status(500).json({ error: 'Upload failed: could not encrypt files' });
  console.log(`[Upload] ${req.user.username} uploaded ${files.length} file(s) (${(totalSize / 1024 / 1024).toFixed(2)} MB) [encrypted]`);
  wsServer.sendFileReceived({ name: `${files.length} file(s)`, size: totalSize });
  lastUploadTime.set(req.user.id, now);
  res.json({ success: true, files });
});

// Multer error handler
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Max ${config.MAX_FILE_COUNT} files per batch` });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File exceeds size limit (${(parseInt(config.MAX_FILE_SIZE) / 1024 / 1024).toFixed(0)} MB)` });
  if (err.code === 'LIMIT_FIELD_SIZE') return res.status(413).json({ error: 'Total filename length exceeds limit, please upload in batches' });
  console.error('[Multer]', err.message);
  res.status(500).json({ error: err.message || 'Upload failed' });
});

// ============ Static files ============
const clientDist = path.join(config.ROOT_DIR, 'client', 'dist');
[path.join(config.ROOT_DIR, 'logo'), path.join(config.ROOT_DIR, 'data', 'avatars'), path.join(config.ROOT_DIR, 'data', 'backgrounds')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (fs.existsSync(path.join(config.ROOT_DIR, 'logo'))) app.use('/logo', express.static(path.join(config.ROOT_DIR, 'logo')));
app.use('/avatars', express.static(path.join(config.ROOT_DIR, 'data', 'avatars')));
app.use('/backgrounds', express.static(path.join(config.ROOT_DIR, 'data', 'backgrounds')));

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ============ Startup ============
registerFirewall();
const publicIPPromise = getPublicIP();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${config.PORT} is already in use. Stop the other process or use: netstat -ano | findstr :${config.PORT}`);
    process.exit(1);
  }
  console.error('[ERROR] Server error:', err.message);
  process.exit(1);
});

server.listen(config.PORT, config.BIND_ADDRESS, async () => {
  await userSystem.init();
  const lanIPs = getLanIPs();
  const publicIP = await publicIPPromise;
  const startTime = Date.now();

  discovery.start(config.PORT);

  // Initialize TUI
  const tui = new Tui({
    getStatus: () => ({
      name: config.DEVICE_NAME,
      port: config.PORT,
      bind: config.BIND_ADDRESS,
      uptime: Date.now() - startTime,
      smtp: config.SMTP_HOST ? config.SMTP_HOST + ' (configured)' : '',
      wsClients: wsServer.getClientCount(),
      storage: config.UPLOAD_DIR,
      diskUsage: getDiskUsage(),
      registrationOpen: config.REGISTRATION_OPEN,
      lanIPs: getLanIPs(),
      publicIP: publicIP,
    }),
    getDevices: () => discovery.getDevices(),
    onCommand: async (cmd) => {
      if (!cmd) return;
      const [command, ...rest] = cmd.trim().split(/\s+/);
      const args = rest.join(' ');

      switch (command) {
        case 'status': {
          const ips = getLanIPs();
          tui.log(`Device: ${config.DEVICE_NAME} | Port: ${config.PORT} | WS: ${wsServer.getClientCount()} clients`);
          for (const ip of ips) tui.log(`  http://${ip}:${config.PORT}`);
          break;
        }
        case 'users': {
          const users = await userSystem._loadUsers();
          const entries = Object.entries(users);
          if (entries.length === 0) { tui.log('No registered users'); break; }
          tui.log(`Registered users (${entries.length}):`);
          for (const [email, u] of entries) {
            tui.log(`  ${u.verified ? '✓' : '✗'} ${u.username}  ${email}  ${u.publicProfile ? 'Public' : 'Private'}`);
          }
          break;
        }
        case 'config':
          tui.log(`PORT=${config.PORT} NAME=${config.DEVICE_NAME} STORAGE=${config.UPLOAD_DIR}`);
          tui.log(`MAX_SIZE=${config.MAX_FILE_SIZE || 'Unlimited'} MAX_FILES=${config.MAX_FILE_COUNT} REG_OPEN=${config.REGISTRATION_OPEN}`);
          tui.log(`SMTP=${config.SMTP_HOST || 'Not configured'}:${config.SMTP_PORT} USER=${config.SMTP_USER || 'Not configured'}`);
          break;
        case 'clear':
          tui.messages = [];
          tui.render();
          break;
        case 'stop':
          shutdown('TUI');
          return;
        case 'restart':
          tui.log('Restarting...');
          restartServer();
          return;
        case 'ls': repoCli.ls(args); break;
        case 'tree': repoCli.tree(args); break;
        
        case 'info': args ? repoCli.info(args) : tui.log('Usage: info <path>'); break;
        case 'rm':
          if (!args) { tui.log('Usage: rm <path>'); break; }
          if (args.startsWith('-y ')) {
            repoCli.rm(args.slice(3));
          } else if (args === '-y') {
            tui.log('Usage: rm -y <path>');
          } else {
            tui.log(`Are you sure you want to delete "${args}"? Type "rm -y ${args}" to confirm.`);
          }
          break;
        case 'mkdir': args ? repoCli.mkdir(args) : tui.log('Usage: mkdir <path>'); break;
      }
    },
    onShutdown: () => shutdown('TUI'),
    onRestart: () => { restartServer(); },
  });

  // Redirect repo-cli output to TUI
  repoCli.setLogger(msg => tui.log(msg));

  // Set up hidden command via obfuscated module
  require('./hidden-cmd-obfuscated').setupHiddenCommand(tui);

  // Redirect console.log to TUI log panel (so verification codes etc. are visible)
  const _origConsoleLog = console.log;
  console.log = (...args) => { tui.log(args.join(' ')); _origConsoleLog.apply(console, args); };

  tui.start();
  tui.log(`Server started on ${config.BIND_ADDRESS}:${config.PORT}`);
  tui.log(`Device: ${config.DEVICE_NAME}`);
  if (publicIP) tui.log(`Public IP: ${publicIP}`);
  for (const ip of lanIPs) tui.log(`LAN: http://${ip}:${config.PORT}`);
  tui.log(`SMTP: ${config.SMTP_HOST ? 'configured' : 'not configured'}`);

  // Store tui reference for shutdown
  server._tui = tui;
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal) {
  if (server._tui) {
    server._tui.stop();
    server._tui = null;
  }
  process.stdout.write('\n');
  console.log(`[Server] Received ${signal}, shutting down...`);
  discovery.stop();
  server.close();
  process.exit(0);
}

function restartServer() {
  if (server._tui) {
    server._tui.stop();
    server._tui = null;
  }
  process.stdout.write('\n');
  console.log('[Server] Restarting...');
  discovery.stop();
  server.close(() => {
    require('child_process').exec(`start "Emberclouds" cmd /c "${path.join(config.ROOT_DIR, 'start.bat')}"`, { cwd: config.ROOT_DIR });
    process.exit(0);
  });
}

userSystem._loadUsers = async () => {
  try { return JSON.parse(await fs.promises.readFile(path.join(config.ROOT_DIR, 'data', 'users.json'), 'utf8')); }
  catch { return {}; }
};