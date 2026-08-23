/**
 * User system — Register / Email verify / Login / Token / Account management
 */
const fs = require('fs/promises');
const fss = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('./config');
const fileLock = require('./fileLock');
const rateLimit = require('./rateLimit');

const DATA_FILE = path.join(config.ROOT_DIR, 'data', 'users.json');
const TOKEN_FILE = path.join(config.ROOT_DIR, 'data', 'tokens.json');
const REFRESH_FILE = path.join(config.ROOT_DIR, 'data', 'refresh_tokens.json');
const AVATAR_DIR = path.join(config.ROOT_DIR, 'data', 'avatars');
const PROFILE_DIR = path.join(config.ROOT_DIR, 'data', 'profiles');
const BG_DIR = path.join(config.ROOT_DIR, 'data', 'backgrounds');
const SALT_LEN = 16, KEY_LEN = 64;
const TOKEN_TTL = config.token.accessTokenTTL;
const REFRESH_TTL = config.token.refreshTokenTTL;
const CODE_FAIL_MAX = config.verification.codeFailMax;
const CODE_FAIL_LOCK_MS = config.verification.codeFailLockMs;

function logCode(label, email, code) {
  console.log(`[Email] ${label} for ${email}: ${code}`);
}

// ============ Data encryption (AES-256-GCM) ============
const ENC_KEY = crypto.scryptSync(config.DEVICE_ID, 'transferhd-data-enc-key', 32);
const ENC_ALGO = 'aes-256-gcm';

function encryptData(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptData(cipherB64) {
  const buf = Buffer.from(cipherB64, 'base64');
  const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, buf.subarray(0, 16));
  decipher.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]).toString('utf8');
}

function isEncrypted(content) {
  return content.trim().length > 0 && content.trim()[0] !== '{';
}

async function readEncrypted(filePath) {
  try {
    const raw = await fileLock.readJSON(filePath);
    if (!raw) return null;
    return isEncrypted(raw) ? JSON.parse(decryptData(raw)) : JSON.parse(raw);
  } catch { return null; }
}

async function writeEncrypted(filePath, data) {
  await fileLock.writeJSON(filePath, encryptData(JSON.stringify(data, null, 2)));
}

// ============ Init ============
async function init() {
  const dir = path.dirname(DATA_FILE);
  try { await fs.stat(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
  const users = await loadUsers();
  let migrated = false;
  for (const email of Object.keys(users)) {
    if (users[email].publicProfile === undefined) {
      users[email].publicProfile = false;
      migrated = true;
    }
  }
  if (migrated) {
    await saveUsers(users);
    console.log('[Users] Migrated old user data, added publicProfile field');
  }
  const tokens = await loadTokens();
  let cleaned = 0;
  for (const key of Object.keys(tokens)) {
    if (!tokens[key].refreshHash) { delete tokens[key]; cleaned++; }
  }
  if (cleaned > 0) {
    await saveTokens(tokens);
    console.log(`[Users] Cleaned ${cleaned} old format token(s) (re-login required)`);
  }
}

// ============ User data cache ============
let _usersCache = null;
let _usersCacheTime = 0;
const USERS_CACHE_TTL = 5000; // 5 seconds

async function loadUsers() {
  const now = Date.now();
  if (_usersCache && (now - _usersCacheTime) < USERS_CACHE_TTL) return _usersCache;
  const data = await readEncrypted(DATA_FILE);
  if (data) {
    _usersCache = data;
    _usersCacheTime = now;
    return data;
  }
  const e = {};
  await writeEncrypted(DATA_FILE, e);
  _usersCache = e;
  _usersCacheTime = now;
  return e;
}
async function saveUsers(u) {
  _usersCache = u;
  _usersCacheTime = Date.now();
  await writeEncrypted(DATA_FILE, u);
}

async function loadTokens() {
  const data = await readEncrypted(TOKEN_FILE);
  if (data) return data;
  const e = {};
  await writeEncrypted(TOKEN_FILE, e);
  return e;
}
async function saveTokens(t) { await writeEncrypted(TOKEN_FILE, t); }

async function loadRefreshTokens() {
  const data = await readEncrypted(REFRESH_FILE);
  if (data) return data;
  const e = {};
  await writeEncrypted(REFRESH_FILE, e);
  return e;
}
async function saveRefreshTokens(t) { await writeEncrypted(REFRESH_FILE, t); }

// ============ Password ============
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, KEY_LEN).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(crypto.scryptSync(password, salt, KEY_LEN).toString('hex')));
}

