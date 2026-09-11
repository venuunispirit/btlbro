import React, { useState, useEffect } from 'react';
import { Users, Plus, Edit3, Trash2, Shield, Eye, EyeOff, X } from 'lucide-react';
import { getTeam, createMember, updateMember, deleteMember, getStaffUser } from '../api.js';

const ROLES = [
  { value: 'member', label: 'Member', color: '#F2701D', desc: 'Can view assigned orders only' },
  { value: 'manager', label: 'Manager', color: '#8A2BE2', desc: 'Can manage orders, products, content' },
  { value: 'super_admin', label: 'Super Admin', color: '#111', desc: 'Full access, manage team & settings' },
];

export default function TeamTab() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, number = edit id
  const [form, setForm] = useState({ name: '', email: '', phone: '', designation: '', role: 'member', password: '' });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const currentUser = getStaffUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  useEffect(() => { loadTeam(); }, []);

  async function loadTeam() {
    setLoading(true);
    try {
      const res = await getTeam();
      setMembers(res.members || []);
    } catch (e) {
      console.error('Failed to load team:', e);
    }
    setLoading(false);
  }

  function startEdit(member) {
    if (member) {
      setEditing(member.id);
      setForm({ name: member.name, email: member.email, phone: member.phone || '', designation: member.designation || '', role: member.role, password: '' });
    } else {
      setEditing('new');
      setForm({ name: '', email: '', phone: '', designation: '', role: 'member', password: '' });
    }
    setError('');
    setShowForm(true);
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      if (editing === 'new') {
        if (!form.password || form.password.length < 6) {
          setError('Password must be at least 6 characters');
          setSaving(false);
          return;
        }
        const res = await createMember(form);
        setMembers(prev => [res.member, ...prev]);
      } else {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        const res = await updateMember(editing, payload);
        setMembers(prev => prev.map(m => m.id === editing ? res.member : m));
      }
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handleDeactivate(member) {
    if (member.role === 'super_admin') {
      const superAdmins = members.filter(m => m.role === 'super_admin');
      if (superAdmins.length <= 1) {
        alert('Cannot deactivate the last Super Admin');
        return;
      }
    }
    const action = member.is_active ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${action} ${member.name}?`)) return;
    try {
      const res = await updateMember(member.id, { is_active: !member.is_active });
      setMembers(prev => prev.map(m => m.id === member.id ? res.member : m));
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(member) {
    if (member.role === 'super_admin') {
      const superAdmins = members.filter(m => m.role === 'super_admin');
      if (superAdmins.length <= 1) {
        alert('Cannot delete the last Super Admin');
        return;
      }
    }
    if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return;
    try {
      await deleteMember(member.id);
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Team Members</h3>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: 13 }}>{members.length} members · Role-based access</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => startEdit(null)} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', background: '#F2701D',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}><Plus size={16} /> Add Member</button>
        )}
      </div>

      {/* Members grid */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading team…</div>
      ) : members.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#999', background: '#fff', borderRadius: 14 }}>
          <Users size={40} style={{ color: '#DDD', marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>No team members yet</p>
          <p style={{ fontSize: 13 }}>Click "Add Member" to invite your first team member</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {members.map(m => {
            const roleMeta = ROLES.find(r => r.value === m.role) || ROLES[0];
            return (
              <div key={m.id} style={{
                background: '#fff', borderRadius: 14, padding: 20,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0',
                opacity: m.is_active === false ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 50,
                    background: roleMeta.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 16, flexShrink: 0,
                  }}>{m.name?.charAt(0)?.toUpperCase() || '?'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name}
                      {m.id === currentUser?.id && <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>(You)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>{m.email}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                    background: roleMeta.color + '18', color: roleMeta.color,
                    textTransform: 'capitalize',
                  }}>{roleMeta.label}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                    background: m.is_active !== false ? '#ECFDF5' : '#FEF2F2',
                    color: m.is_active !== false ? '#059669' : '#DC2626',
                  }}>{m.is_active !== false ? 'Active' : 'Inactive'}</span>
                </div>

                {m.designation && (
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{m.designation}</div>
                )}
                {m.phone && (
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>📞 {m.phone}</div>
                )}

                {isSuperAdmin && (
                  <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #F0F0F0', paddingTop: 12 }}>
                    <button onClick={() => startEdit(m)} style={{
                      flex: 1, padding: 7, borderRadius: 6, border: '1px solid #E0E0E0',
                      background: '#fff', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}><Edit3 size={12} /> Edit</button>
                    <button onClick={() => handleDeactivate(m)} style={{
                      padding: 7, borderRadius: 6, border: '1px solid #E0E0E0',
                      background: '#fff', fontSize: 12, cursor: 'pointer',
                    }}>{m.is_active !== false ? 'Deactivate' : 'Reactivate'}</button>
                    <button onClick={() => handleDelete(m)} style={{
                      padding: 7, borderRadius: 6, border: '1px solid #FECACA',
                      background: '#FEF2F2', color: '#DC2626', fontSize: 12, cursor: 'pointer',
                    }}><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal form */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, padding: 28, width: 440, maxWidth: '92vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editing === 'new' ? 'Add Team Member' : 'Edit Member'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
            </div>

            {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { name: 'name', label: 'Full Name', required: true },
                { name: 'email', label: 'Email', required: true, type: 'email' },
                { name: 'phone', label: 'Phone' },
                { name: 'designation', label: 'Designation' },
              ].map(f => (
                <div key={f.name}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>{f.label}{f.required && ' *'}</label>
                  <input
                    type={f.type || 'text'}
                    value={form[f.name]}
                    onChange={e => setForm(prev => ({ ...prev, [f.name]: e.target.value }))}
                    required={f.required}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
              ))}

              {/* Role */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>Role *</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {ROLES.map(r => (
                    <button key={r.value} onClick={() => setForm(prev => ({ ...prev, role: r.value }))} style={{
                      flex: 1, padding: '10px 8px', borderRadius: 8, border: '2px solid',
                      borderColor: form.role === r.value ? r.color : '#E0E0E0',
                      background: form.role === r.value ? r.color + '10' : '#fff',
                      cursor: 'pointer', textAlign: 'center', fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 600, color: form.role === r.value ? r.color : '#555' }}>{r.label}</div>
                      <div style={{ color: '#999', fontSize: 10, marginTop: 2 }}>{r.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
                  Password {editing === 'new' ? '*' : '(leave blank to keep current)'}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                    required={editing === 'new'}
                    placeholder={editing === 'new' ? 'Min 6 characters' : '••••••••'}
                    style={{ width: '100%', padding: '10px 40px 10px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, boxSizing: 'border-box' }}
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#999',
                  }}>{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowForm(false)} style={{
                flex: 1, padding: 11, borderRadius: 8, border: '1px solid #E0E0E0',
                background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{
                flex: 1, padding: 11, borderRadius: 8, border: 'none',
                background: saving ? '#CCC' : '#F2701D', color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{saving ? 'Saving…' : editing === 'new' ? 'Create Member' : 'Update'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
