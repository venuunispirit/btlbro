import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, UserPlus, ChevronDown, ExternalLink, Trash2 } from 'lucide-react';
import { getOrders, updateOrder, deleteOrder, getTeam, getStaffUser } from '../api.js';

const STATUS_OPTIONS = ['pending', 'processed', 'paid', 'cancelled', 'delivered'];
const STATUS_COLORS = {
  pending: { bg: '#FEF2F2', color: '#DC2626' },
  processed: { bg: '#EFF6FF', color: '#2563EB' },
  paid: { bg: '#ECFDF5', color: '#059669' },
  cancelled: { bg: '#F5F5F5', color: '#888' },
  delivered: { bg: '#F0FDF4', color: '#16A34A' },
};

export default function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assigning, setAssigning] = useState(null); // order id
  const [expanded, setExpanded] = useState(null); // order id
  const currentUser = getStaffUser();
  const isMember = currentUser?.role === 'member';

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [ordersRes, teamRes] = await Promise.allSettled([getOrders(), getTeam()]);
      setOrders(ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : []);
      setTeam(teamRes.status === 'fulfilled' ? teamRes.value.members || [] : []);
    } catch {}
    setLoading(false);
  }

  async function handleStatusChange(orderId, newStatus) {
    try {
      const res = await updateOrder(orderId, { status: newStatus });
      setOrders(prev => prev.map(o => o.id === orderId ? res.order : o));
    } catch (err) { alert(err.message); }
  }

  async function handleAssign(orderId, memberId) {
    try {
      const res = await updateOrder(orderId, { assigned_to: memberId || null, assigned_by: currentUser?.id });
      setOrders(prev => prev.map(o => o.id === orderId ? res.order : o));
      setAssigning(null);
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(orderId) {
    if (!confirm('Delete this order?')) return;
    try {
      await deleteOrder(orderId);
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (err) { alert(err.message); }
  }

  function getMemberName(id) {
    if (!id) return 'Unassigned';
    const m = team.find(t => t.id === Number(id));
    return m ? m.name : `#${id}`;
  }

  const filtered = orders.filter(o => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const searchable = [o.businessName, o.contactName, o.email, o.phone, o.pincode, o.category].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders…"
            style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13 }}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={load} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>{filtered.length} orders</span>
      </div>

      {/* Orders table */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E8E8E8' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>No orders found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F8F8F8' }}>
                {['ID', 'Business', 'Contact', 'Category', 'Locations', 'Amount', 'Status', 'Assigned', 'Actions'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS.pending;
                const isExp = expanded === o.id;
                return (
                  <React.Fragment key={o.id}>
                    <tr style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA', cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : o.id)}>
                      <td style={tdStyle}>#{o.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.businessName || '-'}</td>
                      <td style={tdStyle}>
                        <div>{o.contactName || '-'}</div>
                        <div style={{ fontSize: 11, color: '#999' }}>{o.email || ''}</div>
                      </td>
                      <td style={tdStyle}>{o.category || '-'}</td>
                      <td style={tdStyle}>{o.locations || '-'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>₹{(Number(o.invoice?.total) || 0).toLocaleString('en-IN')}</td>
                      <td style={tdStyle}>
                        <select value={o.status} onChange={e => { e.stopPropagation(); handleStatusChange(o.id, e.target.value); }}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          onClick={e => e.stopPropagation()}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <div style={{ position: 'relative' }}>
                          <button onClick={() => setAssigning(assigning === o.id ? null : o.id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {getMemberName(o.assigned_to)} <ChevronDown size={12} />
                          </button>
                          {assigning === o.id && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 6, zIndex: 10, minWidth: 160, marginTop: 4 }}>
                              <button onClick={() => { handleAssign(o.id, null); }} style={dropdownItemStyle}>Unassign</button>
                              {team.map(m => (
                                <button key={m.id} onClick={() => handleAssign(o.id, m.id)} style={dropdownItemStyle}>{m.name} ({m.role})</button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDelete(o.id)} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {isExp && (
                      <tr>
                        <td colSpan={9} style={{ padding: '14px 20px', background: '#FAFAFA', borderBottom: '1px solid #E8E8E8' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
                            <div><span style={{ color: '#888' }}>Phone:</span> {o.phone || '-'}</div>
                            <div><span style={{ color: '#888' }}>Pincode:</span> {o.pincode || '-'}</div>
                            <div><span style={{ color: '#888' }}>Duration:</span> {o.duration || '-'}</div>
                            <div><span style={{ color: '#888' }}>Payment:</span> {o.paymentMethod || '-'}</div>
                            <div><span style={{ color: '#888' }}>Submitted:</span> {o.submittedAt ? new Date(o.submittedAt).toLocaleString() : '-'}</div>
                            <div><span style={{ color: '#888' }}>Updated:</span> {o.updated_at ? new Date(o.updated_at).toLocaleString() : '-'}</div>
                          </div>
                          {o.selectedLocations?.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                              <span style={{ color: '#888', fontSize: 12 }}>Selected Locations:</span>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                {o.selectedLocations.map((loc, li) => (
                                  <span key={li} style={{ padding: '3px 10px', borderRadius: 999, background: '#F0F0F0', fontSize: 12 }}>
                                    {loc.name} ({loc.type})
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const thStyle = { padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#888', borderBottom: '1px solid #E8E8E8', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', borderBottom: '1px solid #F0F0F0', fontSize: 13, color: '#333', verticalAlign: 'middle' };
const dropdownItemStyle = { display: 'block', width: '100%', padding: '7px 12px', borderRadius: 6, border: 'none', background: 'none', textAlign: 'left', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