function validatePassword(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers';
  return null;
}

// ============ Verification code ============
function generateCode() { return crypto.randomInt(10000000, 99999999).toString(); }

function hashCode(code) {
  const salt = crypto.randomBytes(8).toString('hex');
  return `${salt}:${crypto.scryptSync(code, salt, 32).toString('hex')}`;
}

function verifyCode(code, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(crypto.scryptSync(code, salt, 32).toString('hex')));
}

function checkCodeLockout(entry) {
  if (!entry.codeFailCount || entry.codeFailCount < CODE_FAIL_MAX) return null;
  if (Date.now() - entry.codeLastFailAt < CODE_FAIL_LOCK_MS) {
    const remain = Math.ceil((CODE_FAIL_LOCK_MS - (Date.now() - entry.codeLastFailAt)) / 60000);
    return `Too many code attempts, please wait ${remain} minute(s) before retrying`;
  }
  entry.codeFailCount = 0;
  entry.codeLastFailAt = 0;
  return null;
}

function recordCodeFailure(entry) {
  entry.codeFailCount = (entry.codeFailCount || 0) + 1;
  entry.codeLastFailAt = Date.now();
}

function clearCodeFailures(entry) {
  entry.codeFailCount = 0;
  entry.codeLastFailAt = 0;
}

// ============ Token hash ============
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ============ Email ============
function createTransport() {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: parseInt(config.SMTP_PORT || '587'),
    secure: config.SMTP_PORT === '465',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
}

async function sendEmail(to, subject, text, html) {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    console.warn('[Email] SMTP not configured, skipping send');
    return false;
  }
  try {
    await createTransport().sendMail({ from: `"Emberclouds" <${config.SMTP_USER}>`, to, subject, text, html });
    return true;
  } catch (err) {
    console.error('[Email] send failed:', err.message);
    return false;
  }
}

async function sendVerificationEmail(to, code) {
  return sendEmail(to, 'Emberclouds Verification Code',
    `Your verification code: ${code}\n\nValid for 10 minutes.`,
    `<p>Your verification code: <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes.</p>`);
}

async function sendOperationEmail(to, code, operation) {
  const labels = { changePassword: 'Change Password', deleteAccount: 'Delete Account', resetPassword: 'Reset Password' };
  const label = labels[operation] || 'Sensitive Operation';
  return sendEmail(to, `Emberclouds - ${label} Code`,
    `Your ${label} verification code: ${code}\n\nValid for 10 minutes. If this was not you, please check your account security.`,
    `<p>Your <strong>${label}</strong> verification code: <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>Valid for 10 minutes. If this was not you, please check your account security.</p>`);
}

// ============ Register ============
async function register({ email, username, password, ip }) {
  const users = await loadUsers();
  if (users[email] && users[email].verified) return { error: 'Email already registered' };

  // Apply rate limit before sending email to prevent abuse even when SMTP is down
  if (ip) {
    const limited = rateLimit.check(ip, 'register');
    if (limited) return { error: 'Too many registration attempts, please try again later' };
  }

  const code = generateCode();
  users[email] = {
    id: crypto.randomUUID(), email, username, passwordHash: hashPassword(password),
    verified: false, codeHash: hashCode(code), publicProfile: false,
    codeExpires: Date.now() + config.verification.codeTTL, createdAt: Date.now(),
  };
  await saveUsers(users);

  const sent = await sendVerificationEmail(email, code);
  logCode('Verification code', email, code);

  return { success: true, email, smtpSent: sent };
}

// ============ Verify email ============
async function verify(email, code) {
  const users = await loadUsers();
  const entry = users[email];
  if (!entry) return { success: false, error: 'Email not registered' };
  if (entry.verified) return { success: false, error: 'Email already verified' };

  const lockErr = checkCodeLockout(entry);
  if (lockErr) return { success: false, error: lockErr };

  if (Date.now() > entry.codeExpires) return { success: false, error: 'Verification code expired' };
  if (!verifyCode(code, entry.codeHash)) {
    recordCodeFailure(entry);
    return { success: false, error: 'Verification code incorrect' };
  }

  clearCodeFailures(entry);
  entry.verified = true;
  delete entry.codeHash;
  delete entry.codeExpires;
  await saveUsers(users);
  return { success: true };
}

