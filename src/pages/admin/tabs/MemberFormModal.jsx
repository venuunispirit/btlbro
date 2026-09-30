import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { createMember, updateMember, api } from '../api.js';

export const ROLES = [
  { value: 'member', label: 'Member', color: '#F2701D', desc: 'Can view assigned orders only' },
  { value: 'recee', label: 'Recee / Site Survey', color: '#0D9488', desc: 'Captures site surveys (photos + auto location) — routed to its own screen' },
  { value: 'recee_manager', label: 'Recee Manager', color: '#0F766E', desc: 'Creates & assigns recee requests to the recee team' },
  { value: 'bd_executive', label: 'BD Executive', color: '#2563EB', desc: 'Follows up & qualifies leads assigned by BDM' },
  { value: 'ops_executive', label: 'Ops Executive', color: '#7C3AED', desc: 'Executes orders & lead campaigns assigned by Ops Manager' },
  { value: 'manager', label: 'Manager', color: '#8A2BE2', desc: 'Can manage orders, products, content' },
  { value: 'bdm', label: 'BDM', color: '#059669', desc: 'Receives tool leads → assigns BD Executives' },
  { value: 'ops_manager', label: 'Ops Manager', color: '#D97706', desc: 'Receives qualified leads + product orders → assigns Ops Executives' },
  { value: 'super_admin', label: 'Super Admin', color: '#161616', desc: 'Full access, manage team & settings' },
];

const EMPTY = { name: '', email: '', phone: '', designation: '', role: 'member', password: '', device_number: '', department_id: '', locations: '' };

export default function MemberFormModal({ editing, member, departments, onClose, onSaved }) {
  const isNew = editing === 'new';
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  // The member's actual current password, decrypted server-side. null when
  // this account predates recoverable storage (then: reset, not reveal).
  const [currentPassword, setCurrentPassword] = useState(null);

  useEffect(() => {
    if (member) {
      setForm({
        name: member.name, email: member.email, phone: member.phone || '',
        designation: member.designation || '', role: member.role, password: '',
        device_number: member.device_number || '', department_id: member.department_id || '',
        locations: member.locations || '',
      });
    } else {
      setForm(EMPTY);
    }
    setCurrentPassword(null);
    setError('');
    setShowPass(false);

    // Pull the recoverable password so the field opens prefilled — the eye
    // then reveals it. Never overwrites a value the admin already started
    // typing (fetch can resolve after their first keystroke).
    let cancelled = false;
    if (member) {
      api(`/api/admin/team/${member.id}/password`)
        .then((d) => {
          if (cancelled) return;
          const pw = typeof d?.password === 'string' && d.password ? d.password : null;
          setCurrentPassword(pw);
          if (pw) setForm((prev) => (prev.password === '' ? { ...prev, password: pw } : prev));
        })
        .catch(() => { if (!cancelled) setCurrentPassword(null); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      if (isNew) {
        if (!form.password || form.password.length < 6) {
          setError('Password must be at least 6 characters');
          setSaving(false);
          return;
        }
        const res = await createMember(form);
        onSaved(res.member, true);
      } else {
        const payload = { ...form };
        // Blank = keep current; unchanged from the prefilled current password
        // = keep current (no pointless salt churn on every save).
        if (!payload.password || payload.password === currentPassword) delete payload.password;
        const res = await updateMember(editing, payload);
        onSaved(res.member, false);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 780, maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isNew ? 'Add Team Member' : 'Edit Member'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#949494' }}><X size={18} /></button>
        </div>

        {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}

        <div style={{ maxHeight: '74vh', overflowY: 'auto', paddingRight: 4 }}>
          {/* Basic details — two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { name: 'name', label: 'Full Name', required: true },
              { name: 'email', label: 'Email', required: true, type: 'email' },
              { name: 'phone', label: 'Phone' },
              { name: 'designation', label: 'Designation' },
              { name: 'device_number', label: 'Device Number (for calls)', type: 'tel' },
              { name: 'department_id', label: 'Department', select: true },
            ].map(f => (
              <div key={f.name}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>{f.label}{f.required && ' *'}</label>
                {f.select ? (
                  <select
                    value={form.department_id}
                    onChange={e => setForm(prev => ({ ...prev, department_id: e.target.value || '' }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box' }}
                  >
                    <option value="">No department</option>
                    {departments.filter(d => d.is_active !== false).map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type || 'text'}
                    value={form[f.name]}
                    onChange={e => setForm(prev => ({ ...prev, [f.name]: e.target.value }))}
                    required={f.required}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box' }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Areas / Locations — full width */}
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>
              Areas / Locations covered
            </label>
            <input
              type="text"
              value={form.locations}
              onChange={e => setForm(prev => ({ ...prev, locations: e.target.value }))}
              placeholder="e.g. Koramangala, Indiranagar, Marathahalli, HSR Layout"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box' }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#949494' }}>Used to suggest nearby recee assignments for location rows.</p>
          </div>

          {/* Role — grid of cards */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 8 }}>Role *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ROLES.map(r => (
                <button key={r.value} onClick={() => setForm(prev => ({ ...prev, role: r.value }))} style={{
                  padding: '10px 12px', borderRadius: 10, border: '2px solid',
                  borderColor: form.role === r.value ? r.color : '#E7E2D8',
                  background: form.role === r.value ? r.color + '10' : '#FAF9F7',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: form.role === r.value ? r.color : '#161616' }}>{r.label}</span>
                  </div>
                  <div style={{ color: '#949494', fontSize: 11, marginTop: 3 }}>{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Password — opens prefilled with the recoverable current password
              (super admin can reveal it with the eye). Type a different one
              to reset. Hash-only legacy accounts show as empty + explained. */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>
              Password {isNew && '*'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                required={isNew}
                placeholder={isNew ? 'Min 6 characters' : 'Leave blank to keep current password'}
                autoComplete="new-password"
                style={{ width: '100%', padding: '10px 40px 10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                disabled={!form.password}
                title={form.password ? (showPass ? 'Hide password' : 'Show password') : 'Nothing to show — type a new password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', padding: 0, lineHeight: 0,
                  cursor: form.password ? 'pointer' : 'not-allowed',
                  color: form.password ? '#949494' : '#D9D3C8',
                  transition: 'color 120ms ease',
                }}
              >{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
            {!isNew && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: currentPassword ? '#949494' : '#B45309' }}>
                {currentPassword
                  ? 'This is their current password — click the eye to reveal. Saving with it unchanged keeps it; typing a new one resets it.'
                  : "This account's password predates recoverable storage, so it can't be shown. Type a new password to reset it (min 6 characters)."}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 11, borderRadius: 8, border: '1px solid #E7E2D8',
            background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 1, padding: 11, borderRadius: 8, border: 'none',
            background: saving ? '#E7E2D8' : '#F2701D', color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{saving ? 'Saving…' : isNew ? 'Create Member' : 'Update'}</button>
        </div>
      </div>
    </div>
  );
}
