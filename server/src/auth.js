/**
 * Token auth middleware
 */
const users = require('./users');

const PUBLIC_PATHS = [
  '/api/auth/register', '/api/auth/verify', '/api/auth/resend',
  '/api/auth/login', '/api/auth/refresh',
  '/api/auth/send-reset-code', '/api/auth/reset-password',
];

async function auth(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) return next();

  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader) token = authHeader.replace('Bearer ', '');

  const user = await users.validateToken(token);
  if (user) { req.user = user; req.token = token; return next(); }

  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
  next();
}

module.exports = auth;