// ============ Resend code ============
async function resendCode(email) {
  const users = await loadUsers();
  const entry = users[email];
  if (!entry) return { success: false, error: 'Email not registered' };
  if (entry.verified) return { success: false, error: 'Email already verified' };

  const code = generateCode();
  entry.codeHash = hashCode(code);
  entry.codeExpires = Date.now() + config.verification.codeTTL;
  clearCodeFailures(entry);
  await saveUsers(users);

  const sent = await sendVerificationEmail(email, code);
  logCode('Resend code', email, code);
  return { success: true, smtpSent: sent };
}

// ============ Login ============
async function login(email, password) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };
  if (!user.verified) return { success: false, error: 'Email not verified, please complete registration first' };
  if (!verifyPassword(password, user.passwordHash)) return { success: false, error: 'Incorrect password' };

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashed = hashToken(rawToken);
  const rawRefresh = crypto.randomBytes(32).toString('hex');
  const hashedRefresh = hashToken(rawRefresh);

  const tokens = await loadTokens();
  tokens[hashed] = { email, userId: user.id, username: user.username, createdAt: Date.now() };
  await saveTokens(tokens);

  const refreshTokens = await loadRefreshTokens();
  refreshTokens[hashedRefresh] = { email, userId: user.id, createdAt: Date.now() };
  await saveRefreshTokens(refreshTokens);

  return { success: true, token: rawToken, refreshToken: rawRefresh,
    user: { id: user.id, email, username: user.username, publicProfile: !!user.publicProfile, signature: user.signature || '' } };
}

// ============ Token validation ============
async function validateToken(token) {
  if (!token) return null;
  const hashed = hashToken(token);
  const tokens = await loadTokens();
  const entry = tokens[hashed];
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TOKEN_TTL) {
    delete tokens[hashed];
    await saveTokens(tokens);
    return null;
  }
  let publicProfile = false, avatar = null, signature = '';
  try {
    const users = await loadUsers();
    if (users[entry.email]) {
      publicProfile = !!users[entry.email].publicProfile;
      avatar = users[entry.email].avatar || null;
      signature = users[entry.email].signature || '';
    }
  } catch {}
  return { id: entry.userId, email: entry.email, username: entry.username, publicProfile, avatar, signature };
}

// ============ Logout ============
async function logout(token) {
  const tokens = await loadTokens();
  const hashedKey = hashToken(token);
  const entry = tokens[hashedKey];
  delete tokens[hashedKey];
  await saveTokens(tokens);
  // Also clean up all refresh tokens for this user
  if (entry && entry.email) {
    const refreshTokens = await loadRefreshTokens();
    let changed = false;
    for (const rid of Object.keys(refreshTokens)) {
      if (refreshTokens[rid].email === entry.email) {
        delete refreshTokens[rid];
        changed = true;
      }
    }
    if (changed) await saveRefreshTokens(refreshTokens);
  }
}

// ============ Public profile ============
async function setPublicProfile(email, enabled) {
  const users = await loadUsers();
  if (!users[email]) return { success: false, error: 'User not found' };
  users[email].publicProfile = !!enabled;
  await saveUsers(users);
  return { success: true, publicProfile: users[email].publicProfile };
}

// ============ Search public users ============
async function searchUsers(query) {
  if (!query || query.length < 1) return [];
  const users = await loadUsers();
  const q = query.toLowerCase();
  const results = [];
  for (const email of Object.keys(users)) {
    const u = users[email];
    if (u.verified && u.publicProfile && u.username.toLowerCase().includes(q)) {
      results.push({ id: u.id, username: u.username, avatar: u.avatar || null });
    }
  }
  return results;
}

async function getUserById(userId) {
  const users = await loadUsers();
  for (const email of Object.keys(users)) {
    const u = users[email];
    if (u.id === userId && u.verified && u.publicProfile) {
      return { id: u.id, username: u.username, avatar: u.avatar || null, background: u.background || null, signature: u.signature || '' };
    }
  }
  return null;
}

// ============ Operation verification code ============
async function sendOperationCode(email, operation) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };

  const code = generateCode();
  user.opCodeHash = hashCode(code);
  user.opCodeExpires = Date.now() + config.verification.codeTTL;
  user.opCodeScope = operation;
  clearCodeFailures(user);
  await saveUsers(users);

  const sent = await sendOperationEmail(email, code, operation);
  logCode(`${operation} code`, email, code);
  return { success: true, smtpSent: sent };
}

