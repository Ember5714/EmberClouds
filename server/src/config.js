const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEVICE_ID_FILE = path.join(DATA_DIR, 'device-id');

// Persist DEVICE_ID across restarts — it is used as the encryption key for user data.
// Priority: env var > file > auto-generate and save
function getDeviceId() {
  if (process.env.DEVICE_ID) return process.env.DEVICE_ID;
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) return fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
  } catch {}
  // Generate and persist a new ID
  const id = crypto.randomUUID();
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, id, 'utf8');
  } catch {}
  return id;
}

module.exports = {
  PORT: process.env.PORT || 3000,
  BIND_ADDRESS: process.env.BIND_ADDRESS || '0.0.0.0',
  DEVICE_NAME: process.env.DEVICE_NAME || os.hostname(),
  DEVICE_ID: getDeviceId(),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT_DIR, 'file'),
  ROOT_DIR,
  MDNS_SERVICE_TYPE: '_transferhd._tcp',
  CHUNK_SIZE: 64 * 1024,
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || '0',
  MAX_FILE_COUNT: parseInt(process.env.MAX_FILE_COUNT) || 500,
  REGISTRATION_OPEN: process.env.REGISTRATION_OPEN !== 'false',

  // SMTP config
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
};