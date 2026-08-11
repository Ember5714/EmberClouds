const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
console.log('CWD:', cwd);

const nmPath = path.join(cwd, 'node_modules');
console.log('node_modules path:', nmPath);
console.log('exists:', fs.existsSync(nmPath));

try {
  const entries = fs.readdirSync(nmPath);
  console.log('entries count:', entries.length);
  console.log('first 10:', entries.slice(0, 10));
} catch(e) {
  console.log('readdir error:', e.message);
}

// Try to require iconv-lite
try {
  require('iconv-lite');
  console.log('iconv-lite OK');
} catch(e) {
  console.log('iconv-lite error:', e.message);
}