function _verifyOpCode(users, email, code, operation) {
  const user = users[email];
  if (!user) return { ok: false, error: 'User not found' };
  if (!user.opCodeHash || user.opCodeScope !== operation) return { ok: false, error: 'Please send verification code first' };

  const lockErr = checkCodeLockout(user);
  if (lockErr) return { ok: false, error: lockErr };

  if (Date.now() > user.opCodeExpires) return { ok: false, error: 'Verification code expired, please resend' };
  if (!verifyCode(code, user.opCodeHash)) {
    recordCodeFailure(user);
    return { ok: false, error: 'Verification code incorrect' };
  }
  clearCodeFailures(user);
  delete user.opCodeHash;
  delete user.opCodeExpires;
  delete user.opCodeScope;
  return { ok: true };
}

// ============ Change password ============
async function changePassword(email, code, newPassword) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { success: false, error: pwErr };

  const v = _verifyOpCode(users, email, code, 'changePassword');
  if (!v.ok) return { success: false, error: v.error };

  user.passwordHash = hashPassword(newPassword);
  await saveUsers(users);
  // Invalidate all refresh tokens for this user after password change
  const refreshTokens = await loadRefreshTokens();
  let changed = false;
  for (const rid of Object.keys(refreshTokens)) {
    if (refreshTokens[rid].email === email) {
      delete refreshTokens[rid];
      changed = true;
    }
  }
  if (changed) await saveRefreshTokens(refreshTokens);
  return { success: true };
}

// ============ Change username ============
async function changeUsername(email, newUsername) {
  if (!newUsername || newUsername.trim().length < 1) return { success: false, error: 'Username cannot be empty' };
  if (newUsername.trim().length > 20) return { success: false, error: 'Username cannot exceed 20 characters' };
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };
  const newName = newUsername.trim();
  user.username = newName;
  await saveUsers(users);

  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) tokens[tid].username = newName;
  }
  await saveTokens(tokens);
  return { success: true, username: newName };
}

// ============ Signature ============
async function setSignature(email, signature) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };
  const sig = (signature || '').trim().slice(0, 50);
  user.signature = sig;
  await saveUsers(users);

  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) {
    if (tokens[tid].email === email) tokens[tid].signature = sig;
  }
  await saveTokens(tokens);
  return { success: true, signature: sig };
}

// ============ Avatar ============
async function setAvatar(email, avatarBuffer) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };

  if (!fss.existsSync(AVATAR_DIR)) fss.mkdirSync(AVATAR_DIR, { recursive: true });
  if (user.avatar) {
    try { await fs.unlink(path.join(AVATAR_DIR, user.avatar)); } catch {}
  }

  const avatarName = `${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(AVATAR_DIR, avatarName), avatarBuffer);
  user.avatar = avatarName;
  await saveUsers(users);
  return { success: true, avatar: avatarName };
}

// ============ Delete account ============
async function deleteAccount(email, code) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };

  const v = _verifyOpCode(users, email, code, 'deleteAccount');
  if (!v.ok) return { success: false, error: v.error };

  // Clean up user data
  delete users[email];
  await saveUsers(users);

  // Remove all tokens
  await _clearUserTokens(email);

  // Remove files
  if (user.avatar) { try { await fs.unlink(path.join(AVATAR_DIR, user.avatar)); } catch {} }
  if (user.background) { try { await fs.unlink(path.join(BG_DIR, user.background)); } catch {} }
  try { await fs.unlink(_getBioPath(user.id)); } catch {}

  return { success: true };
}

async function _clearUserTokens(email) {
  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) { if (tokens[tid].email === email) delete tokens[tid]; }
  await saveTokens(tokens);
  const refreshTokens = await loadRefreshTokens();
  for (const rid of Object.keys(refreshTokens)) { if (refreshTokens[rid].email === email) delete refreshTokens[rid]; }
  await saveRefreshTokens(refreshTokens);
}

// ============ Reset password ============
async function sendResetCode(email) {
  const users = await loadUsers();
  const user = users[email];
  if (!user || !user.verified) {
    // Simulate processing delay to prevent timing-based user enumeration
    await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
    return { success: true, smtpSent: false };
  }

  const code = generateCode();
  user.opCodeHash = hashCode(code);
  user.opCodeExpires = Date.now() + config.verification.codeTTL;
  user.opCodeScope = 'resetPassword';
  clearCodeFailures(user);
  await saveUsers(users);

  const sent = await sendOperationEmail(email, code, 'resetPassword');
  logCode('resetPassword code', email, code);
  return { success: true, smtpSent: sent };
}

async function resetPassword(email, code, newPassword) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'Email not registered' };
  if (!user.verified) return { success: false, error: 'Email not verified' };
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { success: false, error: pwErr };

  const v = _verifyOpCode(users, email, code, 'resetPassword');
  if (!v.ok) return { success: false, error: v.error };

  user.passwordHash = hashPassword(newPassword);
  await saveUsers(users);
  await _clearUserTokens(email);
  return { success: true };
}

// ============ Profile bio (Markdown) ============
function _getBioPath(userId) { return path.join(PROFILE_DIR, `${userId}.md`); }

async function getProfileBio(userId) {
  try { return await fs.readFile(_getBioPath(userId), 'utf8'); } catch { return ''; }
}

async function saveProfileBio(userId, content) {
  if (!fss.existsSync(PROFILE_DIR)) fss.mkdirSync(PROFILE_DIR, { recursive: true });
  await fs.writeFile(_getBioPath(userId), content, 'utf8');
  return { success: true };
}

// ============ Background image ============
async function setProfileBackground(email, bgBuffer) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'User not found' };

  if (!fss.existsSync(BG_DIR)) fss.mkdirSync(BG_DIR, { recursive: true });
  if (user.background) { try { await fs.unlink(path.join(BG_DIR, user.background)); } catch {} }

  const bgName = `${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(BG_DIR, bgName), bgBuffer);
  user.background = bgName;
  await saveUsers(users);
  return { success: true, background: bgName };
}

