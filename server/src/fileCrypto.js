/**
 * At-rest file encryption module
 * AES-256-CTR — supports random access for Range requests
 * File format: [16 bytes IV][encrypted content]
 */
const crypto = require('crypto');
const fs = require('fs');
const config = require('./config');

const ALGO = 'aes-256-ctr';
const IV_LEN = 16;
const MASTER_KEY = crypto.scryptSync(config.DEVICE_ID + 'emberclouds-file-v1', 'emberclouds-file-salt', 32);

// Encrypt source file to dest path (IV header + encrypted content)
function encryptFile(srcPath) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, MASTER_KEY, iv);
    const tmpPath = srcPath + '.enc_tmp';

    const src = fs.createReadStream(srcPath);
    const dest = fs.createWriteStream(tmpPath);
    dest.write(iv);

    src.pipe(cipher).pipe(dest);
    dest.on('finish', () => {
      // Replace original with encrypted version
      fs.renameSync(tmpPath, srcPath);
      resolve(srcPath);
    });
    dest.on('error', reject);
    src.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
}

// Get original file size from encrypted file
function getOriginalSize(encryptedSize) {
  return encryptedSize > IV_LEN ? encryptedSize - IV_LEN : 0;
}

// Create a decrypt stream for an encrypted file with optional Range support
function createDecryptStream(filePath, range) {
  const fd = fs.openSync(filePath, 'r');
  const iv = Buffer.alloc(IV_LEN);
  fs.readSync(fd, iv, 0, IV_LEN, 0);

  const stat = fs.fstatSync(fd);
  const originalSize = stat.size - IV_LEN;

  let start = 0, end = originalSize - 1;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    start = Math.max(0, parseInt(parts[0], 10) || 0);
    end = parts[1] ? Math.min(parseInt(parts[1], 10), originalSize - 1) : originalSize - 1;
  }

  const decipher = createCTRDecipher(iv, start);
  const readStream = fs.createReadStream(filePath, {
    fd,
    start: IV_LEN + start,
    end: IV_LEN + end,
    autoClose: true,
  });

  const contentLength = end - start + 1;

  return {
    stream: readStream.pipe(decipher),
    originalSize,
    contentLength,
    start,
    end,
    statusCode: range ? 206 : 200,
  };
}

// Create a CTR decipher with counter advanced to seekBytes
function createCTRDecipher(iv, seekBytes) {
  const blockSize = 16;
  const blockIndex = Math.floor(seekBytes / blockSize);
  const byteOffset = seekBytes % blockSize;

  const adjustedIv = Buffer.alloc(IV_LEN);
  iv.copy(adjustedIv);

  // Increment counter (last 8 bytes) by blockIndex
  let counter = adjustedIv.readBigUInt64BE(8) + BigInt(blockIndex);
  adjustedIv.writeBigUInt64BE(counter, 8);

  const decipher = crypto.createDecipheriv(ALGO, MASTER_KEY, adjustedIv);

  // Discard keystream bytes for partial block offset
  if (byteOffset > 0) {
    decipher.update(Buffer.alloc(byteOffset));
  }

  return decipher;
}

// Quick check if a file is encrypted (has IV header)
function isEncryptedFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size > IV_LEN;
  } catch { return false; }
}

module.exports = { encryptFile, createDecryptStream, getOriginalSize, IV_LEN, isEncryptedFile };