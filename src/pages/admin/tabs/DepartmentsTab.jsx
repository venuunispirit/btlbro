import React, { useState, useEffect } from 'react';
import { Layers, Plus, Edit3, Trash2, X, Eye } from 'lucide-react';
import { getDepartments, createDepartment, updateDepartment, deleteDepartment, getStaffUser, getTeam } from '../api.js';
import MemberFormModal, { ROLES } from './MemberFormModal.jsx';
import { useFeedback } from '../components/Feedback.jsx';
import { EmptyState } from '../theme.js';

export default function DepartmentsTab() {
  const { toast, notify, confirm } = useFeedback();
  const [departments, setDepartments] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewDeptId, setViewDeptId] = useState(null); // members-table modal
  const [editingMember, setEditingMember] = useState(null); // member id for MemberFormModal
  const currentUser = getStaffUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  useEffect(() => { load(); loadTeam(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await getDepartments();
      setDepartments(res.departments || []);
    } catch {}
    setLoading(false);
  }

  async function loadTeam() {
    try {
      const res = await getTeam();
      setTeam(res.members || []);
    } catch {}
  }

  const viewDept = departments.find(d => d.id === viewDeptId);
  // Compare numerically. A member whose department_id is the string '2' (which
  // the Team <select> used to send and the server used to store verbatim) failed
  // a strict === against the numeric department id and disappeared from this
  // list entirely. The server now coerces on write; this keeps the read honest
  // for any row written before that.
  const inDept = (m, deptId) =>
    m.department_id != null && m.department_id !== '' && Number(m.department_id) === Number(deptId);
  const deptMembers = team.filter((m) => inDept(m, viewDeptId));
  const memberCount = (d) => team.filter((m) => inDept(m, d.id)).length;

  function startEdit(dept) {
    if (dept) {
      setEditing(dept.id);
      setForm({ name: dept.name, description: dept.description || '' });
    } else {
      setEditing('new');
      setForm({ name: '', description: '' });
    }
    setError('');
    setShowForm(true);
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      if (editing === 'new') {
        const res = await createDepartment(form);
        setDepartments(prev => [...prev, res.department]);
      } else {
        const res = await updateDepartment(editing, form);
        setDepartments(prev => prev.map(d => d.id === editing ? res.department : d));
      }
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handleDelete(dept) {
    const count = memberCount(dept);
    if (count > 0) {
      notify(`"${dept.name}" still has ${count} member${count === 1 ? '' : 's'} assigned. Move them to another department first.`);
      return;
    }
    const ok = await confirm({
      title: `Delete "${dept.name}"?`,
      body: 'The department disappears from every list. Members are not affected because none are assigned.',
      confirmLabel: 'Delete department',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDepartment(dept.id);
      setDepartments(prev => prev.filter(d => d.id !== dept.id));
      if (viewDeptId === dept.id) setViewDeptId(null);
      toast(`"${dept.name}" deleted`);
    } catch (err) { notify(err.message); }
  }

  async function handleToggleActive(dept) {
    const turningOff = dept.is_active !== false;
    if (turningOff) {
      const count = memberCount(dept);
      const ok = await confirm({
        title: `Disable "${dept.name}"?`,
        body: count > 0
          ? `Its ${count} member${count === 1 ? '' : 's'} will be signed out and blocked from signing back in until the department is re-enabled.`
          : 'Nobody is assigned to this department, so only the department itself is affected.',
        confirmLabel: 'Disable department',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await updateDepartment(dept.id, { is_active: dept.is_active === false });
      setDepartments(prev => prev.map(d => d.id === dept.id ? res.department : d));
      loadTeam(); // cascade flips member statuses server-side — refresh them
      toast(`"${dept.name}" ${turningOff ? 'disabled' : 'enabled'}`);
    } catch (err) { notify(err.message); }
  }

  function onMemberSaved(updated) {
    setTeam(prev => prev.map(m => m.id === updated.id ? updated : m));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Departments</h3>
          <p style={{ margin: '4px 0 0', color: '#949494', fontSize: 13 }}>{departments.length} departments · Organize your team</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => startEdit(null)} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', background: '#F2701D',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}><Plus size={16} /> Add Department</button>
        )}
      </div>

      {/* Department cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading departments…</div>
      ) : departments.length === 0 ? (
        <EmptyState
          icon={<Layers size={30} color="#C9C2B4" />}
          title="No departments yet"
          hint="Create departments to organise your team — BD, Operations, Recee and so on. Members are assigned a department from the Team tab."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(430px, 100%), 1fr))', gap: 16 }}>
          {departments.map(d => {
            const active = d.is_active !== false;
            const count = memberCount(d);
            return (
              <div key={d.id} onClick={() => setViewDeptId(d.id)} style={{
                position: 'relative', background: '#fff', borderRadius: 16,
                border: '2px solid #F2701D', padding: '22px 24px',
                overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                cursor: 'pointer',
              }}>
                {/* Corner ribbon — green = active, red = inactive */}
                <div style={{ position: 'absolute', top: 0, right: 0, width: 110, height: 110, overflow: 'hidden', pointerEvents: 'none' }}>
                  <div style={{
                    position: 'absolute', top: 15, right: -100, width: 160, height: 36,
                    transform: 'rotate(45deg)',
                    background: active ? '#10B981' : '#DC2626',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                  }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 18, paddingRight: 36 }}>
                  {/* Icon */}
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', background: '#F2701D',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}><Layers size={30} /></div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: '#161616' }}>{d.name}</div>
                    <div style={{ fontSize: 14, color: '#949494', marginTop: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.description || 'No description added'}
                    </div>
                    <div style={{ fontSize: 14, color: '#B8AFA6', marginTop: 5, fontStyle: 'italic' }}>
                      {count} member{count === 1 ? '' : 's'}
                    </div>
                  </div>

                  {/* Controls — all four controls share one 48px box so the
                      icon column, switch and delete stay on one axis. */}
                  {isSuperAdmin && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); setViewDeptId(d.id); }} title="View members" style={{
                        width: 48, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#F2701D', padding: 0,
                      }}><Eye size={22} /></button>
                      <button onClick={e => { e.stopPropagation(); startEdit(d); }} title="Edit department" style={{
                        width: 48, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#F2701D', padding: 0,
                      }}><Edit3 size={20} /></button>
                      <button
                        onClick={e => { e.stopPropagation(); handleToggleActive(d); }}
                        title={active ? 'Deactivate' : 'Reactivate'}
                        role="switch"
                        aria-checked={active}
                        style={{
                          width: 48, height: 26, borderRadius: 999,
                          background: active ? '#F2701D' : '#E7E2D8',
                          border: 'none', cursor: 'pointer', position: 'relative', padding: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 3, left: active ? 25 : 3,
                          width: 20, height: 20, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.2s ease', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                        }} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(d); }} title="Delete department" style={{
                        width: 48, height: 19, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 0,
                      }}><Trash2 size={19} /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Department members modal (table) */}
      {viewDept && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setViewDeptId(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, padding: 28, width: 720, maxWidth: '94vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '86vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: '#F2701D',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><Layers size={20} /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{viewDept.name}</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#949494' }}>
                    {deptMembers.length} member{deptMembers.length === 1 ? '' : 's'}
                    {isSuperAdmin && ' · Click a member to edit'}
                  </p>
                </div>
              </div>
              <button onClick={() => setViewDeptId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#949494' }}><X size={18} /></button>
            </div>

            {viewDept.is_active === false && (
              <div style={{ padding: '9px 14px', borderRadius: 8, background: '#FEF3C7', color: '#B45309', fontSize: 12.5, marginBottom: 14 }}>
                This department is disabled — its members are deactivated and cannot sign in. If required, activate individuals from the Team tab; re-enabling restores the rest automatically.
              </div>
            )}

            {deptMembers.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#949494', background: '#FAF9F7', borderRadius: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>No members in this department</p>
                <p style={{ fontSize: 12.5, margin: '6px 0 0' }}>Assign members from the Team tab (Department field).</p>
              </div>
            ) : (
              <div className="scroll-x">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FAF9F7' }}>
                    {['Member', 'Email', 'Role', 'Status'].map(h => (
                      <th key={h} style={{
                        fontSize: 12, fontWeight: 600, color: '#949494', textAlign: 'left',
                        padding: '10px 14px', borderBottom: '1px solid #E7E2D8',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptMembers.map(m => {
                    const roleMeta = ROLES.find(r => r.value === m.role) || ROLES[0];
                    const active = m.is_active !== false;
                    return (
                      <tr key={m.id}
                        onClick={() => isSuperAdmin && setEditingMember(m.id)}
                        style={{ cursor: isSuperAdmin ? 'pointer' : 'default' }}
                        onMouseEnter={e => { if (isSuperAdmin) e.currentTarget.style.background = '#FAF9F7'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                      >
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F3F0EA' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: '50%', background: '#F2701D',
                              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 800, fontSize: 14, flexShrink: 0,
                            }}>{m.name?.charAt(0)?.toUpperCase() || '?'}</div>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: '#161616' }}>{m.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F3F0EA', fontSize: 13, color: '#4A4A4A' }}>{m.email}</td>
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F3F0EA' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                            background: roleMeta.color + '18', color: roleMeta.color, whiteSpace: 'nowrap',
                          }}>{roleMeta.label}</span>
                        </td>
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid #F3F0EA' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                            background: active ? '#ECFDF5' : '#FEF2F2', color: active ? '#059669' : '#DC2626',
                          }}>{active ? 'Active' : 'Inactive'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Member edit modal — opens over the members table; cancel/update returns to it */}
      {editingMember !== null && viewDept && (
        <MemberFormModal
          editing={editingMember}
          member={team.find(m => m.id === editingMember)}
          departments={departments}
          onClose={() => setEditingMember(null)}
          onSaved={onMemberSaved}
        />
      )}

      {/* Department create/edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, padding: 22, width: 380, maxWidth: '92vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editing === 'new' ? 'Add Department' : 'Edit Department'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#949494' }}><X size={18} /></button>
            </div>
            {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Business Development, Operations, Recee"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What does this department do?"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, minHeight: 80, boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 11, borderRadius: 8, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 11, borderRadius: 8, border: 'none', background: saving ? '#E7E2D8' : '#F2701D', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Saving…' : editing === 'new' ? 'Create' : 'Update'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
