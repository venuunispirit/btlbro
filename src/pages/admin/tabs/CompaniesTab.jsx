import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, RefreshCw, Search, Wallet, MessageSquare, Phone, FileText,
  Target, CheckCircle2, ChevronLeft, User, AlertTriangle, Clock,
} from 'lucide-react';
import { getCompanies, getCompany, updateCompany } from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';

// Companies — one row per customer business, drill-down to the relationship.
//
// This tab is the customer RELATIONSHIP view: who the business is, who we
// speak to, every lead and every conversation. Money deliberately lives in the
// separate Accounts tab — reconciliation and payouts are not a company
// concern, and mixing them here made both harder to read.

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

const fmtDT = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const LEAD_STATUS_COLORS = {
  new: { bg: '#EFF6FF', color: '#2563EB' },
  assigned: { bg: '#FEF3C7', color: '#B45309' },
  in_followup: { bg: '#F3E8FF', color: '#7C3AED' },
  qualified: { bg: '#ECFDF5', color: '#059669' },
  in_operations: { bg: '#DBEAFE', color: '#1D4ED8' },
  completed: { bg: '#D1FAE5', color: '#065F46' },
  cold: { bg: '#FEE2E2', color: '#DC2626' },
};

// One icon per timeline event kind. Kept flat and exhaustive on purpose — an
// unknown kind falls back to a dot rather than rendering nothing.
const EVENT_ICONS = {
  company: Building2,
  lead: Target,
  assignment: User,
  status_change: CheckCircle2,
  cold: AlertTriangle,
  chat: MessageSquare,
  call: Phone,
  note: FileText,
  payment: Wallet,
  activity: Clock,
};

function Pill({ children, bg, color }) {
  return (
    <span style={{ ...s.pill, background: bg, color }}>
      {children}
    </span>
  );
}

