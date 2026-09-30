import React, { useState, useEffect } from 'react';
import { useFeedback } from '../components/Feedback.jsx';
import { Users, Plus, Edit3, Trash2, Eye, X } from 'lucide-react';
import { getTeam, updateMember, deleteMember, getStaffUser, getDepartments } from '../api.js';
import MemberFormModal, { ROLES } from './MemberFormModal.jsx';

export default function TeamTab() {
  const { toast, notify, confirm } = useFeedback();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = create, id = edit
  const [viewing, setViewing] = useState(null); // member id for the eye/view modal
  const [departments, setDepartments] = useState([]);
  const currentUser = getStaffUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  useEffect(() => { loadTeam(); loadDepartments(); }, []);

  async function loadDepartments() {
    try {
      const res = await getDepartments();
      setDepartments(res.departments || []);
    } catch {}
  }

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
    setEditing(member ? member.id : 'new');
  }

  const isLastSuperAdmin = (member) =>
    member.role === 'super_admin' && members.filter((m) => m.role === 'super_admin').length <= 1;

  async function handleDeactivate(member) {
    if (isLastSuperAdmin(member)) {
      notify('You cannot deactivate the last Super Admin — someone has to stay able to restore access.');
      return;
    }
    const action = member.is_active ? 'Deactivate' : 'Reactivate';
    const ok = await confirm({
      title: `${action} ${member.name}?`,
      body: member.is_active
        ? 'They will be signed out of the panel and will not be able to sign back in until reactivated.'
        : 'They will be able to sign in and see the panel again.',
      confirmLabel: action,
      danger: member.is_active,
    });
    if (!ok) return;
    try {
      const res = await updateMember(member.id, { is_active: !member.is_active });
      setMembers(prev => prev.map(m => m.id === member.id ? res.member : m));
      toast(`${member.name} ${member.is_active ? 'deactivated' : 'reactivated'}`);
    } catch (err) { notify(err.message); }
  }

  async function handleDelete(member) {
    if (isLastSuperAdmin(member)) {
      notify('You cannot delete the last Super Admin.');
      return;
    }
    const ok = await confirm({
      title: `Delete ${member.name}?`,
      body: 'This removes them from the team permanently. Their history stays, but they can never sign in again.',
      confirmLabel: 'Delete member',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMember(member.id);
      setMembers(prev => prev.filter(m => m.id !== member.id));
      toast(`${member.name} removed`);
    } catch (err) { notify(err.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Team Members</h3>
          <p style={{ margin: '4px 0 0', color: '#949494', fontSize: 13 }}>{members.length} members · Role-based access</p>
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
        <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading team…</div>
      ) : members.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#949494', background: '#fff', borderRadius: 14 }}>
          <Users size={40} style={{ color: '#C9C2B4', marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>No team members yet</p>
          <p style={{ fontSize: 13 }}>Click "Add Member" to invite your first team member</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(430px, 1fr))', gap: 16 }}>
          {members.map(m => {
            const roleMeta = ROLES.find(r => r.value === m.role) || ROLES[0];
            const active = m.is_active !== false;
            const deptMeta = m.department_id ? departments.find(d => Number(d.id) === Number(m.department_id)) : null;
            const deptOff = !!deptMeta && deptMeta.is_active === false;
            const deptName = deptMeta ? deptMeta.name : 'No department';
            return (
              // A neutral card border. The accent is reserved for things that
              // are actually interactive or selected — a 2px orange outline on
              // every card made the whole grid shout and left nothing left to
              // mean "this one is active".
              <div key={m.id} style={{
                position: 'relative', background: '#fff', borderRadius: 14,
                border: '1px solid #E7E2D8', padding: '18px 20px',
                overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'border-color 120ms ease, box-shadow 120ms ease',
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
                  {/* Avatar */}
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', background: '#F2701D',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 28, flexShrink: 0,
                  }}>{m.name?.charAt(0)?.toUpperCase() || '?'}</div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 18, color: '#161616' }}>{m.name}</span>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
                        background: roleMeta.color + '18', color: roleMeta.color, textTransform: 'capitalize',
                      }}>{roleMeta.label}</span>
                      {deptOff && (
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
                          background: '#FEF3C7', color: '#B45309',
                        }} title="Department disabled — member deactivated">Dept off</span>
                      )}
                      {m.id === currentUser?.id && <span style={{ fontSize: 11, color: '#949494' }}>(You)</span>}
                    </div>
                    <div style={{ fontSize: 14, color: '#949494', marginTop: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                    <div style={{ fontSize: 14, color: '#B8AFA6', marginTop: 5, fontStyle: 'italic' }}>{deptName}</div>
                  </div>

                  {/* Controls — every control shares one 48px box so the icon
                      column and the switch stay on the same centre axis. */}
                  {isSuperAdmin && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                      <button onClick={() => setViewing(m.id)} title="View details" style={{
                        width: 48, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#F2701D', padding: 0,
                      }}><Eye size={22} /></button>
                      <button onClick={() => startEdit(m)} title="Edit member" style={{
                        width: 48, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#F2701D', padding: 0,
                      }}><Edit3 size={20} /></button>
                      <button
                        onClick={() => handleDeactivate(m)}
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
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit member modal */}
      {editing !== null && (
        <MemberFormModal
          editing={editing}
          member={editing !== 'new' ? members.find(m => m.id === editing) : null}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={(updated, isNew) => setMembers(prev => isNew ? [updated, ...prev] : prev.map(m => m.id === updated.id ? updated : m))}
        />
      )}

      {/* View details modal */}
      {(() => {
        const v = members.find(m => m.id === viewing);
        if (!v) return null;
        const roleMeta = ROLES.find(r => r.value === v.role) || ROLES[0];
        const active = v.is_active !== false;
        const rows = [
          { label: 'Email', value: v.email },
          { label: 'Role', value: roleMeta.label },
          { label: 'Department', value: v.department_id ? (departments.find(d => Number(d.id) === Number(v.department_id))?.name || `#${v.department_id}`) : 'No department' },
          { label: 'Phone', value: v.phone || '—' },
          { label: 'Designation', value: v.designation || '—' },
          { label: 'Device Number', value: v.device_number || '—' },
          { label: 'Areas / Locations', value: v.locations || '—' },
          { label: 'Status', value: active ? 'Active' : 'Inactive' },
          { label: 'Member since', value: new Date(v.created_at).toLocaleDateString() },
        ];
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setViewing(null)}>
            <div onClick={e => e.stopPropagation()} style={{
              background: '#fff', borderRadius: 16, padding: 28, width: 460, maxWidth: '92vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '86vh', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Member Details</h3>
                <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#949494' }}><X size={18} /></button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid #E7E2D8' }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%', background: '#F2701D',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 24, flexShrink: 0,
                }}>{v.name?.charAt(0)?.toUpperCase() || '?'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: '#161616' }}>{v.name}</div>
                  <span style={{
                    display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    borderRadius: 999, marginTop: 5,
                    background: roleMeta.color + '18', color: roleMeta.color,
                  }}>{roleMeta.label}</span>
                  <span style={{
                    display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    borderRadius: 999, marginTop: 5, marginLeft: 6,
                    background: active ? '#ECFDF5' : '#FEF2F2', color: active ? '#059669' : '#DC2626',
                  }}>{active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {rows.map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: '1px solid #FAF9F7' }}>
                    <span style={{ fontSize: 12.5, color: '#949494', flexShrink: 0 }}>{r.label}</span>
                    <span style={{ fontSize: 13, color: '#161616', fontWeight: 500, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{r.value}</span>
                  </div>
                ))}
              </div>

              {isSuperAdmin && (
                <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                  <button onClick={() => { setViewing(null); startEdit(v); }} style={{
                    flex: 1, padding: 11, borderRadius: 8, border: '1px solid #E7E2D8',
                    background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}><Edit3 size={14} /> Edit</button>
                  <button onClick={() => { setViewing(null); handleDelete(v); }} style={{
                    flex: 1, padding: 11, borderRadius: 8, border: '1px solid #FECACA',
                    background: '#FEF2F2', color: '#DC2626', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
