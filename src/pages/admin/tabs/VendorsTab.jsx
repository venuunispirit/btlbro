import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck, RefreshCw, Plus, Trash2, Pencil, X, Check, AlertTriangle, Ban,
  IndianRupee, Search, ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  getVendors, createVendor, updateVendor,
  createVendorService, updateVendorService, deleteVendorService,
} from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';

// Vendors — the supplier directory.
//
// This tab deliberately holds NO money actions. Committing money to a supplier
// is a Purchase Order, and paying an invoice is a bill: both of those live on
// the Accounts tab, where the ledger is. What stays here is the setup that
// makes those possible — who the supplier is, how we pay them, and what they
// sell at what rate.
//
// The service catalogue is the important part. A vendor usually offers several
// things at several prices, and a PO line is priced from this list on the
// server, so the rate can never be typed in (or tampered with) at PO time.

// The server sends lead { id, name } and falls back to "Lead #N" when the lead
// has no name yet, so only show the id when it adds information.
const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const blankService = { name: '', unit: 'unit', rate: '' };
const blankVendor = { name: '', business_name: '', email: '', phone: '', upi_id: '', upi_name: '', category: '' };

function Tile({ label, value, hint }) {
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileValue}>{value}</div>
      {hint && <div style={s.tileHint}>{hint}</div>}
    </div>
  );
}

