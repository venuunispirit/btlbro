import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, RefreshCw, Search, Check, X, ArrowDownLeft, ArrowUpRight,
  Loader2, Building2, AlertTriangle, Link2, Unlink, Plus, FileText,
  ReceiptIndianRupee, ShieldCheck, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  getUpiLedger, getUpiSummary, updateUpiPayment, reconcileUpiPayment, getCompanies,
  getVendors, getVendorBills, approveVendorBill, rejectVendorBill,
  getPurchaseOrders, createPurchaseOrder, approvePurchaseOrder, rejectPurchaseOrder,
  billPurchaseOrder,
} from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';

// Accounts — the money side of the business.
//
// Deliberately separate from Companies (the customer relationship view). This
// tab owns the ledger, reconciliation and what each counterparty still owes.
// The company rollup it links to is read-only context: attaching a movement to
// a company is a deliberate act, never a name-based guess.
//
// Three views, because money moves in three steps and each step belongs to a
// different pair of eyes:
//
//   Purchase orders — committing to a vendor's work before it is owed. Priced
//                     on the server from the vendor's own rate list, so the
//                     browser cannot state a price. Raise → approve, and the
//                     person who raised it cannot approve it.
//   Bills          — a vendor's invoice against an approved PO. Only quantity
//                     that was ordered and not already invoiced can be claimed,
//                     so the same work cannot be billed twice.
//   Ledger         — the money itself, both directions.
//
// This is the whole vendor-billing flow. The Vendors tab is only the supplier
// directory: who they are, their UPI ID, and their price list.

const STATUS = {
  awaiting:   { label: 'Awaiting',   bg: '#FEF3C7', color: '#B45309' },
  processing: { label: 'Processing', bg: '#E0F2FE', color: '#0369A1' },
  paid:       { label: 'Paid',       bg: '#ECFDF5', color: '#059669' },
  failed:     { label: 'Failed',     bg: '#FEF2F2', color: '#DC2626' },
  cancelled:  { label: 'Cancelled',  bg: '#F3F0EA', color: '#949494' },
};

const BILL = {
  pending:   { label: 'Awaiting approval', bg: '#FEF3C7', color: '#B45309' },
  approved:  { label: 'Approved — pay now', bg: '#E0F2FE', color: '#0369A1' },
  paid:      { label: 'Paid',              bg: '#ECFDF5', color: '#059669' },
  rejected:  { label: 'Rejected',          bg: '#FEF2F2', color: '#DC2626' },
  cancelled: { label: 'Cancelled',         bg: '#F3F0EA', color: '#949494' },
};

const PO = {
  pending:    { label: 'Awaiting approval', bg: '#FEF3C7', color: '#B45309' },
  approved:   { label: 'Approved',           bg: '#E0F2FE', color: '#0369A1' },
  part_billed:{ label: 'Part billed',        bg: '#FFF4EC', color: '#F2701D' },
  billed:     { label: 'Fully billed',       bg: '#F1E9FD', color: '#6D28D9' },
  completed:  { label: 'Closed',             bg: '#ECFDF5', color: '#059669' },
  rejected:   { label: 'Rejected',           bg: '#FEF2F2', color: '#DC2626' },
  cancelled:  { label: 'Cancelled',          bg: '#F3F0EA', color: '#949494' },
};

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDT = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function StatusPill({ status }) {
  const m = STATUS[status] || { label: status, bg: '#F3F0EA', color: '#949494' };
  return <span style={{ ...s.pill, background: m.bg, color: m.color }}>{m.label}</span>;
}

function Pill({ map, status }) {
  const m = map[status] || { label: status, bg: '#F3F0EA', color: '#949494' };
  return <span style={{ ...s.pill, background: m.bg, color: m.color }}>{m.label}</span>;
}

function Tile({ label, value, tone, icon }) {
  return (
    <div style={s.tile}>
      <span style={s.tileLabel}>{icon}{label}</span>
      <span style={{ ...s.tileValue, color: tone }}>{inr(value)}</span>
    </div>
  );
}

// ===========================================================================
// Purchase orders
// ===========================================================================

