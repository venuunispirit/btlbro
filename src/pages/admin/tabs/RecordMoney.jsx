import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wallet, Loader2, Check, X, ExternalLink, AlertTriangle, TrendingUp, TrendingDown,
  QrCode, Copy, Pencil, IndianRupee,
} from 'lucide-react';
import QRCode from 'qrcode';
import { getMoneyFor, collectFor, getStaffUser } from '../api.js';

// Money panel for ONE lead or ONE order.
//
// The Leads and Orders tabs are relationship views, but a team still needs to
// answer "what has this actually cost us / what are they still holding?" on the
// record in front of them, not by cross-referencing the ledger. This reads the
// same attributed rollup the ledger uses, so the numbers cannot drift.
//
// Vendor payouts appear here too, which is the point: a lead that cost us
// ₹4,500 to serve shows that as spend next to what the customer paid us.

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Mirrors the server's PAYOUT_ROLES. Collect is a money action, so anyone
// without it gets the read-only rollup instead of a button that 403s.
const MONEY_ROLES = ['manager', 'bdm', 'ops_manager', 'super_admin'];
const canMoveMoney = () => MONEY_ROLES.includes(getStaffUser()?.role || '');

const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function RecordMoney({ kind, id, defaultAmount, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The collect flow is its own modal. `open` is null when closed, 'form' while
  // asking for the amount, and 'qr' once the request exists and there is
  // something to hand the customer. Keeping it one variable means there is only
  // ever one collect dialog — a second layer would be unreachable.
  const [open, setOpen] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // The amount is fixed until deliberately edited. Asking for money should be
  // one click, not a form you have to fill in correctly.
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState(null);
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState('');
  const [toast, setToast] = useState('');
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    // Spinner only before the first result; afterwards refresh in place so an
    // open collect form / UPI intent survives its own reload.
    setLoading((was) => was && !loadedOnce.current ? true : false);
    loadedOnce.current = true;
    setError('');
    try {
      setData(await getMoneyFor(kind, id));
    } catch (err) {
      // A role without payout access cannot read the rollup at all. Stay quiet
      // rather than showing an error box in the middle of a customer record.
      setError(err.status === 403 ? '' : (err.message || 'Could not load the money summary'));
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await collectFor(kind, id, { amount: Number(amount), note });
      const uri = res.intent_uri || res.intent?.uri || null;
      setIntent(uri);
      // Keep the dialog open and show the QR straight away. Closing it here
      // threw away the one thing the operator needs to send to the customer.
      setIssued({ reference: res.reference, amount: Number(amount) });
      setOpen('qr');
      setEditing(false);
      flash('Request created — the ledger row is attributed to this record.');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not create the collection request');
    } finally { setBusy(false); }
  }

  function flash(m) { setError(''); setToast(m); setTimeout(() => setToast(''), 3500); }

  /** Start a fresh request. Resets the QR so a stale one is never re-shown. */
  function openCollect() {
    setAmount(defaultAmount ? String(defaultAmount) : '');
    setNote('');
    setEditing(false);
    setIntent(null);
    setIssued(null);
    setError('');
    setOpen('form');
  }

  /** Re-open an existing pending request so its QR can be shared again. */
  function openQrFor(payment) {
    setIntent(payment.intent_uri || null);
    setIssued({ reference: payment.reference, amount: Number(payment.amount) });
    setAmount(String(payment.amount ?? ''));
    setEditing(false);
    setError('');
    setOpen('qr');
  }

  function closeCollect() {
    setOpen(null); setIntent(null); setIssued(null); setEditing(false); setError('');
  }

  // Escape closes the collect dialog first. Without this, Escape while the QR
  // was open tore down the whole lead record, losing the customer's context.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCollect(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (loading && !data) {
    return <div style={s.wrap}><span style={s.muted}><Loader2 size={12} className="spin" /> Loading money…</span></div>;
  }
  if (!data) return null; // no access, or nothing to show

  const netPositive = data.net >= 0;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.stats}>
          <span style={s.stat}><TrendingUp size={12} color="#059669" /> received <strong>{inr(data.received)}</strong></span>
          <span style={s.stat}><TrendingDown size={12} color="#DC2626" /> spent <strong>{inr(data.spent)}</strong></span>
          {(data.pending_in > 0 || data.pending_out > 0) && (
            <span style={s.statWarn}>
              {data.pending_in > 0 && `awaiting ${inr(data.pending_in)} in`}
              {data.pending_in > 0 && data.pending_out > 0 && ' · '}
              {data.pending_out > 0 && `${inr(data.pending_out)} to pay`}
            </span>
          )}
          <span style={{ ...s.stat, color: netPositive ? '#059669' : '#DC2626' }}>
            net <strong>{netPositive ? '+' : ''}{inr(data.net)}</strong>
          </span>
        </div>

        {canMoveMoney() && (
          <button onClick={openCollect} style={s.collectBtn}>
            <IndianRupee size={12} /> Collect{defaultAmount ? ` ${inr(defaultAmount)}` : ''}
          </button>
        )}
      </div>

      {toast && <div style={s.toast}><Check size={12} /> {toast}</div>}
      {error && <div style={s.error}><AlertTriangle size={12} /> {error}</div>}

      {/* ---- the collect dialog ----
          A separate layer rather than an inline form, so the lead record stays
          visible behind it and closing the dialog returns you to exactly where
          you were. Backdrop and Escape are handled here only — they must not
          reach the parent record's handlers. */}
      {open && (
        <div
          style={m.scrim}
          onClick={closeCollect}
          role="dialog"
          aria-modal="true"
          aria-label="Collect payment"
        >
          <div style={m.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={m.head}>
              <div>
                <div style={m.title}>{open === 'qr' ? 'Payment request created' : 'Collect payment'}</div>
                <div style={m.sub}>
                  {kind === 'lead' ? 'Lead' : 'Order'} #{id} · the request becomes a ledger row
                  attributed to this record.
                </div>
              </div>
              <button onClick={closeCollect} style={m.close} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div style={m.body}>
              {open === 'form' ? (
                <>
                  <div style={m.label}>Amount</div>
                  {editing ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={m.inputWrap}>
                        <IndianRupee size={14} style={{ color: '#949494' }} />
                        <input
                          type="number" min="1" step="1" autoFocus
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="bare-input"
                          style={m.input}
                        />
                      </div>
                      <button onClick={() => setEditing(false)} style={m.ghost}>Cancel</button>
                    </div>
                  ) : (
                    // Fixed until deliberately edited: the number is already
                    // worked out, so asking you to retype it is pure friction.
                    // With no amount to offer, say so rather than showing a
                    // confident-looking "₹0" and a disabled "Request ₹0".
                    <div style={Number(amount) > 0 ? m.amountBox : m.amountBoxEmpty}>
                      {Number(amount) > 0 ? (
                        <div style={m.amount}>{inr(Number(amount))}</div>
                      ) : (
                        <div>
                          <div style={m.amountNone}>No amount outstanding</div>
                          <div style={m.amountNoneHint}>
                            Set what to ask for — nothing is pending on this record.
                          </div>
                        </div>
                      )}
                      <button onClick={() => setEditing(true)} style={m.editBtn}>
                        <Pencil size={12} /> {Number(amount) > 0 ? 'Edit' : 'Set amount'}
                      </button>
                    </div>
                  )}

                  <div style={{ ...m.label, marginTop: 16 }}>Note (optional)</div>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={`Campaign payment for ${kind} #${id}`}
                    style={{ ...m.input, width: '100%' }}
                  />

                  {error && (
                    <div style={m.error}><AlertTriangle size={12} /> {error}</div>
                  )}

                  <div style={m.actions}>
                    <button onClick={closeCollect} style={m.ghost}>Cancel</button>
                    <button
                      onClick={submit}
                      disabled={busy || !(Number(amount) > 0)}
                      style={m.primary}
                    >
                      {busy ? <Loader2 size={13} className="spin" /> : <IndianRupee size={13} />}
                      {busy ? 'Creating…' : `Request ₹${(Number(amount) || 0).toLocaleString('en-IN')}`}
                    </button>
                  </div>
                </>
              ) : (
                <CollectQr
                  uri={intent}
                  issued={issued}
                  onClose={closeCollect}
                  copied={copied}
                  setCopied={setCopied}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* No payments yet. Without this the panel is a lone summary strip on an
          otherwise empty page, which reads as a broken widget rather than a
          lead nobody has charged yet. */}
      {data && !data.payments?.length && !intent && (
        <div style={s.empty}>
          Nothing has been collected against this record yet.
          Use <strong>Collect</strong> to raise the booking amount or the next
          instalment — the request becomes a ledger row attributed to this lead.
        </div>
      )}

      {data.payments?.length > 0 && (
        <div style={t.wrap}>
          <table style={t.table}>
            <thead>
              <tr>
                <th style={{ ...t.th, width: t.colRef }}>Reference</th>
                <th style={{ ...t.th, width: t.colType }}>Type</th>
                <th style={{ ...t.thRight, width: t.colAmount, paddingRight: 24 }}>Amount</th>
                <th style={{ ...t.th, width: t.colStatus }}>Status</th>
                <th style={{ ...t.th, width: t.colRaised }}>Raised</th>
                <th style={{ ...t.thRight, width: t.colAction }} />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => {
                const pending = ['awaiting', 'processing'].includes(p.status);
                // A pending request is the one the customer still has to act on,
                // so it is the one worth reopening: click it for the QR again.
                const openable = p.direction !== 'out' && pending && !!p.intent_uri;
                const tone = p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'danger' : 'warn';
                return (
                  <tr
                    key={p.id}
                    style={openable ? t.rowOpen : t.row}
                    onClick={openable ? () => openQrFor(p) : undefined}
                    role={openable ? 'button' : undefined}
                    tabIndex={openable ? 0 : undefined}
                    onKeyDown={openable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openQrFor(p); } } : undefined}
                    title={openable ? 'Show the payment request again' : undefined}
                  >
                    <td style={t.tdMono}>
                      {p.reference}
                      {p.note && <div style={t.tdNote}>{p.note}</div>}
                    </td>
                    <td style={t.td}>
                      {/* Direction and state are different things. "Received"
                          next to "pending" read as a contradiction; an inbound
                          request that has not landed is "Requested". */}
                      <span style={{ ...t.tag, ...(p.direction === 'out' ? t.tagOut : t.tagIn) }}>
                        {p.direction === 'out' ? 'Paid out' : pending ? 'Requested' : 'Received'}
                      </span>
                    </td>
                    <td style={t.tdRight}>
                      <span style={t.amount}>{inr(p.amount)}</span>
                    </td>
                    <td style={t.td}>
                      <span style={{ ...t.status, ...t[`status_${tone}`] }}>{p.status === 'awaiting' ? 'pending' : p.status}</span>
                    </td>
                    <td style={t.td}>{fmtDT(p.paid_at || p.created_at)}</td>
                    <td style={t.tdRight}>
                      {openable ? (
                        <span style={t.qrHint}><QrCode size={13} /> show QR</span>
                      ) : p.status === 'paid' ? (
                        <span style={t.settled}><Check size={12} /> settled</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

/** Render a string as a QR data URL. Mirrors the helper in PaymentsTab. */
function useQr(text) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    let alive = true;
    if (!text) { setDataUrl(''); return undefined; }
    QRCode.toDataURL(text, {
      width: 300, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#161616', light: '#FFFFFF' },
    })
      .then((url) => { if (alive) setDataUrl(url); })
      .catch(() => { if (alive) setDataUrl(''); });
    return () => { alive = false; };
  }, [text]);
  return dataUrl;
}

/** Copy to clipboard with a short confirmation the caller renders. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      // Fallback for a non-secure context, where the async clipboard API is
      // unavailable and the UPI link has to travel another way.
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    return true;
  } catch { return false; }
}

/**
 * The QR pane. Shown immediately after requesting, and again whenever a pending
 * row is clicked — a customer who says "I didn't get it" needs the same link
 * re-sent, not a new request.
 */
function CollectQr({ uri, issued, onClose, copied, setCopied }) {
  const dataUrl = useQr(uri);
  const shareText = uri
    ? `Pay ₹${(Number(issued?.amount) || 0).toLocaleString('en-IN')} to BTLbro — reference ${issued?.reference || ''}`.trim()
    : '';

  async function copy(what, value) {
    if (await copyText(value)) {
      setCopied(what);
      setTimeout(() => setCopied(''), 2200);
    }
  }

  return (
    <>
      <div style={q.amountBox}>
        <div style={q.amountLabel}>Amount requested</div>
        <div style={q.amount}>{inr(issued?.amount || 0)}</div>
        {issued?.reference && <div style={q.ref}>Ref {issued.reference}</div>}
      </div>

      {uri ? (
        <>
          {dataUrl ? (
            <img src={dataUrl} alt="UPI payment QR code" style={q.img} />
          ) : (
            <div style={{ ...q.img, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#949494', fontSize: 12 }}>
              <Loader2 size={16} className="spin" style={{ marginRight: 8 }} /> Building QR…
            </div>
          )}

          <div style={q.shareRow}>
            <button style={q.copyBtn} onClick={() => copy('link', uri)}>
              {copied === 'link' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'link' ? 'Link copied' : 'Copy payment link'}
            </button>
            <button style={q.copyBtn} onClick={() => copy('text', shareText)} disabled={!shareText}>
              {copied === 'text' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'text' ? 'Message copied' : 'Copy message'}
            </button>
          </div>

          <a href={uri} className="upi-intent" style={q.openBtn}>
            <ExternalLink size={13} /> Open in UPI app
          </a>

          <div style={q.hint}>
            Send the QR or the link to the customer. Once they approve, the payment settles and
            this row moves to <strong>paid</strong> on its own.
          </div>
        </>
      ) : (
        <div style={q.hint}>
          The request was recorded but no UPI link came back. Check the collection VPA in
          Settings, then mark the payment manually from the Accounts tab.
        </div>
      )}

      <div style={m.actions}>
        <button onClick={onClose} style={m.primary}>Done</button>
      </div>
    </>
  );
}

// The collect dialog. Higher z-index than the lead record modal it sits on top
// of, and a scrim dark enough to read as a distinct layer above it.
const m = {
  scrim: {
    position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(22,22,22,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  sheet: {
    background: '#fff', borderRadius: 14, width: 460, maxWidth: '100%',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 70px rgba(0,0,0,0.3)',
  },
  head: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
    padding: '16px 18px', borderBottom: '1px solid #E7E2D8', flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: 700, color: '#161616' },
  sub: { fontSize: 11.5, color: '#949494', marginTop: 2, lineHeight: 1.45 },
  close: {
    background: 'none', border: '1px solid #E7E2D8', borderRadius: 8, width: 28, height: 28,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: '#4A4A4A', flexShrink: 0,
  },
  body: { padding: '18px', overflowY: 'auto' },
  label: {
    fontSize: 10.5, fontWeight: 700, color: '#949494', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 6,
  },
  inputWrap: {
    flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
    border: '1px solid #E7E2D8', borderRadius: 8, background: '#fff',
  },
  input: {
    flex: 1, padding: '8px 0', border: 'none', outline: 'none', fontSize: 14,
    fontFamily: 'inherit', fontWeight: 600, color: '#161616', minWidth: 0,
  },
  amountBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '14px 16px', background: '#FFF4EC', border: '1px solid #F2C9A8', borderRadius: 10,
  },
  amount: { fontSize: 24, fontWeight: 700, color: '#C2410C', letterSpacing: '-0.02em' },
  // The "nothing to collect" state must not look like a ₹0 offer.
  amountBoxEmpty: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '12px 16px', background: '#FAF9F7', border: '1px dashed #E7E2D8', borderRadius: 10,
  },
  amountNone: { fontSize: 13.5, fontWeight: 650, color: '#4A4A4A' },
  amountNoneHint: { fontSize: 11.5, color: '#949494', marginTop: 2 },
  editBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff',
    border: '1px solid #F2C9A8', borderRadius: 8, padding: '6px 11px',
    fontSize: 12, fontWeight: 600, color: '#7A2E0E', cursor: 'pointer', fontFamily: 'inherit',
  },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, alignItems: 'center' },
  ghost: {
    padding: '9px 14px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
    fontSize: 12.5, fontWeight: 600, color: '#4A4A4A', cursor: 'pointer', fontFamily: 'inherit',
  },
  primary: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px',
    background: '#F2701D', color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '8px 11px',
    background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
    fontSize: 12, color: '#B91C1C',
  },
};

// The payment log. A real <table> with aligned columns, because the old flex
// row had no headers and fixed-width spans, so "₹9,999" and "pending" were
// indistinguishable at a glance and the row read as a footnote.
const t = {
  // No card. A bordered box inside the modal, wrapped around a table that
  // already has its own header, read as a container inside a container and
  // made the tab look heavier than the content warranted.
  wrap: { marginTop: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' },
  colRef: { width: '34%' },
  colType: { width: '15%' },
  colAmount: { width: '14%' },
  colStatus: { width: '13%' },
  colRaised: { width: '17%' },
  colAction: { width: '7%' },
  th: {
    textAlign: 'left', padding: '0 14px 8px 0', fontSize: 10, fontWeight: 700,
    color: '#949494', textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right', padding: '0 20px 7px 20px', fontSize: 10, fontWeight: 700,
    color: '#949494', textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap',
  },
  row: { borderBottom: '1px solid #F1EDE4', paddingLeft: 12 },
  rowLast: {},
  rowOpen: {
    borderBottom: '1px solid #F1EDE4', cursor: 'pointer', background: '#FFFBF7',
    // The bar lives in the row's left padding. Previously it was flush with the
    // cell edge while the cell had no left padding, so it sliced through the
    // first character of the reference.
    boxShadow: 'inset 3px 0 0 #F2701D', paddingLeft: 12,
  },
  td: { padding: '14px 14px 14px 0', verticalAlign: 'top', color: '#4A4A4A' },
  tdRight: { padding: '14px 0 14px 14px', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' },
  tdMono: {
    padding: '14px 14px 14px 0', verticalAlign: 'top',
    fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: '#161616',
  },
  tdNote: {
    fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, color: '#949494',
    marginTop: 3,
  },
  amount: { fontWeight: 700, fontSize: 12.5, color: '#161616', fontVariantNumeric: 'tabular-nums' },
  tag: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  },
  tagIn: { background: '#ECFDF5', color: '#047857' },
  tagOut: { background: '#FEF2F2', color: '#B91C1C' },
  status: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 6,
    fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
  },
  status_ok: { background: '#ECFDF5', color: '#047857' },
  status_warn: { background: '#FEF3C7', color: '#B45309' },
  status_danger: { background: '#FEF2F2', color: '#B91C1C' },
  qrHint: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10.5, fontWeight: 700, color: '#B45309', whiteSpace: 'nowrap',
  },
  settled: {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: 10.5, fontWeight: 600, color: '#059669', whiteSpace: 'nowrap',
  },
};

// The QR pane.
const q = {
  amountBox: {
    textAlign: 'center', padding: '14px 16px', background: '#FAF9F7',
    border: '1px solid #E7E2D8', borderRadius: 10, marginBottom: 16,
  },
  amountLabel: { fontSize: 10.5, fontWeight: 700, color: '#949494', textTransform: 'uppercase', letterSpacing: '0.05em' },
  amount: { fontSize: 26, fontWeight: 700, color: '#161616', marginTop: 3, letterSpacing: '-0.02em' },
  ref: { fontSize: 11, color: '#949494', marginTop: 3, fontFamily: 'ui-monospace, monospace' },
  img: {
    width: 220, height: 220, display: 'block', margin: '0 auto 14px',
    border: '1px solid #E7E2D8', borderRadius: 10, background: '#fff',
  },
  shareRow: { display: 'flex', gap: 8, marginBottom: 10 },
  copyBtn: {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '9px 12px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
    fontSize: 12, fontWeight: 600, color: '#4A4A4A', cursor: 'pointer', fontFamily: 'inherit',
  },
  openBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
    padding: '10px 14px', background: '#F2701D', color: '#fff', borderRadius: 8,
    fontSize: 12.5, fontWeight: 600, textDecoration: 'none', marginBottom: 12,
  },
  hint: { fontSize: 11.5, color: '#949494', lineHeight: 1.6, textAlign: 'center' },
};

