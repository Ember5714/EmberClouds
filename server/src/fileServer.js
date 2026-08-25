/**
 * File service module — File browsing, upload/download, thumbnails, folder operations
 * User isolation: private/{userId}/... and public/{userId}/...
 * At-rest encryption: AES-256-CTR, files stored as [IV(16B)][encrypted]
 */
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const zlib = require('zlib');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const fileCrypto = require('./fileCrypto');

const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip', '.rar': 'application/x-rar-compressed', '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar', '.gz': 'application/gzip', '.bz2': 'application/x-bzip2',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.log': 'text/plain',
  '.json': 'application/json', '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.ts': 'text/typescript', '.tsx': 'text/typescript', '.jsx': 'text/javascript',
  '.py': 'text/x-python', '.java': 'text/x-java-source', '.c': 'text/x-c', '.cpp': 'text/x-c++',
  '.h': 'text/x-c', '.hpp': 'text/x-c++', '.cs': 'text/plain', '.go': 'text/plain',
  '.rs': 'text/plain', '.rb': 'text/x-ruby', '.php': 'text/x-php', '.swift': 'text/plain',
  '.kt': 'text/plain', '.scala': 'text/plain', '.lua': 'text/plain', '.r': 'text/plain',
  '.sh': 'text/x-sh', '.bat': 'text/plain', '.ps1': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.exe': 'application/x-msdownload', '.msi': 'application/x-msdownload',
  '.apk': 'application/vnd.android.package-archive', '.dmg': 'application/x-apple-diskimage',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.sql': 'application/sql', '.db': 'application/octet-stream',
  '.toml': 'text/plain', '.ini': 'text/plain', '.cfg': 'text/plain', '.conf': 'text/plain',
  '.env': 'text/plain', '.lock': 'text/plain',
};

const CATEGORY_ICONS = {
  image: '🖼️', video: '🎬', audio: '🎵',
  pdf: '📄', archive: '📦',
  doc: '📝', sheet: '📊', slides: '📽️',
  text: '📃', code: '💻',
  exec: '⚙️',
};