/** Line-item editor. Only service_id + qty leave the browser — the server prices it. */
function PoLineEditor({ vendor, lines, onChange, billable }) {
  const services = (vendor?.services || []).filter((x) => x.is_active !== false);
  const remaining = new Map(
    (vendor?.services || []).map((x) => [x.id, x]),
  );
  // When billing an existing PO, cap each line at what is still unbilled.
  const caps = (billable?.progress) || null;

  if (!services.length) {
    return (
      <div style={s.warnBox}>
        {vendor.name} has no services on their price list yet. Add one on the Vendors tab
        before raising a purchase order.
      </div>
    );
  }

  function setQty(serviceId, value) {
    const next = lines.filter((l) => l.service_id !== serviceId || Number(value) > 0);
    const qty = Number(value);
    if (Number.isInteger(qty) && qty > 0) next.push({ service_id: serviceId, qty });
    onChange(next);
  }

  return (
    <div style={s.lineBox}>
      {services.map((svc) => {
        const line = lines.find((l) => l.service_id === svc.id);
        const cap = caps ? (caps.find((p) => p.service_id === svc.id)?.billed_qty ?? 0) : null;
        const ordered = caps?.find((p) => p.service_id === svc.id);
        return (
          <div key={svc.id} style={s.lineRow}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={s.strong}>{svc.name}</div>
              <div style={s.dim}>
                {inr(svc.rate)} per {svc.unit || 'unit'}
                {cap != null && <> · ordered {ordered?.qty ?? 0}, already billed {cap}</>}
              </div>
            </div>
            <input
              style={{ ...s.input, width: 96, textAlign: 'right' }}
              inputMode="numeric"
              placeholder="0"
              value={line?.qty ?? ''}
              onChange={(e) => setQty(svc.id, e.target.value)}
            />
            <div style={{ ...s.dim, width: 110, textAlign: 'right' }}>
              {line ? inr(svc.rate * line.qty) : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RaisePoForm({ vendors, onDone, onError }) {
  const [vendorId, setVendorId] = useState('');
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');
  const [saving, setSaving] = useState(false);

  const vendor = vendors.find((v) => v.id === Number(vendorId));
  const withServices = vendors.filter((v) => (v.services || []).some((x) => x.is_active !== false));

  // Indicative only. The server recomputes rate x qty, GST and total from the
  // vendor's catalogue, and its number is the one that gets stored.
  const estimate = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => {
      const svc = (vendor?.services || []).find((x) => x.id === l.service_id);
      return sum + (Number(svc?.rate) || 0) * l.qty;
    }, 0);
    const gst = subtotal * 0.18;
    return { subtotal, gst, total: subtotal + gst };
  }, [lines, vendor]);

  async function submit(e) {
    e.preventDefault();
    if (!vendorId) return onError('Choose a vendor');
    if (!lines.length) return onError('Enter a quantity for at least one service');
    setSaving(true);
    try {
      await createPurchaseOrder({
        vendor_id: Number(vendorId),
        lines,
        notes,
        expected_date: expected,
      });
      setLines([]);
      setNotes('');
      setExpected('');
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={s.card}>
      <div style={s.cardTitle}>Raise a purchase order</div>
      <p style={s.formHint}>
        Committing to a vendor's work, not paying it. Prices come from their rate list and
        are recalculated by the server.
      </p>
      <div style={s.grid2}>
        <label style={s.field}>Vendor
          <select style={s.input} value={vendorId} onChange={(e) => { setVendorId(e.target.value); setLines([]); }}>
            <option value="">Choose a vendor…</option>
            {withServices.map((v) => (
              <option key={v.id} value={v.id}>{v.business_name || v.name}</option>
            ))}
          </select>
        </label>
        <label style={s.field}>Expected by
          <input style={s.input} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </label>
      </div>

      {vendor && (
        <>
          <div style={s.subHead}>What are you ordering?</div>
          <PoLineEditor vendor={vendor} lines={lines} onChange={setLines} />
        </>
      )}

      {lines.length > 0 && (
        <div style={s.estimate}>
          <div style={s.estRow}><span>Subtotal</span><span>{inr(estimate.subtotal)}</span></div>
          <div style={s.estRow}><span>GST (18%)</span><span>{inr(estimate.gst)}</span></div>
          <div style={{ ...s.estRow, fontWeight: 700, fontSize: 13 }}><span>Total</span><span>{inr(estimate.total)}</span></div>
        </div>
      )}

      <label style={{ ...s.field, marginTop: 12 }}>Notes
        <input style={s.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the vendor should know" />
      </label>

      <div style={s.cardActions}>
        <button type="submit" style={s.primaryBtn} disabled={saving}>
          {saving ? 'Raising…' : 'Raise purchase order'}
        </button>
      </div>
    </form>
  );
}

function PosView({ pos, vendors, reload, flash, fail, busy, setBusy, meId }) {
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billLines, setBillLines] = useState([]);

  async function approve(po) {
    setBusy(true);
    try {
      await approvePurchaseOrder(po.id);
      flash(`${po.po_number} approved`);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function reject(po) {
    const reason = window.prompt(`Reject ${po.po_number}? Say why:`, '');
    if (!reason) return;
    setBusy(true);
    try {
      await rejectPurchaseOrder(po.id, reason);
      flash(`${po.po_number} rejected`);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function submitBill(e) {
    e.preventDefault();
    if (!billLines.length) return fail('Enter how much is being billed');
    setBusy(true);
    try {
      await billPurchaseOrder(billing.id, { lines: billLines });
      flash(`Bill raised against ${billing.po_number}`);
      setBilling(null);
      setBillLines([]);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div style={s.cardHead}>
        <span style={s.cardHeadTitle}>
          <FileText size={13} /> Purchase orders
        </span>
        <button style={raising ? s.ghostBtn : s.primaryBtn} onClick={() => setRaising((v) => !v)}>
          <Plus size={13} /> {raising ? 'Cancel' : 'Raise purchase order'}
        </button>
      </div>

      {raising && <RaisePoForm vendors={vendors} onDone={() => { setRaising(false); flash('Purchase order raised'); reload(); }} onError={fail} />}

      {pos.length === 0 ? (
        <div style={s.empty}>
          <FileText size={26} color="#C9C2B4" />
          <div style={s.emptyTitle}>No purchase orders yet</div>
          <div style={s.emptyHint}>
            A purchase order commits you to a vendor's work before anything is owed. Raise one,
            have it approved, and the vendor can then bill against it.
          </div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th} />
                <th style={s.th}>PO</th>
                <th style={s.th}>Vendor</th>
                <th style={s.th}>Lines</th>
                <th style={s.thRight}>Value</th>
                <th style={s.th}>Billed</th>
                <th style={s.th}>Status</th>
                <th style={s.thRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => {
                const mine = meId != null && po.raised_by != null && Number(po.raised_by) === Number(meId);
                const isOpen = openId === po.id;
                return (
                  <React.Fragment key={po.id}>
                    <tr style={s.tr}>
                      <td style={s.td}>
                        <button style={s.iconBtn} onClick={() => setOpenId(isOpen ? null : po.id)} title="Details">
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      </td>
                      <td style={s.tdMono}>
                        {po.po_number}
                        <div style={s.tdSub}>by {po.raised_by_name || '—'}</div>
                      </td>
                      <td style={s.td}>{po.vendor?.business_name || po.vendor?.name || '—'}</td>
                      <td style={s.td}>
                        {(po.lines || []).length} line{(po.lines || []).length === 1 ? '' : 's'}
                      </td>
                      <td style={s.tdRight}>{inr(po.total)}</td>
                      <td style={s.tdRight}>{inr(po.billed_total)}</td>
                      <td style={s.td}><Pill map={PO} status={po.status} /></td>
                      <td style={s.tdRight}>
                        <div style={s.rowActions}>
                          {po.status === 'pending' && (
                            <>
                              <button
                                style={s.miniOk}
                                disabled={busy}
                                onClick={() => approve(po)}
                                title={mine ? 'You raised this, so someone else must approve it' : 'Approve this purchase order'}
                              >
                                <ShieldCheck size={12} /> Approve
                              </button>
                              <button style={s.miniGhost} disabled={busy} onClick={() => reject(po)}>Reject</button>
                            </>
                          )}
                          {['approved', 'part_billed'].includes(po.status) && (
                            <button
                              style={s.miniGhost}
                              onClick={() => { setBilling(po); setBillLines([]); }}
                            >
                              <ReceiptIndianRupee size={12} /> Bill it
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0 16px 16px', background: '#FCFBF9', borderBottom: '1px solid #E7E2D8' }}>
                          <div style={{ padding: '14px 0 6px' }}>
                            {(po.lines || []).map((l) => {
                              const prog = (po.progress || []).find((p) => p.service_id === l.service_id);
                              return (
                                <div key={l.service_id} style={s.lineRow}>
                                  <div style={{ flex: 1 }}>
                                    <div style={s.strong}>{l.name}</div>
                                    <div style={s.dim}>
                                      {l.qty} {l.unit}{l.qty === 1 ? '' : 's'} × {inr(l.rate)}
                                      {prog ? ` · billed ${prog.billed_qty} of ${l.qty}` : ''}
                                    </div>
                                  </div>
                                  <div style={{ ...s.strong, width: 110, textAlign: 'right' }}>{inr(l.amount)}</div>
                                </div>
                              );
                            })}
                            <div style={s.estRow}><span>Subtotal</span><span>{inr(po.subtotal)}</span></div>
                            <div style={s.estRow}><span>GST ({po.gst_rate}%)</span><span>{inr(po.gst)}</span></div>
                            <div style={{ ...s.estRow, fontWeight: 700, fontSize: 13 }}><span>Total</span><span>{inr(po.total)}</span></div>
                            {po.notes && <div style={{ ...s.dim, marginTop: 8 }}>{po.notes}</div>}
                            {po.approved_by_name && (
                              <div style={s.dim}>Approved by {po.approved_by_name} · {fmtDT(po.approved_at)}</div>
                            )}
                            {po.rejection_reason && (
                              <div style={s.warn}>Rejected: {po.rejection_reason}</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {billing && (
        <form onSubmit={submitBill} style={s.card}>
          <div style={s.cardTitle}>Bill {billing.po_number}</div>
          <p style={s.formHint}>
            Enter what the vendor has actually delivered. You cannot bill more than was ordered,
            and not the same quantity twice.
          </p>
          <PoLineEditor
            vendor={{ services: billing.lines.map((l) => ({ id: l.service_id, name: l.name, unit: l.unit, rate: l.rate, is_active: true })) }}
            lines={billLines}
            onChange={setBillLines}
            billable={billing}
          />
          <div style={s.cardActions}>
            <button type="button" style={s.ghostBtn} onClick={() => setBilling(null)}>Cancel</button>
            <button type="submit" style={s.primaryBtn} disabled={busy}>Raise bill</button>
          </div>
        </form>
      )}
    </>
  );
}

// ===========================================================================
// Vendor bills
// ===========================================================================

function BillsView({ bills, reload, flash, fail, busy, setBusy }) {
  const [pay, setPay] = useState(null);
  const [amount, setAmount] = useState('');
  const [intent, setIntent] = useState(null);

  async function approve(bill) {
    setPay(bill);
    setAmount(String(bill.amount ?? ''));
    setIntent(null);
  }

  async function confirmApprove() {
    setBusy(true);
    try {
      const res = await approveVendorBill(pay.id, { amount: Number(amount) });
      setIntent({ uri: res.intent_uri, payment: res.payment, bill: pay });
      flash('Approved — complete the payment');
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function markPaid() {
    setBusy(true);
    try {
      await updateUpiPayment(intent.payment.id, { status: 'paid' });
      setIntent(null);
      setPay(null);
      flash('Payment marked paid');
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function reject(bill) {
    const reason = window.prompt(`Reject this bill from ${bill.vendor?.name || 'this vendor'}?`, '');
    if (!reason) return;
    setBusy(true);
    try {
      await rejectVendorBill(bill.id, reason);
      flash('Bill rejected');
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div style={s.cardHead}>
        <span style={s.cardHeadTitle}><ReceiptIndianRupee size={13} /> Vendor bills</span>
        <span style={s.cardHeadSub}>{bills.length} bill{bills.length === 1 ? '' : 's'}</span>
      </div>

      {bills.length === 0 ? (
        <div style={s.empty}>
          <ReceiptIndianRupee size={26} color="#C9C2B4" />
          <div style={s.emptyTitle}>No vendor bills</div>
          <div style={s.emptyHint}>
            Bills appear here once raised against an approved purchase order, either by you or
            by the vendor from their portal.
          </div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Vendor</th>
                <th style={s.th}>PO</th>
                <th style={s.th}>For</th>
                <th style={s.th}>Note</th>
                <th style={s.thRight}>Amount</th>
                <th style={s.th}>Status</th>
                <th style={s.thRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} style={s.tr}>
                  <td style={s.td}>{b.vendor?.business_name || b.vendor?.name || '—'}</td>
                  <td style={s.tdMono}>{b.po?.po_number || '—'}</td>
                  <td style={s.td}>{b.lead ? `Lead #${b.lead.id}` : '—'}</td>
                  <td style={s.td}>
                    {b.description}
                    {(b.lines || []).length > 0 && (
                      <div style={s.tdSub}>
                        {(b.lines || []).map((l) => `${l.qty}× ${l.name}`).join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={s.tdRight}>{inr(b.amount)}</td>
                  <td style={s.td}><Pill map={BILL} status={b.status} /></td>
                  <td style={s.tdRight}>
                    <div style={s.rowActions}>
                      {b.status === 'pending' && (
                        <>
                          <button style={s.miniOk} disabled={busy} onClick={() => approve(b)}>
                            <Check size={12} /> Approve &amp; pay
                          </button>
                          <button style={s.miniGhost} disabled={busy} onClick={() => reject(b)}>Reject</button>
                        </>
                      )}
                      {b.status === 'approved' && (
                        <button style={s.miniGhost} disabled={busy} onClick={() => approve(b)}>Pay</button>
                      )}
                      {b.status === 'paid' && <span style={s.doneTag}>settled</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pay && !intent && (
        <div style={s.card}>
          <div style={s.cardTitle}>Approve &amp; pay {pay.vendor?.name}</div>
          <p style={s.formHint}>
            Approving records the payable and builds a UPI request. Open it in your UPI app,
            approve it there, then mark it paid below.
          </p>
          <div style={s.grid2}>
            <label style={s.field}>Amount to pay
              <input style={s.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <div style={s.field}>Vendor UPI
              <div style={{ ...s.input, background: '#FAF9F7', color: '#4A4A4A' }}>{pay.vendor?.upi_id || '—'}</div>
            </div>
          </div>
          <div style={s.cardActions}>
            <button style={s.ghostBtn} onClick={() => setPay(null)}>Cancel</button>
            <button style={s.primaryBtn} disabled={busy || !(Number(amount) > 0)} onClick={confirmApprove}>
              Approve {inr(amount)}
            </button>
          </div>
        </div>
      )}

      {intent && (
        <div style={s.card}>
          <div style={s.cardTitle}>Complete the payment</div>
          <div style={s.estimate}>
            <div style={s.estRow}><span>Vendor</span><span>{intent.bill.vendor?.name}</span></div>
            <div style={s.estRow}><span>Amount</span><span>{inr(intent.payment.amount)}</span></div>
            <div style={s.estRow}><span>Reference</span><span style={{ fontFamily: 'ui-monospace, monospace' }}>{intent.payment.reference}</span></div>
          </div>
          <div style={s.cardActions}>
            <a className="upi-intent" href={intent.uri} style={s.primaryLink}>
              <ExternalLink size={13} /> Open in UPI app
            </a>
            <button style={s.primaryBtn} disabled={busy} onClick={markPaid}>I have paid it</button>
            <button style={s.ghostBtn} onClick={() => { setIntent(null); setPay(null); }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Ledger
// ===========================================================================

function LedgerView({ ledger, companies, reload, flash, fail, busy, setBusy }) {
  const [filterDir, setFilterDir] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [linking, setLinking] = useState(null);
  const search = useGlobalSearch();

  async function setStatus(row, status) {
    setBusy(true);
    try {
      await updateUpiPayment(row.id, { status });
      flash(`Marked ${STATUS[status]?.label.toLowerCase() || status}`);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function handleReconcile(row) {
    setBusy(true);
    try {
      const res = await reconcileUpiPayment(row.id);
      flash(`PayU says: ${res.gateway?.status || res.payment?.status}`);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  async function linkToCompany(paymentId, companyId) {
    setBusy(true);
    try {
      await updateUpiPayment(paymentId, { company_id: companyId ? Number(companyId) : null });
      flash(companyId ? 'Movement linked to the account' : 'Link removed');
      setLinking(null);
      await reload();
    } catch (err) { fail(err.message); } finally { setBusy(false); }
  }

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => ledger.filter((p) => {
    if (filterDir !== 'all' && p.direction !== filterDir) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (!term) return true;
    return [p.reference, p.vpa, p.counterparty_name, p.note, p.counterparty_phone]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
  }), [ledger, filterDir, filterStatus, term]);

  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const unlinked = ledger.filter((p) => !p.company_id).length;

  return (
    <>
      <div style={s.cardHead}>
        <span style={s.cardHeadTitle}>
          Ledger
          {unlinked > 0 && (
            <span style={s.unlinkedBadge}><Unlink size={11} /> {unlinked} not linked to a company</span>
          )}
        </span>
        <span style={s.cardHeadSub}>{visible.length} of {ledger.length} movements</span>
      </div>

      <div style={s.toolbar}>
        {search && <span style={s.searchNote}><Search size={12} /> Filtering by “{search}”</span>}
        <div style={s.toolbarRight}>
          <select style={s.select} value={filterDir} onChange={(e) => setFilterDir(e.target.value)}>
            <option value="all">All directions</option>
            <option value="in">Incoming</option>
            <option value="out">Outgoing</option>
          </select>
          <select style={s.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={s.empty}>
          <Wallet size={26} color="#C9C2B4" />
          <div style={s.emptyTitle}>{ledger.length === 0 ? 'No movements yet' : 'No movements match these filters'}</div>
          <div style={s.emptyHint}>
            {ledger.length === 0
              ? 'Customer collections and vendor payouts both land here.'
              : 'Try clearing the search box or widening the filters.'}
          </div>
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Ref</th>
                <th style={s.th}>Direction</th>
                <th style={s.th}>Counterparty</th>
                <th style={s.th}>Account</th>
                <th style={s.th}>Note</th>
                <th style={s.thRight}>Amount</th>
                <th style={s.th}>Status</th>
                <th style={s.thRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const company = p.company_id ? byId.get(p.company_id) : null;
                return (
                  <tr key={p.id} style={s.tr}>
                    <td style={s.tdMono}>
                      {p.reference}
                      <div style={s.tdSub}>{p.rail || 'local'}{p.payu_txnid ? ' · payu' : ''}</div>
                    </td>
                    <td style={s.td}>
                      <span style={{ ...s.pill, background: p.direction === 'in' ? '#ECFDF5' : '#FEF3C7', color: p.direction === 'in' ? '#059669' : '#B45309' }}>
                        {p.direction === 'in' ? 'In' : 'Out'}
                      </span>
                    </td>
                    <td style={s.td}>
                      {p.counterparty_name || '—'}
                      {p.counterparty_phone && <div style={s.tdSub}>{p.counterparty_phone}</div>}
                    </td>
                    <td style={s.td}>
                      {linking === p.id ? (
                        <select autoFocus style={s.select} value={p.company_id || ''}
                          onChange={(e) => linkToCompany(p.id, e.target.value)} onBlur={() => setLinking(null)}>
                          <option value="">— unlinked —</option>
                          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : company ? (
                        <button style={s.linkBtn} onClick={() => setLinking(p.id)} title="Change the linked company">
                          <Building2 size={11} /> {company.name}
                        </button>
                      ) : (
                        <button style={s.linkBtnEmpty} onClick={() => setLinking(p.id)} title="Link this movement to a company">
                          <Link2 size={11} /> Link
                        </button>
                      )}
                    </td>
                    <td style={s.td}>
                      {p.note || '—'}
                      {p.failure_reason && <div style={{ ...s.tdSub, color: '#B91C1C' }}>{p.failure_reason}</div>}
                    </td>
                    <td style={s.tdRight}>{inr(p.amount)}</td>
                    <td style={s.td}><StatusPill status={p.status} /></td>
                    <td style={s.tdRight}>
                      <div style={s.rowActions}>
                        {p.payu_txnid && (
                          <button style={s.miniBtn} disabled={busy} onClick={() => handleReconcile(p)}>Reconcile</button>
                        )}
                        {(p.status === 'awaiting' || p.status === 'processing') && (
                          <>
                            <button style={s.miniOk} disabled={busy} onClick={() => setStatus(p, 'paid')} title="Mark as received">
                              <Check size={12} />
                            </button>
                            <button style={s.miniBad} disabled={busy} onClick={() => setStatus(p, 'cancelled')} title="Cancel this request">
                              <X size={12} />
                            </button>
                          </>
                        )}
                        {p.status === 'paid' && <span style={s.doneTag}>settled</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ===========================================================================

export default function AccountsTab({ onNavigate }) {
  const [view, setView] = useState('pos');
  const [ledger, setLedger] = useState([]);
  const [summary, setSummary] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [me, setMe] = useState(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);
  const fail = useCallback((msg) => setError(msg), []);

  const load = useCallback(async () => {
    setLoading(true);
    const [led, sum, cos, ven, p, b] = await Promise.allSettled([
      getUpiLedger(), getUpiSummary(), getCompanies(), getVendors(), getPurchaseOrders(), getVendorBills(),
    ]);
    if (led.status === 'fulfilled') setLedger(led.value.payments || []);
    if (sum.status === 'fulfilled') setSummary(sum.value);
    if (cos.status === 'fulfilled') setCompanies(cos.value.companies || []);
    if (ven.status === 'fulfilled') setVendors(ven.value.vendors || []);
    if (p.status === 'fulfilled') setPos(p.value.pos || []);
    if (b.status === 'fulfilled') setBills(b.value.bills || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Only used to tell you that you cannot approve your own purchase order,
  // rather than letting the click fail with a server error.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('btl_user');
      if (raw) setMe(JSON.parse(raw));
    } catch { /* not signed in to staff, nothing to compare */ }
  }, []);

  const committed = pos
    .filter((p) => !['rejected', 'cancelled'].includes(p.status))
    .reduce((n, p) => n + (Number(p.total) || 0), 0);
  const unpaid = bills.filter((b) => ['pending', 'approved'].includes(b.status))
    .reduce((n, b) => n + (Number(b.amount) || 0), 0);

  const TABS = [
    ['pos', 'Purchase orders', pos.length],
    ['bills', 'Vendor bills', bills.length],
    ['ledger', 'Ledger', ledger.length],
  ];

  return (
    <div style={s.page}>
      <div style={s.header}>
        {/* No heading here: the topbar already renders the page title, so a
            second one would read as two titles for one screen. This is the
            explanation of what the page is for. */}
        <p style={s.sub}>
          Commit to a vendor, settle their bill, and see every rupee that moves — in and out.
        </p>
        <button onClick={load} style={s.iconBtn} title="Refresh"><RefreshCw size={15} /></button>
      </div>

      {toast && <div style={s.toast}><Check size={13} /> {toast}</div>}
      {error && <div style={s.error}><AlertTriangle size={14} /> {error}</div>}

      {summary && (
        <div style={s.tiles}>
          <Tile label="Collected" value={summary.in_paid} tone="#0F766E" icon={<ArrowDownLeft size={14} />} />
          <Tile label="Collected pending" value={summary.in_pending} tone="#B45309" icon={<Loader2 size={14} />} />
          <Tile label="Paid out" value={summary.out_paid} tone="#B45309" icon={<ArrowUpRight size={14} />} />
          <Tile label="Payouts pending" value={summary.out_pending} tone="#B45309" icon={<Loader2 size={14} />} />
        </div>
      )}

      <div style={s.tabs}>
        {TABS.map(([id, label, count]) => (
          <button key={id} style={view === id ? s.tabOn : s.tab} onClick={() => { setView(id); setError(''); }}>
            {label}
            {count > 0 && <span style={s.tabCount}>{count}</span>}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center', paddingRight: 12 }}>
          <span style={s.statLine}>Committed to vendors <strong>{inr(committed)}</strong></span>
          <span style={s.statLine}>Owed <strong>{inr(unpaid)}</strong></span>
        </div>
      </div>

      {loading ? (
        <div style={s.empty}>Loading accounts…</div>
      ) : view === 'pos' ? (
        <PosView
          pos={pos} vendors={vendors} reload={load} flash={flash} fail={fail}
          busy={busy} setBusy={setBusy} meId={me?.id}
        />
      ) : view === 'bills' ? (
        <BillsView bills={bills} reload={load} flash={flash} fail={fail} busy={busy} setBusy={setBusy} />
      ) : (
        <LedgerView
          ledger={ledger} companies={companies} reload={load}
          flash={flash} fail={fail} busy={busy} setBusy={setBusy}
        />
      )}

      <p style={s.footnote}>
        Linking a movement to a company is always explicit — it is never guessed from a name.{' '}
        {onNavigate && (
          <button style={s.textLink} onClick={() => onNavigate('companies')}>
            See the relationship history
          </button>
        )}
      </p>
    </div>
  );
}

const s = {
  page: { padding: '20px 24px 40px', fontFamily: 'Inter, system-ui, sans-serif', color: '#161616' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  h2: { margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' },
  sub: { margin: 0, fontSize: 12.5, color: '#4A4A4A' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 },
  tile: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 10, padding: '10px 12px' },
  tileLabel: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#949494' },
  tileValue: { display: 'block', marginTop: 3, fontSize: 15, fontWeight: 650 },
  tabs: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #E7E2D8', alignItems: 'flex-end' },
  tab: {
    background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '8px 12px',
    fontSize: 12, fontWeight: 600, color: '#949494', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  },
  tabOn: {
    background: 'none', border: 'none', borderBottom: '2px solid #F2701D', padding: '8px 12px',
    fontSize: 12, fontWeight: 700, color: '#161616', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  },
  tabCount: {
    background: '#F1EDE4', color: '#4A4A4A', borderRadius: 999, padding: '1px 6px',
    fontSize: 10, fontWeight: 700,
  },
  statLine: { fontSize: 11.5, color: '#949494' },
  card: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, padding: 16, margin: '12px 0' },
  cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
  cardHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '0 2px 10px', borderBottom: '1px solid #E7E2D8',
  },
  cardHeadTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 },
  cardHeadSub: { fontSize: 11.5, color: '#949494' },
  cardActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#4A4A4A', fontWeight: 600 },
  input: {
    padding: '7px 9px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
    fontSize: 12, color: '#161616', fontFamily: 'inherit', fontWeight: 400,
  },
  select: {
    padding: '6px 8px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 8,
    fontSize: 12, color: '#161616', fontFamily: 'inherit',
  },
  formHint: { fontSize: 11.5, color: '#949494', margin: '0 0 4px', lineHeight: 1.5 },
  subHead: { fontSize: 11.5, fontWeight: 600, color: '#4A4A4A', margin: '14px 0 6px' },
  lineBox: { background: '#fff', border: '1px solid #E7E2D8', borderRadius: 10, padding: 4, marginTop: 6 },
  lineRow: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
    borderBottom: '1px solid #F4F1EA',
  },
  warnBox: {
    marginTop: 8, padding: '10px 12px', background: '#FEF9E7', border: '1px solid #FDE68A',
    borderRadius: 8, fontSize: 11.5, color: '#B45309',
  },
  estimate: {
    marginTop: 12, padding: '10px 12px', background: '#fff',
    border: '1px solid #E7E2D8', borderRadius: 10,
  },
  estRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 12,
    color: '#4A4A4A', padding: '3px 0',
  },
  tableWrap: { background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 12, overflowX: 'auto', marginTop: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
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
  tdMono: { padding: '10px 14px', verticalAlign: 'top', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 },
  tdSub: { fontSize: 10.5, color: '#949494', marginTop: 2 },
  strong: { fontWeight: 600 },
  dim: { color: '#949494', fontSize: 11, marginTop: 1 },
  warn: { color: '#B45309', fontSize: 11, marginTop: 4 },
  pill: { display: 'inline-block', padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' },
  unlinkedBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6,
    background: '#FEF3C7', color: '#B45309', fontSize: 10.5, fontWeight: 600,
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '10px 2px', flexWrap: 'wrap',
  },
  toolbarRight: { display: 'flex', gap: 8, marginLeft: 'auto' },
  searchNote: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#949494' },
  linkBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', background: '#fff',
    border: '1px solid #E7E2D8', borderRadius: 6, color: '#4A4A4A', fontSize: 11.5,
    cursor: 'pointer', fontFamily: 'inherit', maxWidth: 160,
  },
  linkBtnEmpty: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', background: 'transparent',
    border: '1px dashed #CFC7B6', borderRadius: 6, color: '#949494', fontSize: 11.5,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  rowActions: { display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  miniBtn: {
    padding: '4px 8px', background: '#fff', border: '1px solid #E7E2D8', borderRadius: 6,
    color: '#4A4A4A', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  miniGhost: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#fff',
    border: '1px solid #E7E2D8', borderRadius: 6, color: '#4A4A4A', fontSize: 11,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  miniOk: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#ECFDF5',
    border: '1px solid #A7F3D0', borderRadius: 6, color: '#059669', fontSize: 11,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  miniBad: {
    padding: 4, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6,
    color: '#DC2626', cursor: 'pointer', display: 'flex',
  },
  doneTag: { fontSize: 10.5, color: '#059669', fontWeight: 600 },
  iconBtn: {
    padding: 6, background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 8,
    color: '#4A4A4A', cursor: 'pointer', display: 'flex',
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F2701D', color: '#fff',
    border: 'none', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  primaryLink: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F2701D', color: '#fff',
    borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, textDecoration: 'none',
  },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#4A4A4A',
    border: '1px solid #E7E2D8', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  // An inline text link. Deliberately borderless: this sits inside a sentence,
  // and a button outline in the middle of prose reads as a broken control.
  textLink: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: '#F2701D', fontSize: 11.5, fontWeight: 600, textDecoration: 'underline',
    textUnderlineOffset: 2, fontFamily: 'inherit',
  },
  empty: { padding: 40, textAlign: 'center', color: '#4A4A4A', fontSize: 13, background: '#FAF9F7', border: '1px dashed #E7E2D8', borderRadius: 12, marginTop: 12 },
  emptyTitle: { marginTop: 8, fontSize: 13.5, fontWeight: 600, color: '#161616' },
  emptyHint: { marginTop: 4, fontSize: 12, color: '#949494', maxWidth: 460, margin: '4px auto 0', lineHeight: 1.5 },
  toast: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '9px 12px',
    borderRadius: 8, fontSize: 12.5, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '9px 12px', borderRadius: 8,
    fontSize: 12.5, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C',
  },
  footnote: { marginTop: 14, fontSize: 11.5, color: '#949494' },
};