/** One row in a vendor's price list. Doubles as the add form. */
function ServiceRow({ vendorId, service, onSaved, onRemoved }) {
  const [editing, setEditing] = useState(!service);
  const [draft, setDraft] = useState(
    service ? { name: service.name, unit: service.unit || 'unit', rate: String(service.rate ?? '') } : { ...blankService },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    if (!draft.name.trim()) return setError('Give the service a name');
    if (!(Number(draft.rate) > 0)) return setError('Enter a rate greater than zero');
    setBusy(true);
    try {
      const payload = { name: draft.name.trim(), unit: draft.unit.trim() || 'unit', rate: Number(draft.rate) };
      const res = service
        ? await updateVendorService(vendorId, service.id, payload)
        : await createVendorService(vendorId, payload);
      onSaved();
      if (!service) { setDraft({ ...blankService }); setEditing(true); }
      else setEditing(false);
      return res;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await deleteVendorService(vendorId, service.id);
      onRemoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <tr style={s.tr}>
        <td style={s.td}>{service.name}</td>
        <td style={s.td}>{service.unit || 'unit'}</td>
        <td style={s.tdRight}>{inr(service.rate)}</td>
        <td style={s.tdRight}>
          <div style={s.rowActions}>
            <button style={s.smallGhost} onClick={() => { setDraft({ name: service.name, unit: service.unit || 'unit', rate: String(service.rate ?? '') }); setEditing(true); }}>
              <Pencil size={11} /> Edit
            </button>
            <button
              style={s.smallGhost}
              onClick={remove}
              disabled={busy}
              title="Retire this service. Existing purchase orders keep their quoted rate."
            >
              <Trash2 size={11} /> Remove
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr style={s.tr}>
      <td style={s.td}>
        <input
          autoFocus
          style={s.input}
          placeholder="Standee 2x4 ft"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </td>
      <td style={s.td}>
        <input
          style={{ ...s.input, width: 90 }}
          placeholder="unit"
          value={draft.unit}
          onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
        />
      </td>
      <td style={s.tdRight}>
        <input
          style={{ ...s.input, width: 100, textAlign: 'right' }}
          inputMode="decimal"
          placeholder="0.00"
          value={draft.rate}
          onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
        />
      </td>
      <td style={s.tdRight}>
        <div style={s.rowActions}>
          <button style={s.smallBtn} onClick={save} disabled={busy}><Check size={11} /> Save</button>
          {service && <button style={s.smallGhost} onClick={() => setEditing(false)} disabled={busy}><X size={11} /></button>}
          {error && <span style={s.errInline}>{error}</span>}
        </div>
      </td>
    </tr>
  );
}

export default function VendorsTab({ onNavigate }) {
  const search = useGlobalSearch();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ ...blankVendor });
  const [open, setOpen] = useState({});

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getVendors();
      setVendors(res.vendors || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addVendor(e) {
    e.preventDefault();
    setError('');
    if (!draft.name.trim() || !draft.email.trim()) return setError('Name and email are required');
    setSaving(true);
    try {
      await createVendor(draft);
      setDraft({ ...blankVendor });
      setShowForm(false);
      flash('Vendor registered');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(v) {
    setError('');
    try {
      await updateVendor(v.id, { is_active: !v.is_active });
      flash(v.is_active ? `${v.name} deactivated` : `${v.name} reactivated`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => vendors.filter((v) => {
    if (!term) return true;
    return [v.name, v.business_name, v.email, v.phone, v.category, v.upi_id]
      .filter(Boolean).some((x) => String(x).toLowerCase().includes(term));
  }), [vendors, term]);

  const servicesCount = vendors.reduce(
    (n, v) => n + (v.services || []).filter((x) => x.is_active !== false).length, 0,
  );

  return (
    <div style={s.page}>
      <div style={s.header}>
        {/* The topbar owns the page title; this line explains the page. */}
        <p style={s.sub}>
          Suppliers you buy work from — contact details, the UPI ID you pay them on, and
          the price list their purchase orders are drawn from.
        </p>
        <div style={s.headerActions}>
          <button style={s.ghostBtn} onClick={() => setShowForm((v) => !v)}>
            <Plus size={13} /> {showForm ? 'Cancel' : 'Register vendor'}
          </button>
          <button style={s.iconBtn} onClick={load} title="Refresh"><RefreshCw size={15} /></button>
        </div>
      </div>

      {toast && <div style={s.toast}><Check size={13} /> {toast}</div>}
      {error && <div style={s.error}><AlertTriangle size={13} /> {error}</div>}

      <div style={s.tiles}>
        <Tile label="Suppliers" value={vendors.length} hint="Registered and payable" />
        <Tile label="Active" value={vendors.filter((v) => v.is_active !== false).length} hint="Can receive purchase orders" />
        <Tile label="Services on file" value={servicesCount} hint="Rates available to a PO" />
      </div>

      {showForm && (
        <form onSubmit={addVendor} style={s.card}>
          <div style={s.cardTitle}>Register a vendor</div>
          <div style={s.grid3}>
            <label style={s.field}>Contact name
              <input style={s.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label style={s.field}>Business name
              <input style={s.input} value={draft.business_name} onChange={(e) => setDraft({ ...draft, business_name: e.target.value })} />
            </label>
            <label style={s.field}>Email
              <input style={s.input} type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </label>
            <label style={s.field}>Phone
              <input style={s.input} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
            <label style={s.field}>UPI ID
              <input style={s.input} placeholder="name@bank" value={draft.upi_id} onChange={(e) => setDraft({ ...draft, upi_id: e.target.value })} />
            </label>
            <label style={s.field}>UPI payee name
              <input style={s.input} value={draft.upi_name} onChange={(e) => setDraft({ ...draft, upi_name: e.target.value })} />
            </label>
            <label style={s.field}>What they supply
              <input style={s.input} placeholder="Printing, photography…" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </label>
          </div>
          <p style={s.formHint}>
            A password is generated after saving and shared with the vendor so they can sign in
            to their own portal and see what they have billed.
          </p>
          <div style={s.cardActions}>
            <button type="submit" style={s.primaryBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Register vendor'}
            </button>
          </div>
        </form>
      )}

      <div style={s.tableWrap}>
        {loading ? (
          <div style={s.empty}>Loading vendors…</div>
        ) : visible.length === 0 ? (
          <div style={s.empty}>
            <Truck size={26} color="#C9C2B4" />
            <div style={s.emptyTitle}>{vendors.length === 0 ? 'No vendors yet' : 'No vendors match your search'}</div>
            <div style={s.emptyHint}>
              {vendors.length === 0
                ? 'Register your first supplier above, then add what they sell and at what rate.'
                : 'Try a different name, email or category.'}
            </div>
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr style={{ background: '#FAF9F7' }}>
                <th style={s.th} />
                <th style={s.th}>Vendor</th>
                <th style={s.th}>UPI ID</th>
                <th style={s.thRight}>Services</th>
                <th style={s.th}>Added</th>
                <th style={s.thRight}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => {
                const live = (v.services || []).filter((x) => x.is_active !== false);
                const isOpen = !!open[v.id];
                return (
                  <React.Fragment key={v.id}>
                    <tr style={{ ...s.tr, background: v.is_active === false ? '#FAF9F7' : undefined }}>
                      <td style={s.td}>
                        <button
                          style={s.iconBtn}
                          onClick={() => setOpen((o) => ({ ...o, [v.id]: !o[v.id] }))}
                          title={isOpen ? 'Hide price list' : 'Show price list'}
                        >
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td style={s.td}>
                        <div style={s.strong}>{v.business_name || v.name}</div>
                        <div style={s.dim}>{v.name}{v.email ? ` · ${v.email}` : ''}</div>
                        {v.category && <div style={s.dimSmall}>{v.category}</div>}
                      </td>
                      <td style={s.td}>
                        {v.upi_id
                          ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{v.upi_id}</span>
                          : <span style={s.warn}>No UPI ID</span>}
                      </td>
                      <td style={s.tdRight}>
                        {live.length === 0
                          ? <span style={s.warn}>None yet</span>
                          : <span style={s.strong}>{live.length}</span>}
                      </td>
                      <td style={s.td}>{fmtDT(v.created_at)}</td>
                      <td style={s.tdRight}>
                        <div style={s.rowActions}>
                          {v.is_active === false
                            ? <span style={s.badgeOff}>Inactive</span>
                            : <span style={s.badgeOn}>Active</span>}
                          <button style={s.smallGhost} onClick={() => toggleActive(v)}>
                            {v.is_active === false ? 'Reactivate' : <><Ban size={11} /> Deactivate</>}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 16px 16px', background: '#FCFBF9', borderBottom: '1px solid #E7E2D8' }}>
                          <div style={s.catalogueHead}>
                            <div>
                              <div style={s.strong}>Price list</div>
                              <div style={s.dim}>
                                Purchase orders are priced from this list, at up to {live.length} service{live.length === 1 ? '' : 's'}.
                              </div>
                            </div>
                          </div>
                          <table style={s.table}>
                            <thead>
                              <tr>
                                <th style={s.th}>Service</th>
                                <th style={s.th}>Unit</th>
                                <th style={s.thRight}>Rate (excl. GST)</th>
                                <th style={s.thRight} />
                              </tr>
                            </thead>
                            <tbody>
                              {live.map((svc) => (
                                <ServiceRow
                                  key={svc.id}
                                  vendorId={v.id}
                                  service={svc}
                                  onSaved={load}
                                  onRemoved={() => { flash('Service removed'); load(); }}
                                />
                              ))}
                              <ServiceRow vendorId={v.id} service={null} onSaved={() => { flash('Service added'); load(); }} />
                            </tbody>
                          </table>
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

      <p style={s.footnote}>
        {onNavigate && (
          <>
            Committed money lives on <button style={s.smallLink} onClick={() => onNavigate('accounts')}>Accounts</button> —{' '}
          </>
        )}
        raise a purchase order to commit to a vendor's work, then settle their bill there.
        Your suppliers can sign in at <strong>/vendor</strong> to see what they have billed and been paid.
      </p>
    </div>
  );
}

const s = {
  page: { padding: 20, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, color: '#161616' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 14 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },
  h2: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' },
  sub: { margin: 0, fontSize: 12, color: '#4A4A4A', maxWidth: 620, lineHeight: 1.5 },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F2701D', color: '#fff',
    border: 'none', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#4A4A4A',
    border: '1px solid #E7E2D8', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  iconBtn: {
    background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8, padding: 6, cursor: 'pointer',
    display: 'inline-flex', color: '#4A4A4A',
  },
  toast: {
    display: 'flex', alignItems: 'center', gap: 6, background: '#ECFDF5', color: '#059669',
    border: '1px solid #A7F3D0', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12, fontWeight: 500,
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, background: '#FEF2F2', color: '#DC2626',
    border: '1px solid #FECACA', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12,
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 },
  tile: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, padding: '12px 14px' },
  tileLabel: { fontSize: 11, color: '#949494', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' },
  tileValue: { fontSize: 20, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em' },
  tileHint: { fontSize: 11, color: '#949494', marginTop: 3 },
  card: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, marginBottom: 12 },
  cardActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#4A4A4A', fontWeight: 600 },
  input: {
    padding: '7px 9px', border: '1px solid #E7E2D8', borderRadius: 8, fontSize: 12,
    color: '#161616', background: '#fff', fontFamily: 'inherit', fontWeight: 400,
  },
  formHint: { fontSize: 11, color: '#949494', margin: '12px 0 0', lineHeight: 1.5 },
  tableWrap: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '9px 14px', fontSize: 11, fontWeight: 600, color: '#949494',
    borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right', padding: '9px 14px', fontSize: 11, fontWeight: 600, color: '#949494',
    borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #F1EDE4' },
  td: { padding: '10px 14px', verticalAlign: 'top' },
  tdRight: { padding: '10px 14px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' },
  strong: { fontWeight: 600 },
  dim: { color: '#949494', fontSize: 11, marginTop: 1 },
  dimSmall: { color: '#949494', fontSize: 10.5, marginTop: 1 },
  warn: { color: '#B45309', fontSize: 10.5, fontWeight: 600 },
  errInline: { color: '#DC2626', fontSize: 10.5 },
  rowActions: { display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' },
  smallBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F2701D', color: '#fff',
    border: 'none', borderRadius: 6, padding: '5px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  smallGhost: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: '#4A4A4A',
    border: '1px solid #E7E2D8', borderRadius: 6, padding: '5px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  // Borderless: this sits inside a sentence, and a button outline mid-sentence
  // reads as a broken control rather than a link.
  smallLink: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: '#F2701D', fontSize: 11.5, fontWeight: 600,
    textDecoration: 'underline', textUnderlineOffset: 2, fontFamily: 'inherit',
  },
  badgeOn: { background: '#ECFDF5', color: '#059669', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 700 },
  badgeOff: { background: '#F3F0EA', color: '#949494', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 700 },
  catalogueHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 0 8px' },
  empty: { textAlign: 'center', padding: '44px 20px', color: '#949494', fontSize: 12 },
  emptyTitle: { fontSize: 14, fontWeight: 700, color: '#4A4A4A', marginTop: 10 },
  emptyHint: { fontSize: 12, marginTop: 5, lineHeight: 1.5 },
  footnote: { fontSize: 11, color: '#949494', marginTop: 14, lineHeight: 1.6 },
};