function getMimeType(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

class FileServer {
  constructor() {
    this.uploadDir = config.UPLOAD_DIR;
    this._ensureRoot();
  }

  _ensureRoot() {
    if (!fs.existsSync(this.uploadDir)) {
      try { fs.mkdirSync(this.uploadDir, { recursive: true }); } catch (e) {
        if (e.code === 'EPERM') {
          try { fs.mkdirSync(this.uploadDir, { recursive: true }); } catch (_) {
            console.error(`[FileServer] Cannot access storage: ${this.uploadDir}`);
          const permCmd = process.platform === 'win32'
            ? `icacls "${this.uploadDir}" /reset /T /Q`
            : `chmod -R 755 "${this.uploadDir}"`;
          console.error(`[FileServer] Fix permissions: ${permCmd}`);
            process.exit(1);
          }
        } else throw e;
      }
    }
    ['public', 'private'].forEach(dir => {
      const p = path.join(this.uploadDir, dir);
      if (!fs.existsSync(p)) try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
    });
  }

  _buildPath(userId, visibility, relativePath) {
    const baseDir = visibility === 'public' ? 'public' : 'private';
    return path.join(path.resolve(this.uploadDir), baseDir, userId, relativePath || '');
  }

  _checkPath(absPath) {
    const rel = path.relative(path.resolve(this.uploadDir), absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Access denied');
  }

  _checkUserIsolation(absPath, userId) {
    const segments = path.relative(path.resolve(this.uploadDir), absPath).split(path.sep);
    if (segments.length < 2 || segments[1] !== userId) throw new Error('Access denied');
  }

  _getCategory(name) {
    const ext = path.extname(name).toLowerCase().replace('.', '');
    if (['jpg','jpeg','png','gif','webp','bmp','svg','ico'].includes(ext)) return 'image';
    if (['mp4','mkv','avi','mov','wmv','flv','webm'].includes(ext)) return 'video';
    if (['mp3','wav','flac','aac','ogg','wma'].includes(ext)) return 'audio';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return 'archive';
    if (['doc','docx'].includes(ext)) return 'doc';
    if (['xls','xlsx','csv'].includes(ext)) return 'sheet';
    if (['ppt','pptx'].includes(ext)) return 'slides';
    if (['txt','md','json','xml','yml','yaml','log','ini','cfg'].includes(ext)) return 'text';
    if (['js','ts','jsx','tsx','py','java','c','cpp','h','go','rs','rb','php','html','css','vue','swift','kt'].includes(ext)) return 'code';
    if (['exe','msi','dll','bat','sh','ps1','cmd'].includes(ext)) return 'exec';
    return 'file';
  }

  _getIcon(name, isDir) { return isDir ? '📁' : (CATEGORY_ICONS[this._getCategory(name)] || '📄'); }

  async copyFromPublic(srcUserId, filePath, destUserId) {
    const srcAbs = this._buildPath(srcUserId, 'public', filePath);
    this._checkPath(srcAbs); this._checkUserIsolation(srcAbs, srcUserId);
    if (!fs.existsSync(srcAbs)) throw new Error('File does not exist');

    const stat = await fsp.stat(srcAbs);
    const destDir = this._buildPath(destUserId, 'private', path.dirname(filePath));
    if (!fs.existsSync(destDir)) await fsp.mkdir(destDir, { recursive: true });

    const destAbs = this._buildPath(destUserId, 'private', filePath);
    if (fs.existsSync(destAbs)) throw new Error('File already exists in destination');

    // Copy encrypted file directly (no need to decrypt/re-encrypt since same master key)
    await fsp.cp(srcAbs, destAbs, { recursive: stat.isDirectory() });
    return { path: filePath, name: path.basename(filePath) };
  }

  async browse(userId, visibility, dirPath) {
    const absPath = this._buildPath(userId, visibility, dirPath);
    this._checkPath(absPath); this._checkUserIsolation(absPath, userId);
    if (!fs.existsSync(absPath)) fs.mkdirSync(absPath, { recursive: true });

    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    const items = [];
    for (const e of entries) {
      const full = path.join(absPath, e.name);
      let stat;
      try { stat = await fsp.stat(full); } catch { continue; }
      // Show original file size (subtract IV header)
      const displaySize = e.isDirectory() ? stat.size : fileCrypto.getOriginalSize(stat.size);
      items.push({ name: e.name, path: dirPath ? path.join(dirPath, e.name) : e.name, isDir: e.isDirectory(), size: displaySize, mtime: stat.mtime.toISOString(), category: e.isDirectory() ? 'folder' : this._getCategory(e.name), icon: this._getIcon(e.name, e.isDirectory()) });
    }
    items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
    return { dir: dirPath, visibility, userId, items, parent: (!dirPath || dirPath === '') ? null : path.dirname(dirPath) };
  }

  async mkdir(userId, visibility, dirPath, name) {
    const absPath = this._buildPath(userId, visibility, dirPath);
    this._checkPath(absPath); this._checkUserIsolation(absPath, userId);
    const newDir = path.join(absPath, name);
    this._checkPath(newDir);
    if (fs.existsSync(newDir)) throw new Error('Folder already exists');
    await fsp.mkdir(newDir, { recursive: true });
    return { path: dirPath ? path.join(dirPath, name) : name, name, visibility, userId };
  }

  async delete(userId, visibility, targetPath) {
    const absPath = this._buildPath(userId, visibility, targetPath);
    this._checkPath(absPath); this._checkUserIsolation(absPath, userId);
    if (!fs.existsSync(absPath)) throw new Error('File does not exist');
    const stat = await fsp.stat(absPath);
    stat.isDirectory() ? await fsp.rm(absPath, { recursive: true, force: true }) : await fsp.unlink(absPath);
    return true;
  }

  async rename(userId, visibility, oldPath, newName) {
    const absOld = this._buildPath(userId, visibility, oldPath);
    this._checkPath(absOld); this._checkUserIsolation(absOld, userId);
    const absNew = path.join(path.dirname(absOld), newName);
    this._checkPath(absNew);
    if (fs.existsSync(absNew)) throw new Error('Name already exists');
    await fsp.rename(absOld, absNew);
    return { path: path.join(path.dirname(oldPath), newName), name: newName, visibility, userId };
  }

  // Transport-encrypted download (decrypt at-rest → gzip → re-encrypt for transit)
  createEncryptedDownloadStream(userId, visibility, filePath) {
    const absPath = this._buildPath(userId, visibility, filePath);
    this._checkPath(absPath); this._checkUserIsolation(absPath, userId);
    const key = crypto.randomBytes(32), iv = crypto.randomBytes(16);

    // Decrypt at-rest file, then gzip + re-encrypt for transport
    const decryptStream = fileCrypto.createDecryptStream(absPath, null);
    const stream = decryptStream.stream
      .pipe(zlib.createGzip())
      .pipe(crypto.createCipheriv('aes-256-ctr', key, iv));

    return { stream, keyB64: key.toString('base64'), ivB64: iv.toString('base64'), fileName: path.basename(absPath), fileSize: decryptStream.originalSize, mimeType: getMimeType(absPath) };
  }

  // Normal download (decrypt at-rest file)
  createDownloadStream(userId, visibility, filePath, range) {
    const absPath = this._buildPath(userId, visibility, filePath);
    this._checkPath(absPath); this._checkUserIsolation(absPath, userId);

    const dl = fileCrypto.createDecryptStream(absPath, range);

    const mimeType = getMimeType(absPath);
    const inline = ['image/jpeg','image/png','image/gif','image/webp'].includes(mimeType) ? 'inline' : 'attachment';

    return {
      stream: dl.stream,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${dl.start}-${dl.end}/${dl.originalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': dl.contentLength,
        'Content-Disposition': `${inline}; filename*=UTF-8''${encodeURIComponent(path.basename(absPath))}`,
      },
      statusCode: dl.statusCode,
    };
  }

  // Multer upload handler (files encrypted by index.js upload route after multer saves)
  createUploadHandler() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        // Use req.user.id from auth middleware instead of req.body.userId to prevent user isolation bypass
        if (!req.user || !req.user.id) return cb(new Error('Not authenticated'), '');
        const visibility = req.body.visibility || 'private';
        const dir = req.body.dir || '';
        const absDir = this._buildPath(req.user.id, visibility, dir);
        this._checkPath(absDir); this._checkUserIsolation(absDir, req.user.id);
        if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
        cb(null, absDir);
      },
      filename: (req, file, cb) => {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const visibility = req.body.visibility || 'private';
        const dir = req.body.dir || '';
        const destPath = path.join(this._buildPath(req.user.id, visibility, dir), originalName);
        if (fs.existsSync(destPath)) {
          const ext = path.extname(originalName);
          cb(null, `${path.basename(originalName, ext)}_${Date.now()}${ext}`);
        } else cb(null, originalName);
      },
    });
    return multer({ storage, limits: { ...(config.MAX_FILE_SIZE > 0 ? { fileSize: parseInt(config.MAX_FILE_SIZE) } : {}), fieldSize: 10 * 1024 * 1024, fields: 100, files: config.MAX_FILE_COUNT } });
  }

  _createImageUploadHandler(maxSizeMB, tmpPrefix) {
    const tmpDir = path.join(config.ROOT_DIR, 'data', 'tmp');
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        cb(null, tmpDir);
      },
      filename: (req, file, cb) => cb(null, `${tmpPrefix}_${Date.now()}_${file.originalname}`),
    });
    return multer({
      storage, limits: { fileSize: maxSizeMB * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        cb(allowed.includes(file.mimetype) ? null : new Error('Only JPG, PNG, GIF, WebP formats are supported'), allowed.includes(file.mimetype));
      },
    });
  }

  // Encrypt a file after upload
  encryptUploadedFile(filePath) {
    return fileCrypto.encryptFile(filePath);
  }

  createAvatarUploadHandler() { return this._createImageUploadHandler(2, 'av'); }
  createBackgroundUploadHandler() { return this._createImageUploadHandler(5, 'bg'); }
}

module.exports = new FileServer();