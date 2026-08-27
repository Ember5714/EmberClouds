/**
 * Repository CLI Commands
 * Provides ls, tree, rm, mkdir, du, info commands
 * Supports output redirection via setLogger() for CLI integration
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

let _log = console.log;
let _outputs = [];

function setLogger(fn) {
  _log = fn || console.log;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function resolvePath(relPath) {
  const safe = path.normalize(relPath || '').replace(/^(\.\.[/\\])+/, '');
  const full = path.join(config.UPLOAD_DIR, safe);
  if (!full.startsWith(config.UPLOAD_DIR)) {
    throw new Error('Path exceeds repository scope');
  }
  return full;
}

function ls(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    _log(`  Path does not exist: ${relPath || '/'}`);
    return;
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    _log(`  -  ${formatSize(stat.size)}  ${new Date(stat.mtime).toLocaleString()}  ${path.basename(full)}`);
    return;
  }
  const entries = fs.readdirSync(full);
  const rel = path.relative(config.UPLOAD_DIR, full) || '.';
  _log(`  ${rel}/`);
  if (entries.length === 0) {
    _log('  (empty directory)');
    return;
  }
  const list = entries.map(n => {
    const s = fs.statSync(path.join(full, n));
    return { name: n, isDir: s.isDirectory(), size: s.size, mtime: s.mtime };
  }).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  for (const e of list) {
    const prefix = e.isDir ? 'd' : '-';
    _log(`  ${prefix}  ${formatSize(e.size).padStart(8)}  ${new Date(e.mtime).toLocaleString()}  ${e.name}${e.isDir ? '/' : ''}`);
  }
  _log(`  ${list.length} item(s)`);
}

function tree(relPath, indent = '') {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    _log(`${indent}${path.basename(full)} (does not exist)`);
    return;
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    _log(`${indent}${path.basename(full)} (${formatSize(stat.size)})`);
    return;
  }
  _log(`${indent}${path.basename(full) || relPath || 'file'}/`);
  const entries = fs.readdirSync(full).sort();
  for (let i = 0; i < entries.length; i++) {
    const isLast = i === entries.length - 1;
    const child = path.join(full, entries[i]);
    const prefix = indent + (isLast ? '  └─ ' : '  ├─ ');
    tree(path.relative(config.UPLOAD_DIR, child), prefix);
  }
}

function rm(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    _log(`  Path does not exist: ${relPath}`);
    return;
  }
  try {
    fs.rmSync(full, { recursive: true, force: true });
    _log(`  Deleted: ${relPath}`);
  } catch (err) {
    _log(`  Delete failed: ${err.message}`);
  }
}

function mkdir(relPath) {
  const full = resolvePath(relPath);
  if (fs.existsSync(full)) {
    _log(`  Path already exists: ${relPath}`);
    return;
  }
  try {
    fs.mkdirSync(full, { recursive: true });
    _log(`  Created: ${relPath}`);
  } catch (err) {
    _log(`  Create failed: ${err.message}`);
  }
}

function du(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    _log(`  Path does not exist: ${relPath || '/'}`);
    return;
  }
  let totalSize = 0, totalFiles = 0, totalDirs = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const s = fs.statSync(p);
      if (s.isDirectory()) { totalDirs++; walk(p); }
      else { totalSize += s.size; totalFiles++; }
    }
  };
  const stat = fs.statSync(full);
  if (stat.isDirectory()) { totalDirs++; walk(full); }
  else { totalSize = stat.size; totalFiles = 1; }
  _log(`  ${relPath || 'Repository root'}`);
  _log(`  Files: ${totalFiles}`);
  _log(`  Directories: ${totalDirs}`);
  _log(`  Total size: ${formatSize(totalSize)}`);
}

function info(relPath) {
  const full = resolvePath(relPath);
  if (!fs.existsSync(full)) {
    _log(`  Path does not exist: ${relPath}`);
    return;
  }
  const stat = fs.statSync(full);
  _log(`  Path:     ${relPath || '/'}`);
  _log(`  Type:     ${stat.isDirectory() ? 'Directory' : 'File'}`);
  _log(`  Size:     ${formatSize(stat.size)}`);
  _log(`  Created: ${new Date(stat.birthtime).toLocaleString()}`);
  _log(`  Modified: ${new Date(stat.mtime).toLocaleString()}`);
  if (stat.isDirectory()) {
    _log(`  Items:   ${fs.readdirSync(full).length}`);
  }
}

module.exports = { ls, tree, rm, mkdir, du, info, formatSize, setLogger };