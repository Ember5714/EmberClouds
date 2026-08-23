const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEVICE_ID_FILE = path.join(DATA_DIR, 'device-id');

// ── Load config.json ──────────────────────────────────────────────
function loadConfigFile() {
  const configPath = path.join(ROOT_DIR, 'config.json');
  const examplePath = path.join(ROOT_DIR, 'config.example.json');
  const targetPath = fs.existsSync(configPath) ? configPath : examplePath;

  if (!fs.existsSync(targetPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    console.warn('[Config] Failed to parse config.json, using defaults');
    return {};
  }
}

const fileConfig = loadConfigFile();
const srv = fileConfig.server || {};
const stg = fileConfig.storage || {};
const smtp = fileConfig.smtp || {};
const reg = fileConfig.registration || {};
const tok = fileConfig.token || {};
const vfy = fileConfig.verification || {};
const rl = fileConfig.rateLimit || {};
const sec = fileConfig.security || {};
const ws = fileConfig.websocket || {};

// ── Env var helper: env > config file > default ────────────────────
function get(key, configFileVal, defaultVal) {
  if (process.env[key] !== undefined) return process.env[key];
  if (configFileVal !== undefined) return configFileVal;
  return defaultVal;
}

// ── Persist DEVICE_ID ──────────────────────────────────────────────
function getDeviceId() {
  if (process.env.DEVICE_ID) return process.env.DEVICE_ID;
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) return fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
  } catch {}
  const id = crypto.randomUUID();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, id, 'utf8');
  } catch {}
  return id;
}

module.exports = {
  // ── Server ──
  PORT: parseInt(get('PORT', srv.port, 3000)),
  BIND_ADDRESS: get('BIND_ADDRESS', srv.bindAddress, '0.0.0.0'),
  DEVICE_NAME: get('DEVICE_NAME', srv.deviceName, os.hostname()),
  DEVICE_ID: getDeviceId(),
  REQUEST_TIMEOUT: parseInt(get('REQUEST_TIMEOUT', srv.requestTimeout, 5000)),
  HEADERS_TIMEOUT: parseInt(get('HEADERS_TIMEOUT', srv.headersTimeout, 6000)),
  KEEPALIVE_TIMEOUT: parseInt(get('KEEPALIVE_TIMEOUT', srv.keepAliveTimeout, 5000)),

  // ── Storage ──
  UPLOAD_DIR: get('UPLOAD_DIR', stg.uploadDir, path.join(ROOT_DIR, 'file')),
  ROOT_DIR,
  CHUNK_SIZE: parseInt(get('CHUNK_SIZE', stg.chunkSize, 65536)),
  MAX_FILE_SIZE: get('MAX_FILE_SIZE', stg.maxFileSize, '0'),
  MAX_FILE_COUNT: parseInt(get('MAX_FILE_COUNT', stg.maxFileCount, 500)),
  UPLOAD_COOLDOWN: parseInt(get('UPLOAD_COOLDOWN', stg.uploadCooldown, 10000)),

  // ── Registration ──
  REGISTRATION_OPEN: get('REGISTRATION_OPEN', reg.open, true) !== false
    && process.env.REGISTRATION_OPEN !== 'false',

  // ── SMTP ──
  SMTP_HOST: get('SMTP_HOST', smtp.host, ''),
  SMTP_PORT: get('SMTP_PORT', smtp.port, '587'),
  SMTP_USER: get('SMTP_USER', smtp.user, ''),
  SMTP_PASS: get('SMTP_PASS', smtp.pass, ''),

  // ── Token ──
  token: {
    accessTokenTTL: parseInt(get('TOKEN_ACCESS_TTL', tok.accessTokenTTL, 43200000)),
    refreshTokenTTL: parseInt(get('TOKEN_REFRESH_TTL', tok.refreshTokenTTL, 604800000)),
  },

  // ── Verification Code ──
  verification: {
    codeTTL: parseInt(get('VERIFY_CODE_TTL', vfy.codeTTL, 600000)),
    codeFailMax: parseInt(get('VERIFY_CODE_FAIL_MAX', vfy.codeFailMax, 5)),
    codeFailLockMs: parseInt(get('VERIFY_CODE_FAIL_LOCK', vfy.codeFailLockMs, 3600000)),
  },

  // ── Rate Limits ──
  rateLimit: {
    register:  { max: parseInt(get('RL_REGISTER_MAX', rl.register?.max, 3)),  windowMs: parseInt(get('RL_REGISTER_WINDOW', rl.register?.windowMs, 3600000)) },
    login:     { max: parseInt(get('RL_LOGIN_MAX', rl.login?.max, 10)),     windowMs: parseInt(get('RL_LOGIN_WINDOW', rl.login?.windowMs, 900000)) },
    verify:    { max: parseInt(get('RL_VERIFY_MAX', rl.verify?.max, 10)),    windowMs: parseInt(get('RL_VERIFY_WINDOW', rl.verify?.windowMs, 900000)) },
    resend:    { max: parseInt(get('RL_RESEND_MAX', rl.resend?.max, 5)),     windowMs: parseInt(get('RL_RESEND_WINDOW', rl.resend?.windowMs, 900000)) },
  },

  // ── Security ──
  security: {
    maxRateLimitEntries: parseInt(get('SEC_MAX_RATELIMIT', sec.maxRateLimitEntries, 10000)),
    maxLoginDelayEntries: parseInt(get('SEC_MAX_LOGINDELAY', sec.maxLoginDelayEntries, 5000)),
  },

  // ── WebSocket ──
  websocket: {
    authTimeout: parseInt(get('WS_AUTH_TIMEOUT', ws.authTimeout, 10000)),
    maxUnauthenticated: parseInt(get('WS_MAX_UNAUTH', ws.maxUnauthenticated, 10)),
  },

  MDNS_SERVICE_TYPE: '_transferhd._tcp',
};