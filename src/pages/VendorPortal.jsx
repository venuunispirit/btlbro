import React, { useState, useEffect, useCallback } from 'react';
import { Truck, LogOut, RefreshCw, Plus, Check, Loader2, AlertTriangle, Wallet } from 'lucide-react';

// The vendor's own portal. A completely separate identity from staff and
// customers: /api/vendors/* issues a vendor token, and a vendor token is
// rejected by both the staff and customer APIs. A vendor can see their own
// bills and payouts, and raise a bill for work the default rate did not cover.

const TOKEN_KEY = 'btl_vendor_token';
const VENDOR_KEY = 'btl_vendor_user';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const readVendor = () => { try { return JSON.parse(localStorage.getItem(VENDOR_KEY) || 'null'); } catch { return null; } };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};

// The server sends lead { id, name } and falls back to "Lead #N" when the lead
// has no name yet, so only show the id when it adds information.
function leadCell(lead) {
  if (!lead) return null;
  const name = lead.name || `Lead #${lead.id}`;
  return name === `Lead #${lead.id}` ? name : `${name} · Lead #${lead.id}`;
}

const BILL = {
  pending:  { label: 'Awaiting approval', bg: '#FEF3C7', color: '#B45309' },
  approved: { label: 'Approved',           bg: '#E0F2FE', color: '#0369A1' },
  paid:     { label: 'Paid',               bg: '#ECFDF5', color: '#059669' },
  rejected: { label: 'Rejected',           bg: '#FEF2F2', color: '#DC2626' },
  cancelled:{ label: 'Cancelled',          bg: '#F3F0EA', color: '#949494' },
};

const PAY = {
  awaiting:   { label: 'Awaiting confirmation', bg: '#FEF3C7', color: '#B45309' },
  processing: { label: 'Processing',            bg: '#E0F2FE', color: '#0369A1' },
  paid:       { label: 'Paid',                  bg: '#ECFDF5', color: '#059669' },
  failed:     { label: 'Failed',                bg: '#FEF2F2', color: '#DC2626' },
  cancelled:  { label: 'Cancelled',             bg: '#F3F0EA', color: '#949494' },
};

function Pill({ map, status }) {
  const m = map[status] || { label: status, bg: '#F3F0EA', color: '#949494' };
  return <span style={{ ...s.pill, background: m.bg, color: m.color }}>{m.label}</span>;
}

