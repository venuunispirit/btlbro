// Team management API — internal staff accounts with roles.
//
//   GET    /api/admin/team       → list team members
//   POST   /api/admin/team       → create member  { name, email, phone, designation, role, password }
//   PUT    /api/admin/team/:id   → update member  (any subset incl. password, role, is_active)
//   DELETE /api/admin/team/:id   → remove member  (super_admin only)
//
// Access: only super_admin (and manager for read). Members log in through the
// SAME /api/auth/login endpoint — no separate admin gate.

import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';
import { requireSuperAdmin, requireManager } from '../middleware/staffAuth.js';

const router = express.Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

const ROLES = ['member', 'manager', 'super_admin'];

function publicMember(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || '',
    designation: u.designation || '',
    role: u.role || 'member',
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

// POST /api/admin/team — super_admin only
router.post('/', requireSuperAdmin, (req, res) => {
  try {
    const { name, email, phone, designation, role, password } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (dbHelpers.getUserByEmail(String(email).toLowerCase())) {
      return res.status(409).json({ error: 'A member with this email already exists' });
    }

    const { salt, hash } = hashPassword(password);
    const user = dbHelpers.addUser({
      name, email,
      password_salt: salt, password_hash: hash,
      phone: phone || '', designation: designation || '',
      role: role || 'member', is_team: true,
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