async function getProfileBackground(userId) {
  const users = await loadUsers();
  if (!users) return null;
  for (const email of Object.keys(users)) {
    if (users[email].id === userId && users[email].background) return users[email].background;
  }
  return null;
}

// ============ Admin operations ============
async function adminDeleteUser(email) {
  const users = await loadUsers();
  const user = users[email];
  if (!user) return { success: false, error: 'Email not registered' };

  delete users[email];
  await saveUsers(users);
  await _clearUserTokens(email);

  if (user.avatar) { try { await fs.unlink(path.join(AVATAR_DIR, user.avatar)); } catch {} }
  if (user.background) { try { await fs.unlink(path.join(BG_DIR, user.background)); } catch {} }
  try { await fs.unlink(_getBioPath(user.id)); } catch {}

  return { success: true, username: user.username };
}

async function adminChangeEmail(oldEmail, newEmail) {
  if (!newEmail || !newEmail.includes('@')) return { success: false, error: 'Invalid email format' };
  const users = await loadUsers();
  const user = users[oldEmail];
  if (!user) return { success: false, error: 'Old email not registered' };
  if (users[newEmail] && users[newEmail].verified) return { success: false, error: 'New email already registered' };

  users[newEmail] = user;
  delete users[oldEmail];
  await saveUsers(users);

  const tokens = await loadTokens();
  for (const tid of Object.keys(tokens)) { if (tokens[tid].email === oldEmail) tokens[tid].email = newEmail; }
  await saveTokens(tokens);
  const refreshTokens = await loadRefreshTokens();
  for (const rid of Object.keys(refreshTokens)) { if (refreshTokens[rid].email === oldEmail) refreshTokens[rid].email = newEmail; }
  await saveRefreshTokens(refreshTokens);

  return { success: true, username: user.username, oldEmail, newEmail };
}

// ============ Refresh token ============
async function refreshToken(refreshToken) {
  if (!refreshToken) return null;
  const hashed = hashToken(refreshToken);
  const refreshTokens = await loadRefreshTokens();
  const entry = refreshTokens[hashed];
  if (!entry) return null;
  if (Date.now() - entry.createdAt > REFRESH_TTL) {
    delete refreshTokens[hashed];
    await saveRefreshTokens(refreshTokens);
    return null;
  }
  // 1. Delete old refresh token (rotation)
  delete refreshTokens[hashed];
  // 2. Generate new access token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokens = await loadTokens();
  tokens[hashToken(rawToken)] = { email: entry.email, userId: entry.userId, createdAt: Date.now() };
  // 3. Generate new refresh token
  const rawRefresh = crypto.randomBytes(32).toString('hex');
  refreshTokens[hashToken(rawRefresh)] = { email: entry.email, userId: entry.userId, createdAt: Date.now() };
  await saveTokens(tokens);
  await saveRefreshTokens(refreshTokens);
  return { token: rawToken, refreshToken: rawRefresh };
}

module.exports = { init, register, verify, login, logout, resendCode, validateToken, refreshToken, setPublicProfile, searchUsers, getUserById, sendOperationCode, changePassword, changeUsername, setSignature, setAvatar, deleteAccount, sendResetCode, resetPassword, getProfileBio, saveProfileBio, setProfileBackground, getProfileBackground, adminDeleteUser, adminChangeEmail, loadUsers };