export default function CompaniesTab({ onNavigate }) {
  const search = useGlobalSearch();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getCompanies();
      setCompanies(res.companies || []);
    } catch (e) {
      setError(e.message || 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    setEditing(false);
    try {
      const res = await getCompany(id);
      setDetail(res);
      setDraft({
        name: res.company.name || '',
        contact_name: res.company.contact_name || '',
        phone: res.company.phone || '',
        email: res.company.email || '',
        category: res.company.category || '',
        pincode: res.company.pincode || '',
      });
    } catch (e) {
      setError(e.message || 'Failed to load company');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch the open drill-down whenever the list refreshes, so a payment
  // confirmed elsewhere shows up without the user re-clicking into the company.
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = search.trim().toLowerCase();
  const visible = companies.filter((c) => {
    if (!term) return true;
    return [c.name, c.contact_name, c.phone, c.email, c.category, c.pincode]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term));
  });

  async function saveEdit() {
    try {
      const res = await updateCompany(selectedId, draft);
      setDetail((d) => ({ ...d, company: res.company }));
      setEditing(false);
      flash('Company updated');
      load();
    } catch (e) {
      setError(e.message || 'Failed to update company');
    }
  }

  // ------------------------------------------------------------- list view --
  if (!selectedId) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          {/* The topbar renders the page title already. */}
          <p style={s.sub}>Every customer business, with its leads and conversations in one place.</p>
          <button onClick={load} style={s.iconBtn} title="Refresh"><RefreshCw size={15} /></button>
        </div>

        {toast && <div style={s.toast}>{toast}</div>}
        {error && <div style={s.error}><AlertTriangle size={14} /> {error}</div>}
        {term && (
          <div style={s.searchNote}><Search size={12} /> Filtering by “{search}” — use the top search bar</div>
        )}

        {loading ? (
          <div style={s.empty}>Loading companies…</div>
        ) : visible.length === 0 ? (
          <div style={s.empty}>
            <Building2 size={28} color="#C9C2B4" />
            <div style={s.emptyTitle}>{companies.length === 0 ? 'No companies yet' : 'No companies match your search'}</div>
            <div style={s.emptyHint}>
              {companies.length === 0
                ? 'Companies are created automatically the moment a lead comes in from checkout or the campaign form.'
                : 'Try a different name, phone or PIN code.'}
            </div>
          </div>
        ) : (
          <div style={s.grid}>
            {visible.map((c) => (
              <button key={c.id} style={s.card} onClick={() => setSelectedId(c.id)}>
                <div style={s.cardTop}>
                  <div style={s.avatar}><Building2 size={16} /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.cardName}>{c.name}</div>
                    <div style={s.cardRep}>
                      {c.contact_name || <span style={{ color: '#949494' }}>No representative yet</span>}
                    </div>
                  </div>
                </div>

                <div style={s.cardMeta}>
                  {c.category && <Pill bg="#F3F0EA" color="#4A4A4A">{c.category}</Pill>}
                  {c.pincode && <Pill bg="#F3F0EA" color="#4A4A4A">PIN {c.pincode}</Pill>}
                  <Pill bg="#F3F0EA" color="#4A4A4A">{c.lead_count} lead{c.lead_count === 1 ? '' : 's'}</Pill>
                </div>

                <div style={s.cardFoot}>
                  <Clock size={11} /> {fmtDT(c.last_activity_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------- drill-down view --
  if (detailLoading || !detail) {
    return (
      <div style={s.page}>
        <button style={s.back} onClick={() => setSelectedId(null)}><ChevronLeft size={15} /> Back to companies</button>
        <div style={s.empty}>{detailLoading ? 'Loading company…' : error || 'Company not available'}</div>
      </div>
    );
  }

  const { company, leads = [], conversations = [], timeline = [] } = detail;
  const dirty = editing && Object.keys(draft).some((k) => (draft[k] || '') !== (company[k] || ''));

  return (
    <div style={s.page}>
      <button style={s.back} onClick={() => setSelectedId(null)}><ChevronLeft size={15} /> Back to companies</button>

      {toast && <div style={s.toast}>{toast}</div>}
      {error && <div style={s.error}><AlertTriangle size={14} /> {error}</div>}

      <div style={s.header}>
        <div style={{ minWidth: 0 }}>
          <h2 style={s.h2}>{company.name}</h2>
          <p style={s.sub}>
            {company.contact_name && <>Representative · <strong>{company.contact_name}</strong></>}
            {company.phone && <> · {company.phone}</>}
            {company.email && <> · {company.email}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {editing ? (
            <>
              <button style={s.btnGhost} onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
              <button style={s.btnPrimary} onClick={saveEdit} disabled={!dirty}>Save</button>
            </>
          ) : (
            <>
              <button style={s.btnGhost} onClick={() => onNavigate?.('chat', { leadId: company.primary_lead_id })} disabled={!company.phone}>
                <MessageSquare size={14} /> Message
              </button>
              <button style={s.btnGhost} onClick={() => setEditing(true)}>Edit details</button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div style={s.editCard}>
          <div style={s.editGrid}>
            {[
              ['name', 'Company name'],
              ['contact_name', 'Representative'],
              ['phone', 'Phone'],
              ['email', 'Email'],
              ['category', 'Category'],
              ['pincode', 'PIN code'],
            ].map(([key, label]) => (
              <label key={key} style={s.field}>
                <span style={s.fieldLabel}>{label}</span>
                <input
                  style={s.input}
                  value={draft[key] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p style={s.editHint}>
            Renaming a company that matches an existing one is refused — merge those instead of renaming.
          </p>
        </div>
      )}

      <div style={s.split}>
        {/* ------------------------------------------------------ timeline -- */}
        <div style={s.card}>
          <div style={s.cardHead}>
            <span style={s.cardHeadTitle}>Timeline</span>
            <span style={s.cardHeadSub}>{timeline.length} events</span>
          </div>
          {timeline.length === 0 ? (
            <div style={s.emptyHint}>Nothing has happened on this company yet.</div>
          ) : (
            <div style={s.rail}>
              {[...timeline].reverse().map((e, i) => {
                const Icon = EVENT_ICONS[e.kind] || Clock;
                const tone = e.kind === 'payment'
                  ? (e.direction === 'out' ? '#B45309' : '#0F766E')
                  : e.kind === 'cold' ? '#DC2626' : '#F2701D';
                return (
                  <div key={i} style={s.railItem}>
                    <div style={{ ...s.railIcon, color: tone, borderColor: tone }}>
                      <Icon size={12} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={s.railTitle}>
                        {e.title}
                        {typeof e.amount === 'number' && (
                          <span style={{ ...s.railAmount, color: tone }}>{INR(e.amount)}</span>
                        )}
                      </div>
                      {e.detail && <div style={s.railDetail}>{e.detail}</div>}
                      <div style={s.railMeta}>
                        {fmtDT(e.at)}{e.actor ? ` · ${e.actor}` : ''}
                        {e.lead_id ? ' · from a lead' : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------- leads + chat -- */}
        <div style={s.sideCol}>
          <div style={s.card}>
            <div style={s.cardHead}>
              <span style={s.cardHeadTitle}>Leads</span>
              <span style={s.cardHeadSub}>{leads.length}</span>
            </div>
            {leads.length === 0 ? (
              <div style={s.emptyHint}>No leads on this company.</div>
            ) : (
              leads.map((l) => (
                <div key={l.id} style={s.row}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.rowTitle}>{l.contactName || 'Unnamed contact'}</div>
                    <div style={s.rowSub}>
                      {fmtDT(l.created_at)} · via {l.source || 'unknown'}
                    </div>
                  </div>
                  {LEAD_STATUS_COLORS[l.status] && (
                    <Pill bg={LEAD_STATUS_COLORS[l.status].bg} color={LEAD_STATUS_COLORS[l.status].color}>
                      {l.status}
                    </Pill>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={s.card}>
            <div style={s.cardHead}>
              <span style={s.cardHeadTitle}>Conversations</span>
              <span style={s.cardHeadSub}>{conversations.length}</span>
            </div>
            {conversations.length === 0 ? (
              <div style={s.emptyHint}>No WhatsApp thread yet.</div>
            ) : (
              conversations.map((c) => (
                <div key={c.id} style={s.row}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.rowTitle}>{c.customer_name || c.customer_phone || 'Thread'}</div>
                    <div style={s.rowSub}>
                      {c.customer_phone} · {(c.messages || []).length} messages · {fmtDT(c.last_msg_at)}
                    </div>
                  </div>
                  <button style={s.btnGhost} onClick={() => onNavigate?.('chat')}>Open chat</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

/**
 * Template variables for a company. Money is deliberately left out: a company
 * rollup spans many leads, so any total we could quote here would be the sum
 * across campaigns the representative may not even know about yet.
 */
function companyWaCtx(company = {}, detail) {
  const leads = detail?.leads?.length || company.leads_count || 0;
  return {
    name: company.contact_name || '',
    business: company.name || '',
    locations: leads,
  };
}

const s = {
  page: { padding: '20px 24px 40px', fontFamily: 'Inter, system-ui, sans-serif', color: '#161616' },
  scrim: {
    position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.32)', zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  waSheet: { width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  h2: { margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' },
  sub: { margin: '4px 0 0', fontSize: 12.5, color: '#4A4A4A' },
  back: {
    display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, padding: '5px 10px',
    background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 8, color: '#4A4A4A',
    fontSize: 12, cursor: 'pointer',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  card: {
    display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', cursor: 'pointer',
    background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, padding: 14, font: 'inherit',
  },
  cardTop: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: {
    width: 32, height: 32, borderRadius: 8, background: '#fff', border: '1px solid #E7E2D8',
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F2701D', flexShrink: 0,
  },
  cardName: { fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardRep: { fontSize: 12, color: '#4A4A4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardMeta: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  cardFoot: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#949494' },
  split: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' },
  sideCol: { display: 'flex', flexDirection: 'column', gap: 14 },
  cardHead: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    padding: '12px 14px', borderBottom: '1px solid #E7E2D8',
  },
  cardHeadTitle: { fontSize: 13, fontWeight: 600 },
  cardHeadSub: { fontSize: 11.5, color: '#949494' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F1EDE4' },
  rowTitle: { fontSize: 12.5, fontWeight: 550 },
  rowSub: { fontSize: 11, color: '#949494', marginTop: 2 },
  rail: { padding: '14px 14px 6px' },
  railItem: { display: 'flex', gap: 10, paddingBottom: 14, position: 'relative' },
  railIcon: {
    width: 24, height: 24, borderRadius: '50%', border: '1px solid', background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1,
  },
  railTitle: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, fontWeight: 550 },
  railDetail: { fontSize: 12, color: '#4A4A4A', marginTop: 2, wordBreak: 'break-word' },
  railMeta: { fontSize: 10.5, color: '#949494', marginTop: 3 },
  pill: { display: 'inline-block', padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 600 },
  empty: { padding: 40, textAlign: 'center', color: '#4A4A4A', fontSize: 13 },
  emptyTitle: { marginTop: 8, fontSize: 13.5, fontWeight: 600, color: '#161616' },
  emptyHint: { marginTop: 4, fontSize: 12, color: '#949494' },
  searchNote: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#949494', marginBottom: 10 },
  toast: {
    marginBottom: 12, padding: '9px 12px', borderRadius: 8, fontSize: 12.5,
    background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '9px 12px', borderRadius: 8,
    fontSize: 12.5, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C',
  },
  iconBtn: {
    padding: 7, background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 8,
    color: '#4A4A4A', cursor: 'pointer', display: 'flex',
  },
  btnPrimary: {
    padding: '7px 14px', background: '#F2701D', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  btnGhost: {
    padding: '7px 12px', background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 8,
    color: '#4A4A4A', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  editCard: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, padding: 14, marginBottom: 16 },
  editGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 11, color: '#4A4A4A', fontWeight: 550 },
  input: {
    padding: '7px 9px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
    fontSize: 12.5, font: 'inherit', color: '#161616',
  },
  editHint: { margin: '10px 0 0', fontSize: 11, color: '#949494' },
};
