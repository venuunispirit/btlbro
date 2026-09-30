// Team management API — internal staff accounts with roles.
//
//   GET    /api/admin/team          → list team members
//   GET    /api/admin/team/:id/password → reveal password (super_admin only)
//   POST   /api/admin/team          → create member  { name, email, phone, designation, role, password }
//   PUT    /api/admin/team/:id      → update member  (any subset incl. password, role, is_active)
//   DELETE /api/admin/team/:id      → remove member  (super_admin only)
//
// Access: only super_admin (and manager for read). Members log in through the
// SAME /api/auth/login endpoint — no separate admin gate.
//
// Passwords are stored twice: a scrypt hash login verifies against, and an
// AES-256-GCM vault copy (services/passwordVault.js) so the super admin can
// SHOW a member their password instead of resetting it.

import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';
import { requireSuperAdmin, requireManager } from '../middleware/staffAuth.js';
import { encryptPassword, decryptPassword } from '../services/passwordVault.js';

const router = express.Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

const ROLES = ['member', 'bd_executive', 'ops_executive', 'manager', 'bdm', 'ops_manager', 'super_admin', 'recee', 'recee_manager'];

// A <select> hands back a string, and that string used to be stored verbatim:
// department_id '2' instead of 2. Everything that later reads it does a strict
// === against a numeric id — the Departments members table, and the
// getUsersByDepartment cascade that deactivates a disabled department's staff —
// so a string id made the member vanish from the department AND escape the
// disable cascade. Coerce once, here, where the bad value enters.
function coerceDepartmentId(v) {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '' || v === 'null') return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return { error: 'Department must be a real department' };
  // A member pointed at a department that does not exist would simply never
  // appear in any department's member list — another silent disappearance.
  // Refuse it loudly instead.
  if (!dbHelpers.getDepartmentById(n)) return { error: 'That department no longer exists' };
  return { value: n };
}

function publicMember(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || '',
    designation: u.designation || '',
    role: u.role || 'member',
    device_number: u.device_number || '',
    // Read-side guard: even a legacy string row comes back as a number.
    department_id: u.department_id == null || u.department_id === '' ? null : Number(u.department_id) || null,
    locations: u.locations || '',
    is_active: u.is_active !== false,
    created_at: u.created_at,
  };
}

// GET /api/admin/team — managers + super admins can view
router.get('/', requireManager, (req, res) => {
  try {
    const members = dbHelpers.getTeamMembers().map(publicMember);
    res.json({ members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load team', details: error.message });
  }
});

// GET /api/admin/team/:id/password — super_admin only.
// The vault copy is never part of the list payload (publicMember strips it);
// it leaves the server only through this deliberate endpoint, and only to a
// super admin. `password` is null when the row predates vault storage or the
// vault key rotated — the client then shows "reset instead".
router.get('/:id/password', requireSuperAdmin, (req, res) => {
  try {
    const user = dbHelpers.getUserById(Number(req.params.id));
    if (!user || !user.is_team) return res.status(404).json({ error: 'Member not found' });
    const password = decryptPassword(user.password_enc);
    // Audit breadcrumb: reveals should be traceable in the server log.
    console.log(`[team] password reveal #${user.id} ${user.email} → ${password ? 'ok' : 'unavailable'} (by ${req.staff.email})`);
    res.json({ password });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read password', details: error.message });
  }
});

// POST /api/admin/team — super_admin only
router.post('/', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, phone, designation, role, password, device_number, department_id, locations } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (dbHelpers.getUserByEmail(String(email).toLowerCase())) {
      return res.status(409).json({ error: 'A member with this email already exists' });
    }

    const deptParsed = coerceDepartmentId(department_id);
    if (deptParsed.error) return res.status(400).json({ error: deptParsed.error });

    const { salt, hash } = hashPassword(password);
    const user = dbHelpers.addUser({
      name, email,
      password_salt: salt, password_hash: hash,
      password_enc: encryptPassword(password),
      phone: phone || '', designation: designation || '',
      role: role || 'member', is_team: true, device_number: device_number || '',
      department_id: deptParsed.value ?? null,
      locations: locations || '',
    });
    res.json({ success: true, member: publicMember(user) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create member', details: error.message });
  }
});

// PUT /api/admin/team/:id — super_admin only
router.put('/:id', requireSuperAdmin, (req, res) => {
  try {
    const updates = req.body || {};
    const user = dbHelpers.getUserById(Number(req.params.id));
    if (!user || !user.is_team) return res.status(404).json({ error: 'Member not found' });

    const clean = {};
    if (typeof updates.name === 'string' && updates.name.trim()) clean.name = updates.name.trim();
    if (typeof updates.phone === 'string') clean.phone = updates.phone;
    if (typeof updates.designation === 'string') clean.designation = updates.designation;
    if (typeof updates.device_number === 'string') clean.device_number = updates.device_number;
    if (typeof updates.locations === 'string') clean.locations = updates.locations;
    if (updates.department_id !== undefined) {
      const parsed = coerceDepartmentId(updates.department_id);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      clean.department_id = parsed.value;
    }
    if (updates.role && ROLES.includes(updates.role)) clean.role = updates.role;
    if (typeof updates.is_active === 'boolean') clean.is_active = updates.is_active;
    if (updates.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
      const existing = dbHelpers.getUserByEmail(String(updates.email).toLowerCase());
      if (existing && existing.id !== user.id) return res.status(409).json({ error: 'Email already in use' });
      clean.email = String(updates.email).toLowerCase();
    }
    if (updates.password && String(updates.password).length >= 6) {
      const { salt, hash } = hashPassword(updates.password);
      clean.password_salt = salt;
      clean.password_hash = hash;
      clean.password_enc = encryptPassword(updates.password);
    }

    // Prevent the last super_admin from being demoted/deactivated
    if (user.role === 'super_admin' && ((clean.role && clean.role !== 'super_admin') || clean.is_active === false)) {
      const superAdmins = dbHelpers.getTeamMembers().filter((m) => m.role === 'super_admin');
      if (superAdmins.length <= 1) return res.status(400).json({ error: 'Cannot remove the last Super Admin' });
    }

    const updated = dbHelpers.updateUser(Number(req.params.id), clean);
    res.json({ success: true, member: publicMember(updated) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update member', details: error.message });
  }
});

// DELETE /api/admin/team/:id — super_admin only, protects last super admin
router.delete('/:id', requireSuperAdmin, (req, res) => {
  try {
    const user = dbHelpers.getUserById(Number(req.params.id));
    if (!user || !user.is_team) return res.status(404).json({ error: 'Member not found' });
    if (user.role === 'super_admin') {
      const superAdmins = dbHelpers.getTeamMembers().filter((m) => m.role === 'super_admin');
      if (superAdmins.length <= 1) return res.status(400).json({ error: 'Cannot delete the last Super Admin' });
    }
    dbHelpers.updateUser(Number(req.params.id), { is_active: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete member', details: error.message });
  }
});

export default router;