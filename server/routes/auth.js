// ============================================================
// Customer authentication for the Products shop.
//   POST /api/auth/register  { name, email, password }
//   POST /api/auth/login     { email, password }
//   POST /api/auth/logout
//   GET  /api/auth/me        → current user (via session token)
//
// Separate from the admin panel (admin login stays hardcoded as before).
// Passwords: node crypto scrypt with per-user salt. Sessions: random token
// stored in db.json + `Authorization: Bearer <token>` from the browser
// (localStorage) — simple, dependency-free, good enough for this scale.
// ============================================================

import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';

const router = express.Router();

// ---- helpers ----
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenExpiry() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
}

// Middleware: require a valid session → attaches req.user
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && dbHelpers.getSession(token);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const user = dbHelpers.getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  req.user = user;
  req.sessionToken = token;
  next();
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, created_at: u.created_at,
    is_team: !!u.is_team,
    role: u.role || (u.is_team ? 'member' : 'customer'),
    designation: u.designation || '',
    phone: u.phone || '',
    is_active: u.is_active !== false,
  };
}

// ---- routes ----
router.post('/register', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (dbHelpers.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });

    if (/@btlbro/.test(email)) return res.status(409).json({ error: 'That email is reserved for staff accounts.' });

    const { salt, hash } = hashPassword(password);
    const user = dbHelpers.addUser({ name, email, password_salt: salt, password_hash: hash });
    const token = newToken();
    dbHelpers.addSession({ token, user_id: user.id, expires_at: tokenExpiry() });
    res.json({ user: publicUser(user), token });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = dbHelpers.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.is_team && user.is_active === false) {
      return res.status(403).json({ error: 'This staff account is deactivated. Contact the manager.' });
    }
    const token = newToken();
    dbHelpers.addSession({ token, user_id: user.id, expires_at: tokenExpiry() });
    res.json({ user: publicUser(user), token });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  dbHelpers.deleteSession(req.sessionToken);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
