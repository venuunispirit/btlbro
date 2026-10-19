import React, { useState, useEffect, useRef } from 'react';

const loadStyle = { padding: 40, textAlign: 'center', color: '#949494' };
import { Filter, RefreshCw, UserPlus, ChevronDown, ExternalLink, Trash2, Package, MessageSquare } from 'lucide-react';
import { getOrders, updateOrder, deleteOrder, getTeam, getStaffUser, getDepartments } from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';
import { useFeedback, Banner } from '../components/Feedback.jsx';
import { EmptyState } from '../theme.js';
import RecordMoney from './RecordMoney.jsx';

const STATUS_OPTIONS = ['placed', 'pending', 'processed', 'paid', 'in_progress', 'on_hold', 'cancelled', 'delivered'];
const STATUS_COLORS = {
  placed: { bg: '#EFF6FF', color: '#2563EB' },
  pending: { bg: '#FEF2F2', color: '#DC2626' },
  processed: { bg: '#EFF6FF', color: '#2563EB' },
  paid: { bg: '#ECFDF5', color: '#059669' },
  in_progress: { bg: '#F3E8FF', color: '#7C3AED' },
  on_hold: { bg: '#FEF3C7', color: '#D97706' },
  cancelled: { bg: '#FAF9F7', color: '#949494' },
  delivered: { bg: '#ECFDF5', color: '#059669' },
};