export default function VendorPortal() {
  const [vendor, setVendor] = useState(readVendor());
  const [data, setData] = useState(null);
  const [mode, setMode] = useState(readToken() ? 'portal' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [reg, setReg] = useState({ name: '', business_name: '', phone: '', upi_id: '', category: '', rate: '', password: '' });
  const [billAmt, setBillAmt] = useState('');
  const [billDesc, setBillDesc] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(async () => {
    if (!readToken()) return;
    try {
      setData(await api('/api/vendors/me'));
    } catch (err) {
      // Token expired or the account was switched off.
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(VENDOR_KEY);
      setVendor(null); setData(null); setMode('login');
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function persist(payload) {
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(VENDOR_KEY, JSON.stringify(payload.vendor));
    setVendor(payload.vendor);
    setMode('portal');
    load();
  }

  async function submitLogin(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      persist(await api('/api/vendors/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function submitRegister(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      persist(await api('/api/vendors/register', {
        method: 'POST',
        body: JSON.stringify({ ...reg, rate: reg.rate === '' ? null : Number(reg.rate) }),
      }));
      flash('Welcome — your account is ready');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function submitBill(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/vendors/bills', { method: 'POST', body: JSON.stringify({ amount: Number(billAmt), description: billDesc }) });
      setBillAmt(''); setBillDesc('');
      flash('Bill submitted — our team will review it');
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api('/api/vendors/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(VENDOR_KEY);
    setVendor(null); setData(null); setMode('login');
  }

  // ---------- auth screens ----------
  if (mode === 'login' || mode === 'register') {
    return (
      <div style={s.authPage}>
        <div style={s.authCard}>
          <div style={s.brand}>BTL<span style={{ color: '#F2701D' }}>bro</span> <span style={s.brandTag}>Vendors</span></div>

          {toast && <div style={s.toast}>{toast}</div>}
          {error && <div style={s.error}><AlertTriangle size={14} /> {error}</div>}

          {mode === 'login' ? (
            <form onSubmit={submitLogin} style={s.form}>
              <h2 style={s.h2}>Sign in</h2>
              <p style={s.sub}>See your bills and payouts.</p>
              <label style={s.field}>
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
              </label>
              <label style={s.field}>
                <span>Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
              </label>
              <button type="submit" disabled={busy} style={s.primaryBtn}>
                {busy ? <Loader2 size={15} className="spin" /> : null} Sign in
              </button>
              <button type="button" onClick={() => { setMode('register'); setError(''); }} style={s.linkBtn}>
                New vendor? Register here
              </button>
            </form>
          ) : (
            <form onSubmit={submitRegister} style={s.form}>
              <h2 style={s.h2}>Register</h2>
              <p style={s.sub}>Set up your account so we can pay you for work.</p>
              <div style={s.grid2}>
                <label style={s.field}><span>Your name *</span>
                  <input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required placeholder="Ramesh Kumar" /></label>
                <label style={s.field}><span>Business name</span>
                  <input value={reg.business_name} onChange={(e) => setReg({ ...reg, business_name: e.target.value })} placeholder="Ramesh Print House" /></label>
                <label style={s.field}><span>Email *</span>
                  <input type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} required /></label>
                <label style={s.field}><span>Phone</span>
                  <input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="98765 43210" /></label>
                <label style={s.field}><span>UPI ID we should pay *</span>
                  <input value={reg.upi_id} onChange={(e) => setReg({ ...reg, upi_id: e.target.value })} required placeholder="name@bank" /></label>
                <label style={s.field}><span>Work you do</span>
                  <input value={reg.category} onChange={(e) => setReg({ ...reg, category: e.target.value })} placeholder="Printing" /></label>
                <label style={s.field}><span>Rate per lead (₹)</span>
                  <input type="number" min="0" value={reg.rate} onChange={(e) => setReg({ ...reg, rate: e.target.value })} placeholder="450" /></label>
                <label style={s.field}><span>Password *</span>
                  <input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required placeholder="min 6 characters" /></label>
              </div>
              <button type="submit" disabled={busy} style={s.primaryBtn}>
                {busy ? <Loader2 size={15} className="spin" /> : null} Create account
              </button>
              <button type="button" onClick={() => { setMode('login'); setError(''); }} style={s.linkBtn}>
                Already registered? Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ---------- portal ----------
  const t = data?.totals || {};
  const bills = data?.bills || [];
  const payouts = data?.payouts || [];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>{vendor?.business_name || vendor?.name}</h2>
          <p style={s.sub}>Your bills and payouts.</p>
        </div>
        <div style={s.rowActions}>
          <button onClick={load} style={s.iconBtn} title="Refresh"><RefreshCw size={15} /></button>
          <button onClick={logout} style={s.ghostBtn}><LogOut size={14} /> Sign out</button>
        </div>
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
      {error && <div style={s.error}><AlertTriangle size={14} /> {error}</div>}

      <div style={s.tiles}>
        <div style={s.tile}>
          <div style={s.tileLabel}>Awaiting approval</div>
          <div style={{ ...s.tileValue, color: '#B45309' }}>{inr(t.pending)}</div>
          <div style={s.tileHint}>Bills we've not approved yet</div>
        </div>
        <div style={s.tile}>
          <div style={s.tileLabel}>Approved, unpaid</div>
          <div style={{ ...s.tileValue, color: '#0369A1' }}>{inr(t.approved_unpaid)}</div>
          <div style={s.tileHint}>Scheduled to be paid</div>
        </div>
        <div style={s.tile}>
          <div style={s.tileLabel}>In flight</div>
          <div style={{ ...s.tileValue, color: '#B45309' }}>{inr(t.in_flight)}</div>
          <div style={s.tileHint}>Sent, awaiting confirmation</div>
        </div>
        <div style={s.tile}>
          <div style={s.tileLabel}>Paid to you</div>
          <div style={{ ...s.tileValue, color: '#059669' }}>{inr(t.paid)}</div>
          <div style={s.tileHint}>All time</div>
        </div>
      </div>

      {!vendor?.upi_id && (
        <div style={s.note}>
          <AlertTriangle size={13} />
          You have no UPI ID on file, so we cannot pay you yet. Add it from the register page or
          reply to your registration email.
        </div>
      )}

      <form onSubmit={submitBill} style={s.card}>
        <div style={s.cardTitle}>Submit a bill</div>
        <p style={s.sub}>For work the standard rate did not cover.</p>
        <div style={s.grid2}>
          <label style={s.field}><span>Amount (₹) *</span>
            <input type="number" min="1" step="1" value={billAmt} onChange={(e) => setBillAmt(e.target.value)} required placeholder="900" /></label>
          <label style={s.field}><span>What it is for</span>
            <input value={billDesc} onChange={(e) => setBillDesc(e.target.value)} placeholder="50 standees for the Noida campaign" /></label>
        </div>
        <div style={s.cardActions}>
          <button type="submit" disabled={busy} style={s.primaryBtn}>
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Submit bill
          </button>
        </div>
      </form>

      <h3 style={s.sectionTitle}>Your bills</h3>
      {bills.length === 0 ? (
        <div style={s.empty}>
          <Truck size={26} color="#C9C2B4" />
          <div style={s.emptyTitle}>No bills yet</div>
          <div style={s.emptyHint}>Bills appear here when work is assigned to you.</div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead><tr><th>Description</th><th>For</th><th>Amount</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td style={s.strong}>{b.description}</td>
                  <td style={s.dim}>
                    {b.lead ? leadCell(b.lead) : b.order_id ? `Order #${b.order_id}` : 'General'}
                  </td>
                  <td style={s.strong}>{inr(b.amount)}</td>
                  <td><Pill map={BILL} status={b.status} /></td>
                  <td style={s.dim}>{fmtDT(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={s.sectionTitle}>Payouts</h3>
      {payouts.length === 0 ? (
        <div style={s.empty}>
          <Wallet size={26} color="#C9C2B4" />
          <div style={s.emptyTitle}>No payouts yet</div>
          <div style={s.emptyHint}>Once a bill is approved and sent, it shows up here.</div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead><tr><th>Reference</th><th>Note</th><th>Amount</th><th>Status</th><th>Paid on</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...s.dim, fontFamily: 'ui-monospace, monospace' }}>{p.reference}</td>
                  <td>{p.note}</td>
                  <td style={s.strong}>{inr(p.amount)}</td>
                  <td><Pill map={PAY} status={p.status} /></td>
                  <td style={s.dim}>{p.paid_at ? fmtDT(p.paid_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={s.footnote}>
        Every payout we send you is recorded against your account and appears here the moment it
        is confirmed by the bank.
      </div>
    </div>
  );
}

const s = {
  page: { padding: 20, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, color: '#161616', maxWidth: 1040, margin: '0 auto' },
  authPage: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF9F7', fontFamily: 'Inter, system-ui, sans-serif', padding: 20 },
  authCard: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 14, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 1px 3px rgba(22,22,22,0.04)' },
  brand: { fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 18 },
  brandTag: { fontSize: 11, fontWeight: 600, color: '#949494', marginLeft: 6, letterSpacing: '0.02em' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  h2: { margin: 0, fontSize: 19, fontWeight: 700 },
  sub: { margin: 0, fontSize: 12, color: '#4A4A4A', lineHeight: 1.5 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#4A4A4A', fontWeight: 600 },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: '#F2701D', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  linkBtn: { background: 'none', border: 'none', color: '#F2701D', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#4A4A4A',
    border: '1px solid #E7E2D8', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  iconBtn: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8, padding: 7, cursor: 'pointer', display: 'inline-flex', color: '#4A4A4A' },
  toast: { background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12 },
  error: { display: 'flex', alignItems: 'center', gap: 6, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12 },
  note: { display: 'flex', alignItems: 'center', gap: 7, background: '#FEF9E7', color: '#B45309', border: '1px solid #FDE68A', borderRadius: 8, padding: '9px 12px', marginBottom: 14, fontSize: 12 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  tile: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, padding: '12px 14px' },
  tileLabel: { fontSize: 11, color: '#949494', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' },
  tileValue: { fontSize: 20, fontWeight: 700, marginTop: 4 },
  tileHint: { fontSize: 11, color: '#949494', marginTop: 3 },
  card: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  sectionTitle: { fontSize: 13, fontWeight: 700, margin: '18px 0 8px' },
  tableWrap: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  pill: { display: 'inline-block', padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 },
  strong: { fontWeight: 600 },
  dim: { color: '#949494', fontSize: 11 },
  rowActions: { display: 'flex', gap: 8, alignItems: 'center' },
  empty: { textAlign: 'center', padding: '32px 20px', color: '#949494', fontSize: 12, background: '#FAF9F7', border: '1px dashed #E7E2D8', borderRadius: 12 },
  emptyTitle: { fontSize: 13, fontWeight: 700, color: '#4A4A4A', marginTop: 8 },
  emptyHint: { fontSize: 12, marginTop: 4 },
  footnote: { fontSize: 11, color: '#949494', marginTop: 16, lineHeight: 1.5 },
};
