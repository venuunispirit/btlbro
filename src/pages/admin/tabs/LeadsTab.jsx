import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, UserPlus, ChevronDown, Phone, MessageSquare, Flag, X, Users } from 'lucide-react';
import { getTeam, getStaffUser, api as adminApi, getDepartments } from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';
import { useFeedback, Banner } from '../components/Feedback.jsx';
import { EmptyState } from '../theme.js';
import RecordMoney from './RecordMoney.jsx';

const loadStyle = { padding: 40, textAlign: 'center', color: '#949494' };

const ALL_STATUSES = ['new', 'assigned', 'in_followup', 'qualified', 'in_operations', 'completed', 'cold'];
const SALES_STATUSES = ['new', 'assigned', 'in_followup', 'qualified', 'cold'];
const OPS_STATUSES = ['qualified', 'in_operations', 'completed', 'cold'];
const STATUS_COLORS = {
  new: { bg: '#EFF6FF', color: '#2563EB' },
  assigned: { bg: '#FEF3C7', color: '#D97706' },
  in_followup: { bg: '#F3E8FF', color: '#7C3AED' },
  qualified: { bg: '#ECFDF5', color: '#059669' },
  in_operations: { bg: '#DBEAFE', color: '#1D4ED8' },
  completed: { bg: '#D1FAE5', color: '#065F46' },
  cold: { bg: '#FEE2E2', color: '#DC2626' },
};