export default function OrdersTab({ onNavigate: onChat }) {
  const { toast, notify, clearBanner, confirm, banner } = useFeedback();
  const [orders, setOrders] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);
  const search = useGlobalSearch();
  const [statusFilter, setStatusFilter] = useState('');
  const [assigning, setAssigning] = useState(null); // order id
  const [expanded, setExpanded] = useState(null); // order id
  const [departments, setDepartments] = useState([]);
  const currentUser = getStaffUser();
  const isMember = currentUser?.role === 'member';
  const isOpsManager = currentUser?.role === 'ops_manager' || currentUser?.role === 'manager' || currentUser?.role === 'super_admin';
  const canAssign = isOpsManager || isMember;

  useEffect(() => { load(); }, []);

  async function load() {
    // Only the very first load blanks the table. Refreshing in place matters:
    // remounting every row would throw away whatever an open panel was showing
    // (a freshly created UPI intent, for instance).
    if (firstLoad.current) setLoading(true);
    try {
      const [ordersRes, teamRes, deptRes] = await Promise.allSettled([getOrders(), getTeam(), getDepartments()]);
      setOrders(ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : []);
      setTeam(teamRes.status === 'fulfilled' ? teamRes.value.members || [] : []);
      setDepartments(deptRes.status === 'fulfilled' ? deptRes.value.departments || [] : []);
    } catch {}
    firstLoad.current = false;
    setLoading(false);
  }

  async function handleStatusChange(orderId, newStatus) {
    try {
      const res = await updateOrder(orderId, { status: newStatus });
      setOrders(prev => prev.map(o => o.id === orderId ? res.order : o));
    } catch (err) { notify(err.message); }
  }

  async function handleAssign(orderId, memberId) {
    try {
      const res = await updateOrder(orderId, { assigned_to: memberId || null, assigned_by: currentUser?.id });
      setOrders(prev => prev.map(o => o.id === orderId ? res.order : o));
      setAssigning(null);
    } catch (err) { notify(err.message); }
  }

  async function handleDelete(orderId) {
    const ok = await confirm({
      title: 'Delete this order?',
      body: 'The order and its history are removed. This cannot be undone.',
      confirmLabel: 'Delete order',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteOrder(orderId);
      setOrders(prev => prev.filter(o => o.id !== orderId));
      toast('Order deleted');
    } catch (err) { notify(err.message); }
  }

  function getMemberName(id) {
    if (!id) return 'Unassigned';
    const m = team.find(t => t.id === Number(id));
    if (!m) return `#${id}`;
    const dept = m.department_id ? departments.find(d => d.id === m.department_id) : null;
    return dept ? `${m.name} (${dept.name})` : m.name;
  }

  const filtered = orders.filter(o => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const itemNames = (o.items || []).map(i => i.name).filter(Boolean).join(' ');
      const searchable = [o.businessName, o.contactName, o.email, o.phone, o.pincode, o.category, o.user?.name, o.user?.email, itemNames].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  return (
    <div>
      <Banner message={banner} onClose={clearBanner} />
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13 }}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={load} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 12, color: '#949494' }}>{filtered.length} orders</span>
      </div>

      {/* Orders table. overflowX (not overflow:hidden) so the wide table
          scrolls inside its card on a phone instead of forcing the whole page
          sideways. */}
      <div style={{ background: '#fff', borderRadius: 12, overflowX: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E7E2D8' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>No orders found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAF9F7' }}>
                {['ID', 'Customer', 'Contact', 'Items', 'Qty', 'Amount', 'Status', 'Assigned', 'Actions'].map(h => (
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
                    <tr style={{ background: i % 2 === 0 ? '#fff' : '#FAF9F7', cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : o.id)}>
                      <td style={tdStyle}>#{o.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.user?.name || '-'}</td>
                      <td style={tdStyle}>
                        <div>{o.user?.name || '-'}</div>
                        <div style={{ fontSize: 11, color: '#949494' }}>{o.user?.email || o.email || ''}</div>
                      </td>
                      <td style={tdStyle}>{o.items ? o.items.map(i => i.name).filter(Boolean).slice(0, 2).join(', ') : '-'}</td>
                      <td style={tdStyle}>{o.items ? o.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : '-'}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>₹{(Number(o.total) || 0).toLocaleString('en-IN')}</td>
                      <td style={tdStyle}>
                        <select value={o.status} onChange={e => { e.stopPropagation(); handleStatusChange(o.id, e.target.value); }}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          onClick={e => e.stopPropagation()}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <div style={{ position: 'relative' }}>
                          <button onClick={() => setAssigning(assigning === o.id ? null : o.id)} disabled={!canAssign}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E7E2D8', background: canAssign ? '#fff' : '#FAF9F7', fontSize: 12, cursor: canAssign ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {getMemberName(o.assigned_to)} {canAssign && <ChevronDown size={12} />}
                          </button>
                          {assigning === o.id && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 6, zIndex: 10, minWidth: 180, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
                              <button onClick={() => handleAssign(o.id, null)} style={dropdownItemStyle}>Unassign</button>
                              {departments.filter(d => d.is_active !== false).map(dept => {
                                const deptMembers = team.filter(m => m.department_id === dept.id && ['ops_executive', 'ops_manager'].includes(m.role));
                                if (deptMembers.length === 0) return null;
                                return (
                                  <div key={dept.id}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: '#949494', padding: '6px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{dept.name}</div>
                                    {deptMembers.map(m => (
                                      <button key={m.id} onClick={() => handleAssign(o.id, m.id)} style={dropdownItemStyle}>{m.name}</button>
                                    ))}
                                  </div>
                                );
                              })}
                              {(() => {
                                const ungrouped = team.filter(m => !m.department_id && ['ops_executive', 'ops_manager'].includes(m.role));
                                return ungrouped.length > 0 ? (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: '#949494', padding: '6px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>No Department</div>
                                    {ungrouped.map(m => (
                                      <button key={m.id} onClick={() => handleAssign(o.id, m.id)} style={dropdownItemStyle}>{m.name}</button>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {o.user?.phone && (
                            <button title="Message on WhatsApp" onClick={() => onChat?.('chat', { leadId: o.lead_id })}
                              style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#059669', cursor: o.lead_id ? 'pointer' : 'default', display: 'inline-flex' }}>
                              <MessageSquare size={14} />
                            </button>
                          )}
                          <button onClick={() => handleDelete(o.id)} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {isExp && (
                      <tr>
                        <td colSpan={9} style={{ padding: '14px 20px', background: '#FAF9F7', borderBottom: '1px solid #E7E2D8' }}>
                          {/* A product order is money without being a customer
                              relationship — no Company is created for it. */}
                          <RecordMoney kind="order" id={o.id} defaultAmount={o.total} onChanged={load} />
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
                            <div><span style={{ color: '#949494' }}>Phone:</span> {o.user?.phone || '-'}</div>
                            <div><span style={{ color: '#949494' }}>Pincode:</span> {o.address?.pincode || '-'}</div>
                            <div><span style={{ color: '#949494' }}>Payment:</span> {o.gateway || '-'} · {o.payment_status || '-'}</div>
                            <div><span style={{ color: '#949494' }}>Placed:</span> {o.created_at ? new Date(o.created_at).toLocaleString() : '-'}</div>
                            <div><span style={{ color: '#949494' }}>Updated:</span> {o.updated_at ? new Date(o.updated_at).toLocaleString() : '-'}</div>
                          </div>
                          {o.items?.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <span style={{ color: '#949494', fontSize: 12 }}>Products:</span>
                              <div style={{ marginTop: 6 }}>
                                {o.items.map((it, ii) => (
                                  <div key={ii} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1EDE4', fontSize: 12.5, maxWidth: 420 }}>
                                    <span>{it.name}{it.size_label ? ` · ${it.size_label}` : ''} × {it.qty}</span>
                                    <span style={{ fontWeight: 600 }}>₹{((Number(it.unit_price) || 0) * (Number(it.qty) || 1)).toLocaleString('en-IN')}</span>
                                  </div>
                                ))}
                              </div>
                              {o.address && (
                                <div style={{ marginTop: 8, fontSize: 12, color: '#4A4A4A' }}>
                                  <strong>Deliver to:</strong> {o.address.address || ''} {o.address.city || ''} {o.address.pincode || ''}
                                </div>
                              )}
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

const thStyle = { padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#949494', borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', borderBottom: '1px solid #F1EDE4', fontSize: 13, color: '#161616', verticalAlign: 'middle' };
const dropdownItemStyle = { display: 'block', width: '100%', padding: '7px 12px', borderRadius: 6, border: 'none', background: 'none', textAlign: 'left', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };

/**
 * Template variables for an order. A product order has no lead behind it, so
 * there is no quoted total to chase — the order total is the only amount the
 * customer has ever agreed to, which makes it the safe thing to mention.
 */
function orderWaCtx(o = {}) {
  return {
    name: o.contactName || o.user?.name || '',
    business: o.businessName || '',
    amount: Number(o.total) || 0,
    reference: o.payment_reference || o.id ? (o.payment_reference || `ORD-${o.id}`) : '',
    locations: o.items?.length || 0,
  };
}
