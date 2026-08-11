const path = require('path');
const os = require('os');

const ROOT_DIR = path.join(__dirname, '..', '..');

module.exports = {
  PORT: process.env.PORT || 3000,
  BIND_ADDRESS: process.env.BIND_ADDRESS || '127.0.0.1',
  DEVICE_NAME: process.env.DEVICE_NAME || os.hostname(),
  DEVICE_ID: process.env.DEVICE_ID || require('uuid').v4(),
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