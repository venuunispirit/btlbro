// Staff authentication for the admin panel.
//
// Unlike the legacy `adminAuth` (production-only bearer header), this validates
// a REAL session created via POST /api/auth/login — so team members log in
// through the same "Sign In" button as customers and get role-scoped access.
//
//   requireStaff         → any staff user (team member) may pass
//   requireManager       → role in ['super_admin', 'manager']
//   requireSuperAdmin    → role === 'super_admin'
//   requireHuman         → staff for writes, but public reads stay open
//
// Roles: super_admin (everything) > manager (assign/create orders, content) >
// member (only their assigned orders). Helpers attach req.user + req.staff.

import { dbHelpers } from '../db.js';

const ROLE_LEVEL = { member: 0, manager: 1, super_admin: 2 };

function resolveSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && dbHelpers.getSession(token);
  if (!session) return null;
  const user = dbHelpers.getUserById(session.user_id);
  if (!user || !user.is_team) return null;
  if (user.is_active === false) return null;
  return { user, token };
}

export function requireStaff(req, res, next) {
  const resolved = resolveSession(req);
  if (!resolved) return res.status(401).json({ error: 'Staff sign-in required' });
  req.user = resolved.user;
  req.staff = resolved.user;
  req.sessionToken = resolved.token;
  next();
}

export function requireManager(req, res, next) {
  const resolved = resolveSession(req);
  if (!resolved) return res.status(401).json({ error: 'Staff sign-in required' });
  if ((ROLE_LEVEL[resolved.user.role] || 0) < ROLE_LEVEL.manager) {
    return res.status(403).json({ error: 'Manager or Super Admin access required' });
  }
  req.user = resolved.user;
  req.staff = resolved.user;
  req.sessionToken = resolved.token;
  next();
}

export function requireSuperAdmin(req, res, next) {
  const resolved = resolveSession(req);
  if (!resolved) return res.status(401).json({ error: 'Staff sign-in required' });
  if (resolved.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  req.user = resolved.user;
  req.staff = resolved.user;
  req.sessionToken = resolved.token;
  next();
}

export function roleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

// Shared: any logged-in staff, or if not logged in it passes with role 'guest'
// so public-but-safe reads can stay lenient. Only used where data shape is
// safe for public exposure (order lists for the admin grid are NOT here).
export function optionalStaff(req, res, next) {
  const resolved = resolveSession(req);
  req.staff = resolved ? resolved.user : null;
  req.sessionToken = resolved ? resolved.token : null;
  next();
}