export default function LeadsTab({ onNavigate }) {
  const { toast, notify, clearBanner, banner } = useFeedback();
  const [leads, setLeads] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const firstLoad = useRef(true);
  const search = useGlobalSearch();
  const [statusFilter, setStatusFilter] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [detailTab, setDetailTab] = useState('money');
  const [coldModal, setColdModal] = useState(null);
  const [coldReason, setColdReason] = useState('');
  const [departments, setDepartments] = useState([]);
  const currentUser = getStaffUser();
  const role = currentUser?.role;
  const isAdmin = role === 'super_admin' || role === 'manager';
  const isBdm = role === 'bdm';
  const isBdExec = role === 'bd_executive';
  const isOpsManager = role === 'ops_manager';
  const isOpsExec = role === 'ops_executive';
  const canAssignBd = isAdmin || isBdm;
  const canAssignOps = isAdmin || isOpsManager;
  const statusOptions = isAdmin ? ALL_STATUSES : isOpsManager || isOpsExec ? OPS_STATUSES : SALES_STATUSES;

  useEffect(() => { load(); }, []);

  async function load() {
    // Only the very first load blanks the table. Refreshing in place matters:
    // remounting every row would throw away whatever an open panel was showing
    // (a freshly created UPI intent, for instance).
    if (firstLoad.current) setLoading(true);
    try {
      const [leadsRes, teamRes, deptRes] = await Promise.allSettled([
        adminApi('/api/leads'),
        getTeam(),
        getDepartments(),
      ]);
      setLeads(leadsRes.status === 'fulfilled' ? leadsRes.value.leads || [] : []);
      setTeam(teamRes.status === 'fulfilled' ? teamRes.value.members || [] : []);
      setDepartments(deptRes.status === 'fulfilled' ? deptRes.value.departments || [] : []);
    } catch {}
    firstLoad.current = false;
    setLoading(false);
  }

  async function handleAssignBd(leadId, bdExecId) {
    try {
      const res = await adminApi(`/api/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ bd_exec_id: bdExecId || null }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? res.lead : l));
      setAssigning(null);
    } catch (err) { notify(err.message); }
  }

  async function handleAssignOps(leadId, opsExecId) {
    try {
      const res = await adminApi(`/api/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ ops_exec_id: opsExecId || null }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? res.lead : l));
      setAssigning(null);
    } catch (err) { notify(err.message); }
  }

  async function handleStatusChange(leadId, newStatus) {
    try {
      const res = await adminApi(`/api/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? res.lead : l));
    } catch (err) { notify(err.message); }
  }

  async function handleCold(leadId) {
    try {
      const res = await adminApi(`/api/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify({ cold_flag: true, cold_reason: coldReason, status: 'cold' }),
      });
      setLeads(prev => prev.map(l => l.id === leadId ? res.lead : l));
      setColdModal(null);
      setColdReason('');
    } catch (err) { notify(err.message); }
  }

  async function handleAddNote(leadId) {
    if (!noteText.trim()) return;
    try {
      await adminApi(`/api/leads/${leadId}/note`, {
        method: 'POST',
        body: JSON.stringify({ text: noteText }),
      });
      setNoteText('');
      // Reload lead detail
      const res = await adminApi(`/api/leads/${leadId}`);
      setLeads(prev => prev.map(l => l.id === leadId ? res.lead : l));
    } catch (err) { notify(err.message); }
  }

  async function handleCall(leadId) {
    try {
      await adminApi('/api/telephony/call', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      });
      toast('Call initiated');
    } catch (err) { notify(err.message); }
  }

  function getMemberName(id) {
    if (!id) return 'Unassigned';
    const m = team.find(t => t.id === Number(id));
    return m ? m.name : `#${id}`;
  }

  function assignDropdown(prefix, roles, onPick) {
    const shown = team.filter(m => m.is_active !== false && roles.includes(m.role));
    const byDept = departments.filter(d => d.is_active !== false);
    const grouped = byDept.map(dept => ({
      dept,
      members: shown.filter(m => m.department_id === dept.id),
    })).filter(g => g.members.length > 0);
    const ungrouped = shown.filter(m => !m.department_id);
    return (
      <>
        {grouped.map(g => (
          <div key={`${prefix}-${g.dept.id}`}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#949494', padding: '6px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{g.dept.name}</div>
            {g.members.map(m => (
              <button key={m.id} onClick={() => onPick(m.id)} style={dropdownItemStyle}>{m.name}</button>
            ))}
          </div>
        ))}
        {ungrouped.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#949494', padding: '6px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>No Department</div>
            {ungrouped.map(m => (
              <button key={m.id} onClick={() => onPick(m.id)} style={dropdownItemStyle}>{m.name}</button>
            ))}
          </div>
        )}
      </>
    );
  }

  // <select> equivalent of assignDropdown, grouped by department the same way.
  // The rail uses selects rather than popups because selects read correctly on
  // a touch screen, where a hover popover is awkward.
  function assignDropdownOptions(_prefix, roles) {
    const shown = team.filter(m => m.is_active !== false && roles.includes(m.role));
    const byDept = departments.filter(d => d.is_active !== false);
    const grouped = byDept
      .map(dept => ({ dept, members: shown.filter(m => Number(m.department_id) === Number(dept.id)) }))
      .filter(g => g.members.length > 0);
    const ungrouped = shown.filter(m => !m.department_id);
    return (
      <>
        {grouped.map(g => (
          <optgroup key={g.dept.id} label={g.dept.name}>
            {g.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
        ))}
        {ungrouped.length > 0 && (
          <optgroup label="No Department">
            {ungrouped.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
        )}
      </>
    );
  }

  const filtered = leads.filter(l => {
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const searchable = [l.businessName, l.contactName, l.email, l.phone, l.pincode, l.category].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  // The lead whose modal is open, re-read from state each render so the money
  // panel and notes update the moment load() replaces the row.
  const detailLead = expanded ? leads.find((l) => l.id === expanded) || null : null;

  // Prefill Collect with what is still outstanding. defaultAmount used to be the
  // booking fee, so clicking Collect after the booking landed asked for the
  // amount already paid — the single most common way to send a duplicate
  // request. Falls back to the quoted total minus what has been received.
  const defaultCollectAmount = (() => {
    if (!detailLead) return null;
    const quoted = Number(detailLead.amount_quoted) || 0;
    const received = Number(detailLead.amount_received) || 0;
    const pending = Number(detailLead.amount_pending) || 0;
    const outstanding = Math.max(0, quoted - received - pending);
    // Outstanding always wins. The old order checked the quote first and only
    // then fell back to the booking amount, so a lead with quoted = 0 (which is
    // every lead that came through checkout with an empty cart) always showed
    // the stale ₹999 — even with ₹9,999 already outstanding. Clicking Collect
    // then asked for the wrong number.
    if (outstanding > 0) return outstanding;
    // Only offer the booking amount when it is genuinely still unpaid: nothing
    // received, and nothing already in flight against it.
    if (received === 0 && pending === 0) {
      return detailLead.amountPaid || detailLead.payment_amount || null;
    }
    return null;
  })();

  // Escape closes the sheet, and the page behind it must not scroll while the
  // sheet is up — otherwise the content visibly shifts as the lock is applied.
  useEffect(() => {
    if (!detailLead) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(null); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [detailLead]);

  return (
    <div>
      <Banner message={banner} onClose={clearBanner} />
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13 }}>
          <option value="">All Status</option>
          {statusOptions.map(s => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
        </select>
        <button onClick={load} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 12, color: '#949494' }}>{filtered.length} leads</span>
      </div>

      {/* Leads table. overflowX so the wide table scrolls inside its own card
          on a phone rather than dragging the page sideways. */}
      <div style={{ background: '#fff', borderRadius: 12, overflowX: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E7E2D8' }}>
        {loading ? (
          <div style={loadStyle}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={26} color="#C9C2B4" />}
            title={leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
            hint={leads.length === 0
              ? 'Leads arrive from the marketing checkout, the enquiry form, or Google search results a recee has verified.'
              : 'Try a different status filter, or clear the search box.'}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAF9F7' }}>
                {BASE_COLUMNS.map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
                {(canAssignBd || isBdExec) && <th style={thStyle}>BD Exec</th>}
                {(canAssignOps || isOpsExec) && <th style={thStyle}>Ops Exec</th>}
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => {
                const sc = STATUS_COLORS[l.status] || STATUS_COLORS.new;
                return (
                  <React.Fragment key={l.id}>
                    <tr
                      style={{ background: i % 2 === 0 ? '#fff' : '#FAF9F7', cursor: 'pointer' }}
                      onClick={() => { setNoteText(''); setAssigning(null); setDetailTab('money'); setExpanded(l.id); }}
                    >
                      <td style={tdStyle}>#{l.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        <div>{l.contactName || '-'}</div>
                        <div style={{ fontSize: 11, color: '#949494' }}>{l.phone || ''}</div>
                      </td>
                      <td style={tdStyle}>{l.category || '-'}</td>
                      <td style={tdStyle}>
                        <MoneyCell lead={l} />
                      </td>
                      <td style={tdStyle}>
                        <select value={l.status} onChange={e => { e.stopPropagation(); handleStatusChange(l.id, e.target.value); }}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: sc.bg, color: sc.color, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          onClick={e => e.stopPropagation()}>
                          {statusOptions.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      {(canAssignBd || isBdExec) && (
                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                          {canAssignBd ? (
                            <div style={{ position: 'relative' }}>
                              <button onClick={() => setAssigning(assigning === `bd:${l.id}` ? null : `bd:${l.id}`)}
                                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E7E2D8', background: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {getMemberName(l.bd_exec_id)} <ChevronDown size={12} />
                              </button>
                              {assigning === `bd:${l.id}` && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 6, zIndex: 10, minWidth: 180, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
                                  <button onClick={() => handleAssignBd(l.id, null)} style={dropdownItemStyle}>Unassign</button>
                                  {assignDropdown('bd', ['bd_executive', 'bdm'], (mId) => handleAssignBd(l.id, mId))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#4A4A4A' }}>{getMemberName(l.bd_exec_id)}</span>
                          )}
                        </td>
                      )}
                      {(canAssignOps || isOpsExec) && (
                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                          {canAssignOps ? (
                            <div style={{ position: 'relative' }}>
                              <button onClick={() => setAssigning(assigning === `ops:${l.id}` ? null : `ops:${l.id}`)}
                                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E7E2D8', background: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {getMemberName(l.ops_exec_id)} <ChevronDown size={12} />
                              </button>
                              {assigning === `ops:${l.id}` && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 6, zIndex: 10, minWidth: 180, marginTop: 4, maxHeight: 300, overflowY: 'auto' }}>
                                  <button onClick={() => handleAssignOps(l.id, null)} style={dropdownItemStyle}>Unassign</button>
                                  {assignDropdown('ops', ['ops_executive', 'ops_manager'], (mId) => handleAssignOps(l.id, mId))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#4A4A4A' }}>{getMemberName(l.ops_exec_id)}</span>
                          )}
                        </td>
                      )}
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => handleCall(l.id)} title="Call" style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#2563EB', cursor: 'pointer' }}>
                            <Phone size={14} />
                          </button>
                          {l.phone && onNavigate && (
                            <button onClick={() => onNavigate('chat', { leadId: l.id })} title="Message on WhatsApp"
                              style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#059669', cursor: 'pointer', display: 'inline-flex' }}>
                              <MessageSquare size={14} />
                            </button>
                          )}
                          {onNavigate && (
                            <button onClick={() => onNavigate('chat')} title="Chat" style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#7C3AED', cursor: 'pointer' }}>
                              <MessageSquare size={14} />
                            </button>
                          )}
                          {l.status !== 'cold' && (
                            <button onClick={() => setColdModal(l.id)} title="Mark Cold" style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer' }}>
                              <Flag size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Lead detail.
          Layout follows the sketch: a narrow identity rail on the left that
          stays put, and a large working area on the right split into tabs.

          Two deliberate changes from the sketch, both to keep it readable over a
          long session:
            - the identity rail is a soft tint with a solid accent rule, not
              full-saturation orange. A third of the screen in #F2701D vibrates
              against the white beside it and becomes tiring.
            - selected locations read as one row per location with its services
              as chips. As repeated flat lines the rail became a wall of
              identical text after about ten locations. */}
      {detailLead && (
        <div style={scrim} onClick={() => setExpanded(null)}>
          <div
            className="lead-sheet"
            style={sheet}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Lead ${detailLead.id}`}
          >
            {/* Close belongs to the whole modal, not the rail. It used to sit in
                the rail's top-right corner, which read as "closes this panel"
                and left the tab area looking like it had no dismiss control. */}
            <button className="lead-sheet-close" onClick={() => setExpanded(null)} style={sheetClose} aria-label="Close lead">
              <X size={16} />
            </button>
            <div className="lead-sheet-layout" style={sheetLayout}>
              {/* ---- identity rail ---- */}
              <aside className="lead-sheet-rail" style={rail}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#C2410C', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Lead #{detailLead.id}
                </div>

                <h2 style={{ margin: '10px 0 0', fontSize: 19, fontWeight: 700, lineHeight: 1.25 }}>
                  {detailLead.contactName || 'Unnamed lead'}
                </h2>
                {detailLead.businessName && (
                  <div style={{ fontSize: 13, color: '#B45309', marginTop: 3, fontWeight: 600 }}>{detailLead.businessName}</div>
                )}

                {/* Contact details as bare values, no EMAIL / PHONE label above
                    them. The label was what cost the space — two extra lines of
                    small caps saying what an @-sign already says. */}
                {(detailLead.email || detailLead.phone) && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detailLead.email && (
                      <a href={`mailto:${detailLead.email}`} style={railContact}>{detailLead.email}</a>
                    )}
                    {detailLead.phone && (
                      <a href={`tel:${detailLead.phone}`} style={railContact}>{detailLead.phone}</a>
                    )}
                  </div>
                )}

                {/* Messaging happens in the Chat tab, not here. A wa.me link
                    would bounce the user out of the CRM into WhatsApp, which
                    breaks the flow this panel exists for. */}
                {detailLead.phone && onNavigate && (
                  <button onClick={() => onNavigate('chat', { leadId: detailLead.id })}
                    style={{
                      marginTop: 14, width: '100%', padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: '#059669', color: '#fff', border: 'none', fontSize: 12, fontWeight: 650,
                    }}>
                    <MessageSquare size={14} /> Message on WhatsApp
                  </button>
                )}

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {detailLead.pincode && <RailField label="Location">{detailLead.pincode}</RailField>}
                  {detailLead.duration && <RailField label="Duration">{detailLead.duration}</RailField>}
                  {detailLead.source && <RailField label="Source">{detailLead.source}</RailField>}
                </div>

                {/* Stage lives in the rail because it is the one thing that
                    always needs changing, and it should not be buried in a tab. */}
                <div style={{ marginTop: 16 }}>
                  <div style={railLabel}>Stage</div>
                  <select
                    value={detailLead.status || 'new'}
                    onChange={(e) => handleStatusChange(detailLead.id, e.target.value)}
                    style={{ ...statusSelect, ...STATUS_COLORS[detailLead.status || 'new'] }}
                  >
                    {statusOptions.map((st) => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>

                {(canAssignBd || isBdExec) && (
                  <div style={{ marginTop: 14 }}>
                    <div style={railLabel}>BD Exec</div>
                    {canAssignBd ? (
                      <select
                        value={detailLead.bd_exec_id || ''}
                        onChange={(e) => handleAssignBd(detailLead.id, e.target.value || null)}
                        style={railSelect}
                      >
                        <option value="">Unassigned</option>
                        {assignDropdownOptions('bd', ['bd_executive', 'bdm'])}
                      </select>
                    ) : <div style={{ fontSize: 12.5, color: '#4A4A4A' }}>{getMemberName(detailLead.bd_exec_id)}</div>}
                  </div>
                )}
                {(canAssignOps || isOpsExec) && (
                  <div style={{ marginTop: 12 }}>
                    <div style={railLabel}>Ops Exec</div>
                    {canAssignOps ? (
                      <select
                        value={detailLead.ops_exec_id || ''}
                        onChange={(e) => handleAssignOps(detailLead.id, e.target.value || null)}
                        style={railSelect}
                      >
                        <option value="">Unassigned</option>
                        {assignDropdownOptions('ops', ['ops_executive', 'ops_manager'])}
                      </select>
                    ) : <div style={{ fontSize: 12.5, color: '#4A4A4A' }}>{getMemberName(detailLead.ops_exec_id)}</div>}
                  </div>
                )}

                {/* One line per location, its services as chips. */}
                {detailLead.selectedLocations?.length > 0 && (
                  <div style={{ marginTop: 18, minHeight: 0, overflowY: 'auto' }}>
                    <div style={railLabel}>
                      Locations <span style={{ color: '#B45309' }}>{detailLead.selectedLocations.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {detailLead.selectedLocations.map((loc, li) => (
                        <div key={li} style={locBlock}>
                          <div style={{ fontSize: 12.5, fontWeight: 650, color: '#7A2E0E' }}>{loc.name}</div>
                          {loc.type && <div style={{ fontSize: 10.5, color: '#B45309' }}>{loc.type}</div>}
                          {(() => {
                            // Services have been stored three ways across
                            // captures: an array of names, an array of objects,
                            // and a { name: price } map (which is what the
                            // marketing tool actually writes). Normalise all
                            // three to a list of names, and drop the empty ones
                            // so an unselected location shows no noise.
                            const raw = loc.services ?? loc.promotions ?? loc.selected;
                            let names = [];
                            if (Array.isArray(raw)) {
                              names = raw.map((x) => (typeof x === 'string' ? x : x?.name || x?.service)).filter(Boolean);
                            } else if (raw && typeof raw === 'object') {
                              names = Object.keys(raw);
                            }
                            // A { name: 0 } entry means "checked, not offered" —
                            // still worth showing, because it is a real finding.
                            if (!names.length) return null;
                            return (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                                {names.map((nm, ni) => <span key={ni} style={chip}>{nm}</span>)}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailLead.cold_flag && (
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 11.5, color: '#B91C1C' }}>
                    <Flag size={12} /> Cold lead{detailLead.cold_reason ? `: ${detailLead.cold_reason}` : ''}
                  </div>
                )}
              </aside>

              {/* ---- working area ---- */}
              <main className="lead-sheet-work" style={workArea}>
                <div className="lead-sheet-tabs" style={tabBar}>
                  {[
                    ['money', 'Payment Logs'],
                    ['notes', `Notes${detailLead.notes?.length ? ` (${detailLead.notes.length})` : ''}`],
                    ['activity', `Activity${detailLead.activities?.length ? ` (${detailLead.activities.length})` : ''}`],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      style={detailTab === id ? tabOn : tab}
                      onClick={() => setDetailTab(id)}
                      aria-selected={detailTab === id}
                      role="tab"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div style={workBody}>
                  {detailTab === 'money' && (
                    <RecordMoney kind="lead" id={detailLead.id} defaultAmount={defaultCollectAmount} onChanged={load} />
                  )}

                  {detailTab === 'notes' && (
                    <>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                        <input
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddNote(detailLead.id)}
                          placeholder="Add a note…"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button onClick={() => handleAddNote(detailLead.id)} style={addNoteBtn}>Add note</button>
                      </div>
                      {detailLead.notes?.length ? (
                        // Three columns: a single column makes a lead with ten
                        // notes a scroll hunt, three turns it into a scannable wall.
                        <div style={noteCols}>
                          {detailLead.notes.slice().reverse().map((n, ni) => (
                            <div key={ni} style={noteCard}>
                              <div style={{ fontSize: 10.5, color: '#949494' }}>
                                <strong style={{ color: '#4A4A4A' }}>{n.author || '—'}</strong>
                                {' · '}{new Date(n.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div style={{ fontSize: 12.5, color: '#161616', marginTop: 3, lineHeight: 1.5 }}>{n.text}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={emptyHint}>No notes on this lead yet. Notes are the shared record of what was said and done.</div>
                      )}
                    </>
                  )}

                  {detailTab === 'activity' && (
                    detailLead.activities?.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {detailLead.activities.slice().reverse().map((a, ai) => (
                          <div key={ai} style={activityRow}>
                            <span style={activityDot} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, color: '#161616' }}>
                                <strong style={{ fontWeight: 650 }}>{(a.type || 'activity').replace(/_/g, ' ')}</strong>
                                {' — '}{a.description}
                              </div>
                              <div style={{ fontSize: 11, color: '#949494', marginTop: 1 }}>
                                {a.actor ? `${a.actor} · ` : ''}{new Date(a.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={emptyHint}>Nothing has happened on this lead yet.</div>
                    )
                  )}
                </div>
              </main>
            </div>
          </div>
        </div>
      )}

      {/* Cold modal */}
      {coldModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setColdModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 28, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Mark as Cold Lead</h3>
              <button onClick={() => setColdModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#949494' }}><X size={18} /></button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 }}>Reason (optional)</label>
              <textarea value={coldReason} onChange={e => setColdReason(e.target.value)}
                placeholder="Why is this lead cold?"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, minHeight: 80, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setColdModal(null)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleCold(coldModal)} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Mark Cold</button>
            </div>
          </div>
        </div>
      )}

      
    </div>
  );
}

const thStyle = { padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#949494', borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', borderBottom: '1px solid #F1EDE4', fontSize: 13, color: '#161616', verticalAlign: 'middle' };

// Fixed (non-conditional) lead table columns. The expanded detail row spans
// exactly this many plus the conditional exec columns, so adding a column here
// keeps the span correct automatically.
const BASE_COLUMNS = ['ID', 'Contact', 'Category', 'Payment', 'Status'];

const PAY_TONES = {
  paid: { bg: '#D1FAE5', color: '#047857', label: 'Paid' },
  awaiting: { bg: '#FEF3C7', color: '#B45309', label: 'Awaiting' },
  // Checkout parks a lead on the raw rail status ('awaiting'); the rollup and
  // collection routes call the same state 'pending'. Both mean "asked for, not
  // received", so they read identically here.
  pending: { bg: '#FEF3C7', color: '#B45309', label: 'Awaiting' },
  processing: { bg: '#DBEAFE', color: '#1D4ED8', label: 'Processing' },
  failed: { bg: '#FEE2E2', color: '#B91C1C', label: 'Failed' },
  cancelled: { bg: '#F3F0EA', color: '#4A4A4A', label: 'Cancelled' },
  unknown: { bg: '#F3F0EA', color: '#4A4A4A', label: 'Unknown' },
};

/**
 * Payment state for one lead. Leads arrive from three places — a paid checkout,
 * a checkout where the customer never completed the QR, and the /customize
 * enquiry form which has no payment step at all — so "nothing to show" is a
 * real and common case, not an error.
 */
/**
 * One cell for the whole money story of a lead.
 *
 * This replaced two columns — a status badge and a "Paid" figure — which showed
 * the same number twice while contradicting each other: "Awaiting ₹9,999" next
 * to "₹0 / Not received / ₹9,999 pending". Two badges and two amounts for one
 * fact is what made the table read as noise.
 *
 * Now: the amount is the headline, and one chip underneath says the state.
 */
/**
 * Template variables for a lead. Outgoing is the number a reminder should ask
 * for, not the quoted total — the customer has only ever been told about
 * whatever was actually requested, so a larger figure in the message reads as
 * a bill they never saw.
 */
function leadWaCtx(l = {}) {
  const quoted = Number(l.amount_quoted) || 0;
  const received = Number(l.amount_received) || 0;
  const pending = Number(l.amount_pending) || 0;
  return {
    name: l.contactName || l.contact_name || '',
    business: l.businessName || l.business_name || '',
    amount: pending || Math.max(0, quoted - received),
    reference: l.payment_reference || '',
    locations: Array.isArray(l.locations) ? l.locations.length : l.locations,
  };
}

function MoneyCell({ lead }) {
  const received = Number(lead.amount_received) || 0;
  const pending = Number(lead.amount_pending) || 0;
  const quoted = Number(lead.amount_quoted) || 0;
  const asked = Number(lead.payment_amount ?? lead.amountPaid ?? 0) || 0;

  // An enquiry has no money at all — that is a different kind of record, so
  // say so rather than showing a dash that looks like missing data.
  if (!lead.payment_reference && !received && !pending && !quoted) {
    return lead.source === 'customize'
      ? <span style={moneyMuted}>Enquiry</span>
      : <span style={moneyMuted}>—</span>;
  }

  // A reference pointing at a payment that no longer exists. Worth saying
  // plainly: the old badge fell back to a stale status here and claimed money
  // that is not in the ledger.
  if (lead.payment_status === 'missing') {
    return (
      <div style={moneyStack}>
        <span style={moneyNone}>Payment missing</span>
        <span style={moneySub}>request not in ledger</span>
      </div>
    );
  }

  const outstanding = Math.max(0, quoted - received - pending);
  let chip;
  if (received > 0 && outstanding === 0 && pending === 0) {
    chip = { bg: '#ECFDF5', fg: '#047857', label: 'Paid in full' };
  } else if (received > 0) {
    chip = { bg: '#ECFDF5', fg: '#047857', label: 'Part paid' };
  } else if (pending > 0) {
    chip = { bg: '#FEF3C7', fg: '#B45309', label: 'Not received' };
  } else {
    chip = { bg: '#FEF3C7', fg: '#B45309', label: 'Unpaid' };
  }

  // Nothing has landed yet, so the figure to lead with is what is being asked
  // for — leading with ₹0 next to a pending ₹9,999 reads as a contradiction.
  const headline = received > 0 ? received : (pending || asked);
  const sub = [];
  if (pending > 0) sub.push(`₹${pending.toLocaleString()} pending`);
  if (received > 0 && quoted > received) sub.push(`of ₹${quoted.toLocaleString()}`);

  return (
    <div style={moneyStack}>
      <span style={moneyHead}>₹{(headline || 0).toLocaleString()}</span>
      <span style={{ ...moneyChip, background: chip.bg, color: chip.fg }}>{chip.label}</span>
      {sub.map((line) => <span key={line} style={moneySub}>{line}</span>)}
    </div>
  );
}

// --- lead detail sheet ---
// A soft tint on the identity rail with a solid accent rule, rather than a
// full-saturation orange block: a third of the screen in #F2701D vibrates
// against the white beside it and tires the eye over a long session.
const scrim = {
  position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(22,22,22,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const sheet = {
  background: '#fff', borderRadius: 16, width: 1080, maxWidth: '100%',
  maxHeight: '88vh', overflow: 'hidden', display: 'flex', position: 'relative',
  boxShadow: '0 24px 70px rgba(0,0,0,0.26)',
};
// Rail + working area. The rail holds its own scroll so the working area is
// never squeezed when a lead has many locations.
const sheetLayout = { display: 'grid', gridTemplateColumns: '288px 1fr', minHeight: 0, flex: 1 };
const rail = {
  background: '#FFF4EC', borderRight: '3px solid #F2701D',
  padding: '18px 18px 20px', overflowY: 'auto', minHeight: 0, alignSelf: 'stretch',
};
const railLabel = {
  fontSize: 10, fontWeight: 700, color: '#B45309', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 5,
};
const railContact = { color: '#7A2E0E', fontSize: 12.5, textDecoration: 'none', fontWeight: 550, wordBreak: 'break-all', lineHeight: 1.45 };
const railSelect = {
  width: '100%', padding: '7px 9px', borderRadius: 8, fontSize: 12.5,
  border: '1px solid #F2C9A8', background: '#fff', color: '#161616', fontFamily: 'inherit',
};
const statusSelect = {
  width: '100%', padding: '7px 9px', borderRadius: 8, fontSize: 12.5,
  fontWeight: 650, border: 'none', fontFamily: 'inherit', cursor: 'pointer',
};
const locBlock = {
  background: 'rgba(255,255,255,0.72)', border: '1px solid #F2C9A8',
  borderRadius: 8, padding: '7px 9px',
};
const chip = {
  display: 'inline-block', padding: '2px 7px', borderRadius: 999,
  background: '#fff', border: '1px solid #F2C9A8', color: '#7A2E0E',
  fontSize: 10.5, fontWeight: 600,
};
// Pinned to the modal's own top-right corner, over the tab bar.
const sheetClose = {
  position: 'absolute', top: 10, right: 12, zIndex: 3,
  background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#4A4A4A',
};

const workArea = { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 };
const tabBar = {
  display: 'flex', justifyContent: 'center', gap: 2,
  padding: '0 52px', borderBottom: '1px solid #E7E2D8', flexShrink: 0,
  position: 'relative',
};
const tab = {
  background: 'none', border: 'none', borderBottom: '2px solid transparent',
  padding: '14px 14px', fontSize: 12.5, fontWeight: 600, color: '#949494',
  cursor: 'pointer', fontFamily: 'inherit',
};
const tabOn = {
  background: 'none', border: 'none', borderBottom: '2px solid #F2701D',
  padding: '14px 14px', fontSize: 12.5, fontWeight: 700, color: '#161616',
  cursor: 'pointer', fontFamily: 'inherit',
};
const workBody = { padding: '20px', overflowY: 'auto', flex: 1, minHeight: 0 };

// Notes in three columns — a single column turns ten notes into a scroll hunt.
const noteCols = { columns: '3 180px', columnGap: 10 };
const noteCard = {
  breakInside: 'avoid', background: '#FAF9F7', border: '1px solid #E7E2D8',
  borderRadius: 10, padding: '8px 10px', marginBottom: 8,
};
const activityRow = { display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1EDE4' };
const activityDot = { width: 7, height: 7, borderRadius: 999, background: '#F2701D', marginTop: 5, flexShrink: 0 };
const emptyHint = {
  padding: '28px 20px', textAlign: 'center', color: '#949494', fontSize: 12.5,
  background: '#FAF9F7', border: '1px dashed #E7E2D8', borderRadius: 12, lineHeight: 1.5,
};
const inputStyle = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid #E7E2D8',
  fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
};
const addNoteBtn = {
  padding: '8px 14px', borderRadius: 8, border: 'none',
  background: '#F2701D', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

const moneyStack = { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' };
const moneyHead = { fontSize: 13, fontWeight: 700, color: '#161616', fontVariantNumeric: 'tabular-nums' };
const moneyChip = { padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700 };
const moneySub = { fontSize: 10.5, color: '#949494' };
const moneyMuted = { fontSize: 11, color: '#949494' };
const moneyNone = { fontSize: 12, fontWeight: 700, color: '#B91C1C' };

/** A labelled value in the identity rail. */
function RailField({ label, children }) {
  return (
    <div>
      <div style={railLabel}>{label}</div>
      <div style={{ fontSize: 12.5, color: '#161616' }}>{children}</div>
    </div>
  );
}

const dropdownItemStyle = { display: 'block', width: '100%', padding: '7px 12px', borderRadius: 6, border: 'none', background: 'none', textAlign: 'left', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };