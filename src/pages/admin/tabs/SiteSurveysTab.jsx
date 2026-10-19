import React, { useState, useEffect, useMemo } from 'react';
import {
  Camera, MapPin, User, Phone, RefreshCw, CheckCircle2, Loader, ExternalLink,
  Plus, X, Search, Users, Clock, Check, Ban, Send, ClipboardList, ChevronRight,
  AlertCircle, CircleDot,
} from 'lucide-react';
import { api, getTeam, getStaffUser, createReceeRequest, assignSiteSurvey, updateSiteSurveyStatus, overrideSiteSurvey } from '../api.js';

// Site Surveys — full request → assignment → capture workflow.
//   1. Admin/PM/recee-manager creates a recee REQUEST (location + expected services).
//   2. It is assigned to a recee executive (who / when / by whom recorded).
//   3. The executive captures the site (geo + photos + manager contact + service
//      availability) → status completes to 'done' with full audit trail.
// Analytics strip + per-executive breakdown answer "who did what and when";
// the services checklist answers "what can be promoted at this location".

const MANAGE_ROLES = ['super_admin', 'manager', 'recee_manager', 'bdm', 'ops_manager'];

const STATUS_META = {
  new: { label: 'Pending', bg: '#FEF3C7', color: '#B45309' },
  assigned: { label: 'Assigned', bg: '#EFF6FF', color: '#2563EB' },
  in_progress: { label: 'In progress', bg: '#FFF7ED', color: '#C2410C' },
  // A capture that failed the radius check. Parked rather than discarded — a
  // manager accepts it with a reason, which is more reliable than a GPS fix in
  // a basement.
  needs_review: { label: 'Out of range', bg: '#FEE2E2', color: '#B91C1C' },
  // A request created without coordinates, so there is nothing to verify
  // against. Needs the same human decision.
  no_target: { label: 'No location set', bg: '#F3F0EA', color: '#949494' },
  done: { label: 'Completed', bg: '#D1FAE5', color: '#047857' },
};

const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

export default function SiteSurveysTab() {
  const user = getStaffUser();
  const canManage = MANAGE_ROLES.includes(user?.role);

  const [surveys, setSurveys] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [assignId, setAssignId] = useState(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const [res, teamRes] = await Promise.allSettled([api('/api/recee/surveys'), getTeam()]);
      if (res.status === 'fulfilled') {
        setSurveys(res.value.surveys || []);
        setCatalog(res.value.service_catalog || []);
        if (silent) setError('');
      } else {
        if (!silent) setError(res.reason?.message || 'Failed to load surveys');
      }
      if (teamRes.status === 'fulfilled') setTeam(teamRes.value.members || []);
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to load');
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Keep the counts current when a manager assigns in the Data tab, without a
  // manual Refresh. Skip while the tab is hidden.
  useEffect(() => {
    const poll = setInterval(() => { if (!document.hidden) load(true); }, 30000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(poll); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const byStatus = { new: 0, assigned: 0, in_progress: 0, done: 0 };
    surveys.forEach((s) => { if (byStatus[s.status] !== undefined) byStatus[s.status] += 1; else byStatus.new += 1; });
    const open = surveys.length - byStatus.done;
    const rate = surveys.length ? Math.round((byStatus.done / surveys.length) * 100) : 0;
    return { total: surveys.length, ...byStatus, open, rate };
  }, [surveys]);

  const execRows = useMemo(() => {
    const ids = new Set();
    surveys.forEach((s) => { if (s.assigned_to_id) ids.add(s.assigned_to_id); });
    team.filter((m) => ['recee', 'recee_manager'].includes(m.role)).forEach((m) => ids.add(m.id));
    const byId = new Map(team.map((m) => [m.id, m]));
    return [...ids]
      .map((id) => {
        const m = byId.get(id);
        const assigned = surveys.filter((s) => s.assigned_to_id === id);
        const captured = surveys.filter(
          (s) => s.status === 'done' && (s.submitted_by_id === id || (s.assigned_to_id === id && s.submitted_by_id === id)),
        );
        return {
          id,
          name: m ? (m.name || m.email) : (assigned[0]?.assigned_to_name || `Member #${id}`),
          role: m?.role || '',
          active: m ? m.is_active !== false : false,
          assigned: assigned.length,
          open: assigned.filter((s) => s.status !== 'done').length,
          captured: captured.length,
        };
      })
      .sort((a, b) => b.assigned - a.assigned || b.captured - a.captured);
  }, [surveys, team]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return surveys.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!q) return true;
      const hay = [
        `#${s.id}`, s.title, s.address, s.manager_name, s.assigned_to_name,
        s.submitted_by, s.created_by_name,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [surveys, filter, query]);

  const viewing = viewId !== null ? surveys.find((s) => s.id === viewId) || null : null;
  const assigning = assignId !== null ? surveys.find((s) => s.id === assignId) || null : null;

  async function setStatus(id, status) {
    setBusyId(id);
    setError('');
    try {
      const data = await updateSiteSurveyStatus(id, status);
      setSurveys((prev) => prev.map((s) => (s.id === id ? data.survey : s)));
    } catch (err) {
      setError(err.message || 'Failed to update');
    }
    setBusyId(null);
  }

  // Accept a capture that came in outside the radius. Deliberate and
  // attributed: the reason is stored, so the audit trail always shows whether
  // the 200m check passed or a manager waved it through.
  async function acceptCapture(id) {
    const reason = window.prompt(
      'This capture was outside the 200 m radius. Accept it anyway? Say why (it is recorded):',
      '',
    );
    if (!reason) return;
    await refreshAfter(() => overrideSiteSurvey(id, reason));
  }

  async function refreshAfter(mutate) {
    setBusyId(assignId || viewId || null);
    setError('');
    try {
      await mutate();
      const data = await api('/api/recee/surveys');
      setSurveys(data.surveys || []);
      setCatalog(data.service_catalog || []);
      setAssignId(null);
    } catch (err) {
      setError(err.message || 'Action failed');
    }
    setBusyId(null);
  }

  return (
    <div>
      <style>{`.ss-row:hover { background: #FAF9F7; }`}</style>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Site Surveys</div>
          <div style={{ fontSize: 12.5, color: '#949494', marginTop: 2 }}>
            Recee requests → assignments → captures, with a full who / what / when trail.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => load()} style={ghostBtn}><RefreshCw size={14} /> Refresh</button>
          {canManage && (
            <button onClick={() => setShowCreate(true)} style={primaryBtn}>
              <Plus size={15} /> New request
            </button>
          )}
        </div>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <div style={emptyBox}>
          <Loader size={18} className="spin" /> Loading site surveys…
        </div>
      ) : (
        <>
          {/* Analytics strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <StatCard label="Total requests" value={stats.total} icon={<ClipboardList size={15} />} tone="#161616" />
            <StatCard label="Pending" value={stats.new} icon={<AlertCircle size={15} />} tone="#B45309" sub="awaiting assignment" />
            <StatCard label="Assigned" value={stats.assigned} icon={<Send size={15} />} tone="#2563EB" sub="with an executive" />
            <StatCard label="In progress" value={stats.in_progress} icon={<CircleDot size={15} />} tone="#C2410C" />
            <StatCard label="Completed" value={stats.done} icon={<CheckCircle2 size={15} />} tone="#047857" sub={`${stats.rate}% completion`} />
            <StatCard label="Open" value={stats.open} icon={<Clock size={15} />} tone='#4A4A4A' sub="not yet completed" />
          </div>

          {/* Per-executive breakdown */}
          {execRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={sectionLabel}><Users size={13} /> By recee executive</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
                {execRows.map((r) => (
                  <div key={r.id} style={execCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={execAvatar}>{(r.name || '?').charAt(0).toUpperCase()}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: '#949494', textTransform: 'capitalize' }}>
                          {r.role ? r.role.replace(/_/g, ' ') : '—'}{!r.active && r.role ? ' · inactive' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <MiniStat k="Assigned" v={r.assigned} color="#2563EB" />
                      <MiniStat k="Open" v={r.open} color="#B45309" />
                      <MiniStat k="Captured" v={r.captured} color="#047857" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            {[['all', 'All'], ...Object.entries(STATUS_META).map(([k, v]) => [k, v.label])].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                ...pillBtn,
                background: filter === k ? '#161616' : '#fff',
                color: filter === k ? '#fff' : '#4A4A4A',
                borderColor: filter === k ? '#161616' : '#E7E2D8',
              }}>{label}</button>
            ))}
            <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 220 }}>
              <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#949494' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search location, manager, person…"
                style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div style={emptyBox}>
              <Camera size={30} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {surveys.length === 0 ? 'No site surveys yet' : 'Nothing matches this filter'}
              </div>
              <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
                {surveys.length === 0
                  ? (canManage ? 'Create a recee request to get started.' : 'Recee requests and captures will appear here.')
                  : 'Try a different status pill or clear the search.'}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E7E2D8', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                  <thead>
                    <tr style={{ background: '#FAF9F7' }}>
                      {['#', 'Location', 'Status', 'Assigned to', 'Captured by', 'When', 'Services', 'Photos', ''].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => {
                      const meta = STATUS_META[s.status] || STATUS_META.new;
                      const svcDone = Array.isArray(s.services) ? s.services.filter((x) => x.available === true).length : 0;
                      const svcTotal = Array.isArray(s.services) ? s.services.length : 0;
                      return (
                        <tr key={s.id} onClick={() => setViewId(s.id)} style={tr} className="ss-row">
                          <td style={td}><span style={idBadge}>#{s.id}</span></td>
                          <td style={{ ...td, maxWidth: 260 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {s.title || s.address || `Survey #${s.id}`}
                            </div>
                            {/* Only when it adds something. A capture with no
                                title falls back to its address, which then
                                printed the same line twice in the cell. */}
                            {s.address && s.address !== s.title && (
                              <div style={{ fontSize: 11.5, color: '#949494', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.address}
                              </div>
                            )}
                          </td>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            <select
                              value={STATUS_META[s.status] ? s.status : 'new'}
                              onChange={(e) => setStatus(s.id, e.target.value)}
                              disabled={!canManage || busyId === s.id}
                              style={{ ...statusSel, background: meta.bg, color: meta.color }}
                            >
                              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </td>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            {s.assigned_to_name ? (
                              <div>
                                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.assigned_to_name}</div>
                                {s.assigned_at && <div style={{ fontSize: 11, color: '#949494' }}>{fmtDT(s.assigned_at)}</div>}
                              </div>
                            ) : (
                              canManage && s.status !== 'done' ? (
                                <button onClick={() => setAssignId(s.id)} style={assignBtn}>
                                  <Send size={12} /> Assign
                                </button>
                              ) : <span style={{ color: '#949494', fontSize: 12.5 }}>Unassigned</span>
                            )}
                          </td>
                          <td style={td}>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.submitted_by || '—'}</div>
                            {['needs_review', 'no_target'].includes(s.status) && canManage && (
                              <button onClick={() => acceptCapture(s.id)} style={{ ...assignBtn, marginTop: 5 }}>
                                <Check size={12} /> Accept capture
                              </button>
                            )}
                          </td>
                          <td style={{ ...td, fontSize: 12, color: '#4A4A4A' }}>
                            {s.status === 'done' ? fmtDT(s.completed_at || s.captured_at) : `req. ${fmtDT(s.created_at)}`}
                          </td>
                          <td style={td}>
                            {svcTotal > 0 ? (
                              <span style={svcChip} title={s.services.map((x) => `${x.name}: ${x.available == null ? 'pending' : x.available ? 'available' : 'not available'}`).join('\n')}>
                                {svcDone}/{svcTotal} available
                              </span>
                            ) : <span style={{ color: '#949494', fontSize: 12 }}>—</span>}
                          </td>
                          <td style={td}>
                            {s.photos?.length
                              ? <span style={{ fontSize: 12, color: '#4A4A4A' }}><Camera size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{s.photos.length}</span>
                              : <span style={{ color: '#949494', fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ ...td, textAlign: 'right', paddingRight: 14 }}><ChevronRight size={15} color="#949494" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {viewing && (
        <DetailModal
          s={viewing}
          canManage={canManage}
          busy={busyId === viewing.id}
          onClose={() => setViewId(null)}
          onStatus={(status) => setStatus(viewing.id, status)}
          onAssign={() => { setAssignId(viewing.id); }}
        />
      )}

      {assigning && (
        <AssignModal
          s={assigning}
          team={team}
          busy={busyId === assigning.id}
          onClose={() => setAssignId(null)}
          onAssign={(memberId) => refreshAfter(() => assignSiteSurvey(assigning.id, memberId))}
        />
      )}

      {showCreate && (
        <CreateModal
          catalog={catalog}
          onClose={() => setShowCreate(false)}
          onCreate={(payload) => refreshAfter(async () => {
            await createReceeRequest(payload);
            setShowCreate(false);
          })}
        />
      )}
    </div>
  );
}

// ---------- Analytics stat card ----------
function StatCard({ label, value, icon, tone, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#949494', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
        <span style={{ color: tone }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#161616', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#949494', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MiniStat({ k, v, color }) {
  return (
    <div style={{ flex: 1, background: '#FAF9F7', borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{v}</div>
      <div style={{ fontSize: 10, color: '#949494', fontWeight: 600 }}>{k}</div>
    </div>
  );
}

// ---------- Detail modal ----------
function DetailModal({ s, canManage, busy, onClose, onStatus, onAssign }) {
  const meta = STATUS_META[s.status] || STATUS_META.new;
  const timeline = [
    s.created_at && {
      icon: <ClipboardList size={13} />, title: 'Request created',
      sub: `${fmtDT(s.created_at)}${s.created_by_name ? ` · by ${s.created_by_name}` : ' · by Admin'}`,
    },
    s.assigned_at && {
      icon: <Send size={13} />, title: 'Assigned',
      sub: `${fmtDT(s.assigned_at)}${s.assigned_by_name ? ` · ${s.assigned_by_name}` : ''}${s.assigned_to_name ? ` → ${s.assigned_to_name}` : ''}`,
    },
    (s.completed_at || (s.status === 'done' && s.captured_at)) && {
      icon: <CheckCircle2 size={13} />, title: 'Recee captured',
      sub: `${fmtDT(s.completed_at || s.captured_at)}${s.submitted_by ? ` · by ${s.submitted_by}` : ''}${s.submitted_by_role ? ` (${s.submitted_by_role.replace(/_/g, ' ')})` : ''}`,
    },
  ].filter(Boolean);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={idBadge}>#{s.id}</span>
              <span style={{ ...statusSel, background: meta.bg, color: meta.color, display: 'inline-block', pointerEvents: 'none' }}>{meta.label}</span>
            </div>
            <h3 style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800 }}>{s.title || s.address || `Survey #${s.id}`}</h3>
          </div>
          <button onClick={onClose} style={iconBtn}><X size={17} /></button>
        </div>

        <div style={{ maxHeight: '68vh', overflowY: 'auto', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 4 }}>
          {/* Audit timeline — who / what / when */}
          <div>
            <div style={sectionLabel}>Audit trail</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {timeline.length === 0 && <div style={{ fontSize: 12.5, color: '#949494' }}>No events yet.</div>}
              {timeline.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#FFF4EC', color: '#F2701D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.icon}</div>
                    {i < timeline.length - 1 && <div style={{ width: 2, flex: 1, background: '#E7E2D8', minHeight: 14 }} />}
                  </div>
                  <div style={{ paddingBottom: i < timeline.length - 1 ? 12 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: '#949494' }}>{t.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Location + manager */}
          <div style={{ background: '#FAF9F7', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={sectionLabel}><MapPin size={13} /> Location</div>
            <div style={{ fontSize: 13.5, color: '#4A4A4A', lineHeight: 1.5 }}>{s.address || '—'}</div>
            {s.lat != null && s.lng != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{Number(s.lat).toFixed(6)}, {Number(s.lng).toFixed(6)}</span>
                {s.accuracy_m ? <span style={accTag}>±{s.accuracy_m} m</span> : null}
                {s.geo && (
                  <span style={{
                    ...accTag,
                    background: s.geo.ok ? '#ECFDF5' : '#FEE2E2',
                    color: s.geo.ok ? '#047857' : '#B91C1C',
                    fontWeight: 700,
                  }}>
                    {s.geo.ok ? 'verified on site' : `${s.geo.distance_m} m from target`}
                    {s.geo.accuracy_m ? ` (limit ${s.geo.radius_m} m)` : ''}
                  </span>
                )}
                {s.verified_by_override && (
                  <span style={{ ...accTag, background: '#FEF3C7', color: '#B45309', fontWeight: 700 }}>
                    accepted by {s.override_by}
                  </span>
                )}
                <a style={linkStyle} href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">
                  Open map <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                </a>
              </div>
            )}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#4A4A4A' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><User size={13} color="#F2701D" /> {s.manager_name || '—'}</span>
              <a href={`tel:${s.manager_phone}`} style={{ ...linkStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={13} color="#F2701D" /> {s.manager_phone || '—'}
              </a>
            </div>
            {s.notes && <div style={{ fontSize: 12.5, color: '#4A4A4A', fontStyle: 'italic' }}>“{s.notes}”</div>}
          </div>

          {/* Services available at this location */}
          {Array.isArray(s.services) && s.services.length > 0 && (
            <div>
              <div style={sectionLabel}>Services at this location</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {s.services.map((svc, i) => {
                  const st = svc.available === true ? { bg: '#D1FAE5', color: '#047857', icon: <Check size={12} />, label: 'Available' }
                    : svc.available === false ? { bg: '#FEE2E2', color: '#B91C1C', icon: <Ban size={12} />, label: 'Not available' }
                    : { bg: '#F3F0EA', color: '#4A4A4A', icon: <Clock size={12} />, label: 'Pending' };
                  return (
                    <span key={i} title={st.label} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, background: st.bg, color: st.color,
                      fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '5px 11px',
                    }}>
                      {st.icon} {svc.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Photos */}
          <div>
            <div style={sectionLabel}><Camera size={13} /> Site photos {s.photos?.length ? `(${s.photos.length})` : ''}</div>
            {s.photos?.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {s.photos.map((p, i) => (
                  <a key={i} href={p} target="_blank" rel="noreferrer">
                    <img src={p} alt={`Site ${i + 1}`} style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid #E7E2D8' }} />
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: '#949494' }}>No photos yet.</div>
            )}
          </div>

          {/* Who captured */}
          <div style={{ fontSize: 12, color: '#949494', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>Requested {fmtDT(s.created_at)}</span>
            {s.assigned_to_name && <span>Assigned to <strong style={{ color: '#4A4A4A' }}>{s.assigned_to_name}</strong></span>}
            {s.submitted_by && <span>Captured by <strong style={{ color: '#4A4A4A' }}>{s.submitted_by}</strong></span>}
          </div>
        </div>

        {canManage && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <select
              value={STATUS_META[s.status] ? s.status : 'new'}
              onChange={(e) => onStatus(e.target.value)}
              disabled={busy}
              style={{ ...statusSel, marginLeft: 0, background: meta.bg, color: meta.color, fontWeight: 700, fontSize: 13, padding: '10px 12px' }}
            >
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {s.status !== 'done' && (
              <button onClick={onAssign} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>
                <Send size={14} /> {s.assigned_to_name ? 'Reassign' : 'Assign to executive'}
              </button>
            )}
            <button onClick={onClose} style={ghostBtn}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Assign modal ----------
function AssignModal({ s, team, busy, onClose, onAssign }) {
  const options = team.filter((m) => m.is_active !== false && ['recee', 'recee_manager'].includes(m.role));
  const [pick, setPick] = useState(s.assigned_to_id || null);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>Assign #{s.id}</h3>
          <button onClick={onClose} style={iconBtn}><X size={17} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
          {s.title || s.address}
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
          {options.length === 0 && (
            <div style={{ fontSize: 13, color: '#949494', background: '#FAF9F7', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              No active Recee team members. Add one from the Team tab first.
            </div>
          )}
          {options.map((m) => (
            <button key={m.id} onClick={() => setPick(m.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
              border: '2px solid', borderColor: pick === m.id ? '#F2701D' : '#E7E2D8',
              background: pick === m.id ? '#FFF4EC' : '#FAF9F7', cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ ...execAvatar, background: pick === m.id ? '#F2701D' : '#E7E2D8', color: pick === m.id ? '#fff' : '#4A4A4A' }}>
                {(m.name || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m.name}</div>
                <div style={{ fontSize: 11.5, color: '#949494' }}>{m.designation || m.role.replace(/_/g, ' ')}</div>
              </div>
              {pick === m.id && <Check size={16} color="#F2701D" />}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
          <button
            onClick={() => pick && onAssign(pick)}
            disabled={!pick || busy}
            style={{ ...primaryBtn, flex: 1, opacity: !pick || busy ? 0.6 : 1 }}
          >
            {busy ? <Loader size={14} className="spin" /> : <Send size={14} />} Assign
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Create request modal ----------
function CreateModal({ catalog, onClose, onCreate }) {
  const [form, setForm] = useState({ title: '', address: '', notes: '' });
  const [services, setServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!form.title.trim() || !form.address.trim()) {
      setErr('Location title and address are required.');
      return;
    }
    setSaving(true);
    try {
      await onCreate({ ...form, services: services.map((name) => ({ name })) });
    } catch (e) {
      setErr(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  function toggle(name) {
    setServices((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>New recee request</h3>
          <button onClick={onClose} style={iconBtn}><X size={17} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
          Create a location for the recee team to visit, pick the expected services, then assign it to an executive.
        </div>

        {err && <div style={{ ...errBox, marginTop: 12 }}>{err}</div>}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
          <div>
            <label style={fieldLabel}>Location title *</label>
            <input style={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Indiranagar Metro Station" />
          </div>
          <div>
            <label style={fieldLabel}>Address *</label>
            <textarea style={{ ...input, minHeight: 64 }} value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Full address with landmark" />
          </div>
          <div>
            <label style={fieldLabel}>Notes (optional)</label>
            <textarea style={{ ...input, minHeight: 48 }} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Gate timings, whom to meet, access restrictions…" />
          </div>
          <div>
            <label style={fieldLabel}>Expected services at this location</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {catalog.map((name) => (
                <button key={name} type="button" onClick={() => toggle(name)} style={{
                  padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: '1.5px solid', borderColor: services.includes(name) ? '#F2701D' : '#E7E2D8',
                  background: services.includes(name) ? '#FFF4EC' : '#fff',
                  color: services.includes(name) ? '#C2410C' : '#4A4A4A',
                }}>
                  {services.includes(name) ? '✓ ' : '+ '}{name}
                </button>
              ))}
              {catalog.length === 0 && <span style={{ fontSize: 12.5, color: '#949494' }}>No services found in the sheet data.</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ ...primaryBtn, flex: 1, opacity: saving ? 0.6 : 1 }}>
            {saving ? <Loader size={14} className="spin" /> : <Plus size={15} />} Create request
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- styles ----------
const overlay = {
  position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const modal = {
  background: '#fff', borderRadius: 16, padding: 24, width: 720, maxWidth: '96vw',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
};
const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
  border: '1px solid #E7E2D8', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#161616', fontWeight: 500,
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8,
  border: 'none', background: '#F2701D', fontSize: 13, cursor: 'pointer', color: '#fff', fontWeight: 700,
};
const errBox = { padding: '12px 14px', borderRadius: 10, background: '#FEE2E2', color: '#B91C1C', fontSize: 13, marginBottom: 14 };
const emptyBox = {
  padding: 48, textAlign: 'center', color: '#949494', border: '1px dashed #E7E2D8',
  borderRadius: 14, background: '#FAF9F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const sectionLabel = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: '#949494',
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
};
const execCard = { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, padding: '12px 14px' };
const execAvatar = {
  width: 36, height: 36, borderRadius: '50%', background: '#FFF4EC', color: '#F2701D',
  fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const pillBtn = {
  padding: '7px 14px', borderRadius: 999, border: '1.5px solid #E7E2D8', background: '#fff',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};
const th = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 800, color: '#949494',
  textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
};
const td = { padding: '11px 12px', fontSize: 13, color: '#4A4A4A', borderTop: '1px solid #F0EDE6', verticalAlign: 'middle' };
const tr = { cursor: 'pointer', transition: 'background .12s' };
const idBadge = {
  fontSize: 12, fontWeight: 800, color: '#161616', background: '#FAF9F7', border: '1px solid #E7E2D8',
  borderRadius: 6, padding: '3px 8px', display: 'inline-block',
};
const statusSel = {
  padding: '5px 8px', borderRadius: 999, border: 'none', fontSize: 11.5, cursor: 'pointer', fontWeight: 700,
};
const assignBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
  border: '1.5px solid #F2701D', background: '#FFF4EC', color: '#C2410C', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
};
const svcChip = {
  fontSize: 11.5, fontWeight: 700, color: '#047857', background: '#ECFDF5',
  borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
};
const accTag = { fontSize: 11, color: '#949494', background: '#F3F0EA', borderRadius: 999, padding: '2px 8px' };
const linkStyle = { fontSize: 12.5, color: '#2563EB', textDecoration: 'none', fontWeight: 600 };
const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#949494', padding: 4, display: 'flex',
};
const fieldLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginBottom: 4 };
const input = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8',
  fontSize: 13, background: '#FAF9F7', boxSizing: 'border-box', fontFamily: 'inherit', color: '#161616',
};
