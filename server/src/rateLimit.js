// ============ Rate Limit Module ============
// IP-based rate limiting to prevent brute-force registration and login
const rateLimit = new Map(); // ip -> { count, resetAt }

let LIMITS = {
  register:  { max: 3,  windowMs: 60 * 60 * 1000 },  // 3 per hour
  login:     { max: 10, windowMs: 15 * 60 * 1000 },  // 10 per 15 min
  verify:    { max: 10, windowMs: 15 * 60 * 1000 },  // 10 per 15 min
  resend:    { max: 5,  windowMs: 15 * 60 * 1000 },  // 5 per 15 min
};

let MAX_RATE_LIMIT_ENTRIES = 10000;
let MAX_LOGIN_DELAY_ENTRIES = 5000;

// Initialize from centralized config
function init(rateLimitCfg, securityCfg) {
  if (rateLimitCfg) LIMITS = rateLimitCfg;
  if (securityCfg) {
    MAX_RATE_LIMIT_ENTRIES = securityCfg.maxRateLimitEntries || 10000;
    MAX_LOGIN_DELAY_ENTRIES = securityCfg.maxLoginDelayEntries || 5000;
  }
}

// Login failure incremental delay (seconds)
const loginDelays = new Map(); // ip -> { failures, until }

function getIP(req) {
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

function check(ip, action) {
  const limit = LIMITS[action];
  if (!limit) return true;

  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    if (rateLimit.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimit.has(ip)) {
      const oldest = rateLimit.keys().next().value;
      if (oldest) rateLimit.delete(oldest);
    }
    rateLimit.set(ip, { count: 1, resetAt: now + limit.windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit.max;
}

function getLoginDelay(ip) {
  const entry = loginDelays.get(ip);
  if (!entry) return 0;
  if (Date.now() > entry.until) {
    loginDelays.delete(ip);
    return 0;
  }
  return entry.until - Date.now();
}

function recordLoginFailure(ip) {
  if (loginDelays.size >= MAX_LOGIN_DELAY_ENTRIES && !loginDelays.has(ip)) {
    const oldest = loginDelays.keys().next().value;
    if (oldest) loginDelays.delete(oldest);
  }
  const entry = loginDelays.get(ip) || { failures: 0, until: 0 };
  entry.failures++;
  entry.until = Date.now() + Math.min(entry.failures * 2000, 30000);
  loginDelays.set(ip, entry);
}

function resetLoginFailures(ip) {
  loginDelays.delete(ip);
}

// Periodic cleanup (every 10 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimit) {
    if (now > entry.resetAt) rateLimit.delete(ip);
  }
  for (const [ip, entry] of loginDelays) {
    if (now > entry.until) loginDelays.delete(ip);
  }
}, 10 * 60 * 1000);

module.exports = { init, check, getLoginDelay, recordLoginFailure, resetLoginFailures, getIP };