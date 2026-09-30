import express from 'express';
import { dbHelpers } from '../db.js';
import { requireManager, requireSuperAdmin } from '../middleware/staffAuth.js';

const router = express.Router();

// GET /api/admin/departments — list all (manager+ can view)
router.get('/', requireManager, (req, res) => {
  try {
    const departments = dbHelpers.getDepartments();
    // Attach member count per department
    const result = departments.map((d) => {
      const members = dbHelpers.getUsersByDepartment(d.id);
      return { ...d, member_count: members.length };
    });
    res.json({ departments: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load departments', details: error.message });
  }
});

// POST /api/admin/departments — create (super_admin only)
router.post('/', requireSuperAdmin, (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required' });
    // Check duplicate name
    const existing = dbHelpers.getDepartments().find(d => d.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return res.status(409).json({ error: 'A department with this name already exists' });
    const dept = dbHelpers.addDepartment({ name: name.trim(), description: description || '' });
    res.json({ success: true, department: dept });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create department', details: error.message });
  }
});

// PUT /api/admin/departments/:id — update (super_admin only)
router.put('/:id', requireSuperAdmin, (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    const dept = dbHelpers.getDepartmentById(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;
    const updated = dbHelpers.updateDepartment(req.params.id, updates);

    // Cascade: disabling deactivates the dept's members (super_admins exempt so
    // they can re-enable the dept); their prior state is snapshotted in
    // dept_prev_active. Re-enabling restores only members that are still off
    // but were active before — individually reactivated members stay as-is.
    const members = dbHelpers.getUsersByDepartment(Number(req.params.id));
    if (is_active === false) {
      members.forEach((u) => {
        if (u.is_active !== false && u.role !== 'super_admin') {
          dbHelpers.updateUser(u.id, { is_active: false, dept_prev_active: true });
        }
      });
    } else if (is_active === true) {
      members.forEach((u) => {
        if (u.dept_prev_active === true) {
          const restore = u.is_active === false ? { is_active: true } : {};
          dbHelpers.updateUser(u.id, { ...restore, dept_prev_active: undefined });
        }
      });
    }

    res.json({ success: true, department: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update department', details: error.message });
  }
});

// DELETE /api/admin/departments/:id — delete (super_admin only)
router.delete('/:id', requireSuperAdmin, (req, res) => {
  try {
    const dept = dbHelpers.getDepartmentById(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    dbHelpers.deleteDepartment(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete department', details: error.message });
  }
});

export default router;