// Warm-neutral house style, matching the rest of the admin.
const s = {
  wrap: { marginTop: 12 },
  head: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' },
  // The figure strip. Flat type on the page, no card, so the log beneath it
  // reads as the same surface rather than a box inside a box.
  stats: { display: 'flex', gap: 14, flexWrap: 'wrap', flex: 1, alignItems: 'center' },
  stat: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#4A4A4A' },
  statWarn: { fontSize: 11, color: '#B45309', fontWeight: 600, background: '#FEF3C7', borderRadius: 999, padding: '2px 8px' },
  collectBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: '#161616',
    border: '1px solid #E7E2D8', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  form: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: '#4A4A4A', fontWeight: 600, flex: '1 1 150px' },
  actions: { display: 'flex', gap: 6 },
  primary: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F2701D', color: '#fff',
    border: 'none', borderRadius: 6, padding: '7px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  ghost: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: '#4A4A4A',
    border: '1px solid #E7E2D8', borderRadius: 6, padding: '7px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  toast: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0', borderRadius: 6, padding: '5px 9px', fontSize: 11 },
  error: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 6, padding: '5px 9px', fontSize: 11 },
  intentBox: { marginTop: 10, padding: 10, background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8 },
  intentHead: { fontSize: 11.5, fontWeight: 700, marginBottom: 6 },
  intentLink: { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F2701D', color: '#fff', borderRadius: 6, padding: '7px 11px', fontSize: 11.5, fontWeight: 600, textDecoration: 'none' },
  intentHint: { fontSize: 11, color: '#949494', margin: '8px 0', lineHeight: 1.5 },
  rowDir: { fontWeight: 700, fontSize: 10, width: 62 },
  rowNote: { color: '#4A4A4A', flex: 1, minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowAmt: { fontWeight: 700, width: 68, textAlign: 'right' },
  rowStatus: { fontSize: 10, color: '#949494', width: 62 },
  rowDate: { fontSize: 10, color: '#949494', width: 96, textAlign: 'right' },
  empty: {
    marginTop: 12, padding: '18px 16px', textAlign: 'center',
    background: '#FAF9F7', border: '1px dashed #E7E2D8', borderRadius: 10,
    fontSize: 12, color: '#949494', lineHeight: 1.6,
  },
  more: { fontSize: 10.5, color: '#949494', marginTop: 4 },
  muted: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#949494' },
};
