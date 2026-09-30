import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  ArrowDownLeft, ArrowUpRight, Wallet, QrCode, Upload, Copy, Download,
  Check, X, Link2, ShieldCheck, AlertCircle, ChevronRight,
  MessageCircle, ExternalLink, Loader2,
} from 'lucide-react';
import {
  getStaffUser, getUpiConfig, saveUpiConfig, decodeUpiPayload, validateUpiVpa,
  createUpiCollection, sendUpiPayment, updateUpiPayment, getVendors,
} from '../api.js';

// ---------------------------------------------------------------- constants --

const EMPTY_SEND = { vpa: '', payee_name: '', payee_phone: '', payee_email: '', amount: '', note: '', mode: 'approval' };
const EMPTY_COLLECT = { amount: '', note: '', customer_name: '', customer_phone: '', customer_email: '', expiry: 0, track_with_payu: true };

function inr(n) {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image'));
    img.src = src;
  });
}

/** Decode the first QR found in an image file. Runs entirely in the browser. */
async function readQrFromFile(file) {
  if (!file) throw new Error('No file selected');
  if (!/^image\//.test(file.type)) throw new Error('Drop an image file — PNG, JPG or WebP');

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Downscale big screenshots; QR needs resolution, not megapixels.
    const max = 1200;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser blocked canvas access, so the QR cannot be read');
    ctx.drawImage(img, 0, 0, w, h);

    const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!found) throw new Error('No QR code found in that image — try a sharper screenshot, or crop closer to the code');
    return found.data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; LAN origins fall back to execCommand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

/** Render a string as a QR data URL. Returns '' while empty or still encoding. */
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

// ---------------------------------------------------------------- component --

export default function PaymentsTab() {
  const staff = getStaffUser();

  const [pane, setPane] = useState('send');
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Send
  const [send, setSend] = useState(EMPTY_SEND);
  const [sendError, setSendError] = useState('');
  // One entry per payment. The QR path always produces exactly one; the typed
  // path can produce several, so this is a list from the start rather than a
  // single value that later has to grow a wrapper.
  const [sendBatch, setSendBatch] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Two entry paths into the same payment. They share amount, description and
  // payee; they differ only in where the payee UPI ID comes from — decoded out
  // of a QR, or typed. Mode is first-class state so neither path has to hide
  // the other's fields.
  const [sendMode, setSendMode] = useState('qr');
  const [vendors, setVendors] = useState([]);
  const [vendorPick, setVendorPick] = useState('');

  // Typed path only. Each row is a UPI ID plus the amount mapped to *that*
  // payee, so a second one can never silently inherit the first one's amount.
  // `checks` holds the live validation for each row, keyed by row id.
  const [rows, setRows] = useState([{ id: 1, vpa: '', amount: '', note: '', payee_name: '', payee_phone: '', vendor_id: '' }]);
  const [checks, setChecks] = useState({});
  const rowIdRef = useRef(1);
  const checkTimers = useRef({});

  // Receive
  const [collect, setCollect] = useState(EMPTY_COLLECT);
  const [collectError, setCollectError] = useState('');
  const [collectResult, setCollectResult] = useState(null);
  const [collectBusy, setCollectBusy] = useState(false);

  // Setup
  const [setup, setSetup] = useState({
    collection_vpa: '', collection_name: '', collection_mcc: '5411', test_mode: true,
    key: '', salt: '', payout_merchant_id: '', payout_client_id: '', payout_client_secret: '', payout_token_url: '',
  });
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const flash = useCallback((text, tone = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    // The ledger and summary moved to the Accounts tab, so this only loads
    // what the send/receive forms and the UPI setup card actually need.
    const cfg = await getUpiConfig().catch(() => null);
    if (cfg) {
      setConfig(cfg);
      setSetup((prev) => ({
        ...prev,
        collection_vpa: cfg.upi?.collection_vpa || '',
        collection_name: cfg.upi?.collection_name || '',
        collection_mcc: cfg.upi?.collection_mcc || '5411',
        test_mode: cfg.rails?.test_mode !== false,
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Best-effort. GET /api/admin/vendors is gated to payout roles, so a viewer
  // can legitimately land on a 403 here — the picker then degrades to plain
  // free-text instead of taking the whole card down with it.
  useEffect(() => {
    let alive = true;
    getVendors()
      .then((res) => {
        if (!alive) return;
        const list = Array.isArray(res?.vendors) ? res.vendors : [];
        setVendors(list.filter((v) => v && v.is_active !== false && v.name));
      })
      .catch(() => { if (alive) setVendors([]); });
    return () => { alive = false; };
  }, []);

  // Live receive intent — recomputed as the form changes, no "generate" step.
  const collectIntent = useMemo(() => {
    const vpa = config?.upi?.collection_vpa;
    if (!vpa) return '';
    const params = new URLSearchParams();
    params.set('pa', vpa);
    if (config?.upi?.collection_name) params.set('pn', config.upi.collection_name);
    const amt = Number(collect.amount);
    if (Number.isFinite(amt) && amt > 0) params.set('am', amt.toFixed(2));
    params.set('cu', 'INR');
    params.set('tn', (collect.note || 'Payment to BTLbro').slice(0, 100));
    if (collect.expiry > 0) params.set('tr', `btl_in_preview_${Date.now().toString(36)}`);
    if (config?.upi?.collection_mcc) params.set('mc', config.upi.collection_mcc);
    return `upi://pay?${params.toString()}`;
  }, [config, collect.amount, collect.note, collect.expiry]);

  // Live QR for whichever pane is active, so the preview is never stale.
  // Result cards get their own QR so editing the form can't mutate a payment
  // that was already dispatched.
  // What the live preview mirrors. The QR path previews the scanned handle;
  // the typed path previews the first row, which is the one an "add another"
  // is gated on.
  const primaryPayee = sendMode === 'qr'
    ? { ...send }
    : {
      ...send,
      vpa: rows[0]?.vpa || '',
      amount: rows[0]?.amount || '',
      note: rows[0]?.note || '',
      payee_name: rows[0]?.payee_name || '',
      payee_phone: rows[0]?.payee_phone || '',
    };
  const qrTarget = pane === 'send' ? (primaryPayee.vpa ? sendPreviewUri(primaryPayee) : '') : collectIntent;
  const liveQr = useQr(qrTarget);
  const collectResultQr = useQr(collectResult?.intent_uri || '');

  // ------------------------------------------------------------ send actions --

  function applyScannedPayload(rawText) {
    setSendError('');
    // Stale row verdicts are about typed handles, which a scan replaces.
    setChecks({});
    decodeUpiPayload(rawText)
      .then((res) => {
        const it = res.intent;
        setSend((prev) => ({
          ...prev,
          vpa: it.vpa,
          payee_name: it.payeeName || prev.payee_name,
          amount: it.amount || prev.amount,
          note: it.note || prev.note,
        }));
        flash(it.kind === 'vpa' ? 'UPI ID read' : 'UPI QR read');
      })
      .catch((err) => {
        setSendError(err.message);
      });
  }

  async function handleFile(file) {
    if (!file) return;
    setScanning(true);
    setSendError('');
    try {
      const text = await readQrFromFile(file);
      applyScannedPayload(text);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // A QR almost always arrives as an image — WhatsApp forwards, a screenshot,
  // right-click → Copy image. Requiring a drag or a file picker first made
  // that path feel worse than it is, so ⌘V works directly on this card.
  // Only image items are taken; a pasted UPI ID or link is left to the field
  // the user pasted into.
  useEffect(() => {
    if (pane !== 'send' || sendMode !== 'qr') return undefined;
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
          }
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // handleFile is stable enough for this: it only touches state setters.
  }, [pane, sendMode]);

  // Clear every pending debounce timer on unmount, or a check landing after
  // the tab is gone would set state on a dead component.
  useEffect(() => {
    const timers = checkTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Switching paths clears the payee UPI IDs: the scanned handle must not
  // masquerade as a typed one, and vice versa. Dispatch mode survives the
  // toggle; everything a payment owns (handle, amount, note, payee) is reset,
  // because in neither path does any of it belong to the form rather than the
  // payment.
  function switchSendMode(next) {
    if (next === sendMode) return;
    setSendMode(next);
    setSend((prev) => ({ ...prev, vpa: '', amount: next === 'qr' ? prev.amount : '' }));
    setRows([{ id: (rowIdRef.current += 1), vpa: '', amount: '', note: '', payee_name: '', payee_phone: '', vendor_id: '' }]);
    setChecks({});
    setSendError('');
  }

  // Picking a vendor fills that payment's payee fields in one go. `rowId` is
  // null for the QR path, which has a single payee living on `send`; a number
  // targets that row of the typed path. The UPI ID is only filled in for a
  // typed row — overwriting a handle that was just decoded out of a scanned QR
  // would quietly defeat the point of scanning it.
  function pickVendor(value, rowId) {
    const v = vendors.find((x) => String(x.id) === value);
    const patch = {};
    if (value && v) {
      if (v.name) patch.payee_name = v.name;
      const phone = String(v.phone || '').replace(/\D/g, '').slice(0, 10);
      if (phone) patch.payee_phone = phone;
      if (v.upi_id && rowId !== null) patch.vpa = v.upi_id;
    }

    if (rowId === null) {
      setVendorPick(value);
      setSend((prev) => ({ ...prev, ...patch }));
      return;
    }
    // Routed through updateRow so a vendor-supplied UPI ID gets validated by
    // the same debounce as a typed one.
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, vendor_id: value, ...patch } : r)));
    if (patch.vpa) scheduleCheck(rowId, patch.vpa);
  }

  // Validation runs as the handle is typed, so there is no Check button to
  // forget. Debounced because every keystroke would otherwise hit PayU; the
  // result is keyed by row so two handles never overwrite each other's state.
  function scheduleCheck(id, vpa) {
    clearTimeout(checkTimers.current[id]);
    const value = vpa.trim();
    if (!value.includes('@')) {
      setChecks((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    checkTimers.current[id] = setTimeout(async () => {
      setChecks((prev) => ({ ...prev, [id]: { state: 'checking' } }));
      try {
        const res = await validateUpiVpa(value);
        setChecks((prev) => ({ ...prev, [id]: { state: 'done', ...res } }));
      } catch (err) {
        setChecks((prev) => ({ ...prev, [id]: { state: 'done', valid: false, reason: err.message } }));
      }
    }, 500);
  }

  function updateRow(id, patch) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (patch.vpa !== undefined) scheduleCheck(id, patch.vpa);
  }

  function removeRow(id) {
    clearTimeout(checkTimers.current[id]);
    setChecks((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  // Gated on the *last* row having an amount, so every payee queued so far has
  // a figure mapped to it before another one can be added on top.
  const canAddRow = rows.length === 0 || Number(rows[rows.length - 1].amount) > 0;
  const multiCount = sendMode === 'upi' ? rows.length : 1;

  async function submitPayments(list) {
    setBusy(true);
    const done = [];
    try {
      // Sequential rather than parallel: the endpoint has a failure circuit
      // breaker, and a burst of requests would trip it for no reason.
      for (const p of list) {
        const res = await sendUpiPayment(p);
        done.push(res);
      }
      setSendBatch(done);
      const dispatched = done.filter((r) => r.dispatch?.ok).length;
      flash(dispatched === done.length
        ? `${done.length} transfer${done.length > 1 ? 's' : ''} dispatched to PayU Payouts`
        : `${done.length} payment${done.length > 1 ? 's' : ''} queued — approve in your UPI app`);
      await loadAll();
    } catch (err) {
      // Keep whatever already went through: those payments are real and the
      // user still has to approve them.
      if (done.length) setSendBatch(done);
      setSendError(done.length ? `${done.length} sent, then it failed: ${err.message}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    setSendError('');
    // The description is optional; the server generates a traceable fallback
    // when it is blank, so there is nothing to enforce here.

    if (sendMode === 'qr') {
      if (!send.vpa) return setSendError('Scan or paste their QR first — the UPI ID is read from it.');
      if (!(Number(send.amount) > 0)) return setSendError('Enter the amount to send.');
      return submitPayments([send]);
    }

    const missing = rows.find((r) => !r.vpa.trim() || !(Number(r.amount) > 0));
    if (missing) {
      return setSendError(missing.vpa.trim()
        ? 'Give every UPI ID an amount before sending.'
        : 'Every UPI ID needs a value before sending.');
    }
    const rejected = rows.find((r) => checks[r.id]?.valid === false);
    if (rejected) return setSendError(`“${rejected.vpa}” was rejected — fix it before sending.`);

    // Each row is its own payment, so it carries its own description and payee
    // — `send.note` / `send.payee_*` are overridden rather than inherited.
    // vendor_id is UI-only and never sent to the API.
    return submitPayments(rows.map(({ vendor_id, ...r }) => ({
      ...send,
      vpa: r.vpa.trim(),
      amount: r.amount,
      note: r.note,
      payee_name: r.payee_name,
      payee_phone: r.payee_phone,
    })));
  }

  function resetSend() {
    setSend(EMPTY_SEND);
    setSendBatch([]);
    setSendError('');
    setChecks({});
    setRows([{ id: (rowIdRef.current += 1), vpa: '', amount: '', note: '', payee_name: '', payee_phone: '', vendor_id: '' }]);
    setVendorPick('');
  }

  async function setStatus(row, status) {
    setError('');
    try {
      await updateUpiPayment(row.id, { status });
      flash(`Marked ${status}`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  // -------------------------------------------------------- receive actions --

  async function handleCollect() {
    setCollectError('');
    if (!(Number(collect.amount) > 0)) return setCollectError('Enter the amount you are collecting.');
    if (collect.customer_phone && !/^\d{10}$/.test(collect.customer_phone.replace(/\D/g, ''))) {
      return setCollectError('Phone number must be 10 digits.');
    }
    setCollectBusy(true);
    try {
      const res = await createUpiCollection(collect);
      setCollectResult(res);
      flash('Request created');
      await loadAll();
    } catch (err) {
      setCollectError(err.message);
    } finally {
      setCollectBusy(false);
    }
  }

  function resetCollect() {
    setCollect(EMPTY_COLLECT);
    setCollectResult(null);
    setCollectError('');
  }

  // ------------------------------------------------------------- setup save --

  async function handleSaveSetup() {
    setError('');
    setSetupBusy(true);
    try {
      const res = await saveUpiConfig(setup);
      setConfig(res);
      // Secrets are write-only server-side, so drop them from state too. A blank
      // value means "leave as is" on the next save, so nothing is lost.
      setSetup((prev) => ({ ...prev, key: '', salt: '', payout_client_id: '', payout_client_secret: '' }));
      setSetupOpen(false);
      flash('UPI setup saved');
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSetupBusy(false);
    }
  }

  // ---------------------------------------------------------------- ledger --

  const collectionVpa = config?.upi?.collection_vpa || '';
  const payoutsReady = config?.rails?.payouts?.configured;

  // Pane-agnostic, so both panes render the same node — but it belongs under
  // the form column, not across the page, so the preview stays independent.
  const footnote = (
    <div style={s.footnote}>
      Every movement is written to the ledger before anything is dispatched, and nothing is marked paid
      without a confirmation — from PayU, or from you after approving in your UPI app.
      The full ledger and reconciliation now live in the Accounts tab.
      {staff?.name ? ` Signed in as ${staff.name}.` : ''}
    </div>
  );

  if (loading) {
    return <div style={s.loading}>Loading payments…</div>;
  }

  return (
    <div style={s.page}>
      {toast && (
        <div style={toastStyle(toast.tone)}>
          {toast.tone === 'ok' ? <Check size={15} /> : <AlertCircle size={15} />}
          {toast.text}
        </div>
      )}
      {error && (
        <div style={s.banner}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* One control row: the pane switch on the left, setup on the right.
          Keeping setup beside the switch (rather than on a row of its own)
          means the pane controls sit exactly where you expect them, and the
          setup card opens underneath without shoving them down the page. */}
      <div style={s.controlRow}>
        <div style={s.segment}>
          <button
            className={`seg-btn${pane === 'send' ? ' seg-on' : ''}`}
            onClick={() => setPane('send')} style={segBtn(pane === 'send')}
          >
            <ArrowUpRight size={15} /> Send money
          </button>
          <button
            className={`seg-btn${pane === 'receive' ? ' seg-on' : ''}`}
            onClick={() => setPane('receive')} style={segBtn(pane === 'receive')}
          >
            <ArrowDownLeft size={15} /> Receive money
          </button>
        </div>
        <button onClick={() => setSetupOpen((v) => !v)} style={s.ghostBtn}>
          <Wallet size={15} /> UPI setup
          <RailDot rails={config?.rails} />
        </button>
      </div>

      {/* ------------------------------------------------------- setup card -- */}
      {setupOpen && (
        <Card title="UPI setup" icon={<ShieldCheck size={16} />} subtitle="Where money lands, and which PayU rails are live.">
          {error && <div style={s.banner}>Fix the setup error above, then save again.</div>}
          <div style={s.grid3}>
            <Field label="Collection UPI ID (VPA)" hint="Must be name@bank — this is where collected money lands.">
              <input
                style={s.input} value={setup.collection_vpa} placeholder="btlbro@okhdfcbank"
                onChange={(e) => setSetup((p) => ({ ...p, collection_vpa: e.target.value }))}
              />
            </Field>
            <Field label="Payee name" hint="Shown in the payer's UPI app.">
              <input
                style={s.input} value={setup.collection_name} placeholder="BTLbro"
                onChange={(e) => setSetup((p) => ({ ...p, collection_name: e.target.value }))}
              />
            </Field>
            <Field label="Merchant category code" hint="4 digits. 5411 = generic retail.">
              <input
                style={s.input} value={setup.collection_mcc} maxLength={4} placeholder="5411"
                onChange={(e) => setSetup((p) => ({ ...p, collection_mcc: e.target.value.replace(/\D/g, '') }))}
              />
            </Field>
          </div>

          <div style={s.divider} />
          <div style={s.railNote}>
            <strong>Collection rail</strong> —{' '}
            {config?.rails?.payments?.configured
              ? `PayU is connected (${config.rails.payments.key_hint}). Requests can be tracked and reconciled automatically.`
              : 'Not connected. QR codes and links still work — they are built and tracked locally. Add PayU key + salt to reconcile.'}
          </div>
          <div style={s.grid3}>
            <Field label="PayU merchant key" hint={config?.rails?.payments?.configured ? `Saved (${config.rails.payments.key_hint})` : 'Dashboard → Manage Checkout → Payment Gateway'}>
              <input style={s.input} type="password" value={setup.key} placeholder={config?.rails?.payments?.configured ? '•••••••• (unchanged)' : 'paste key'} onChange={(e) => setSetup((p) => ({ ...p, key: e.target.value }))} />
            </Field>
            <Field label="PayU salt v1" hint="Server-side only. Never paste this anywhere public.">
              <input style={s.input} type="password" value={setup.salt} placeholder={config?.rails?.payments?.configured ? '•••••••• (unchanged)' : 'paste salt'} onChange={(e) => setSetup((p) => ({ ...p, salt: e.target.value }))} />
            </Field>
            <Field label="Payouts merchant id" hint="Separate PayU product. Blank = approval rail only.">
              <input style={s.input} value={setup.payout_merchant_id} placeholder="payout merchant id" onChange={(e) => setSetup((p) => ({ ...p, payout_merchant_id: e.target.value }))} />
            </Field>
          </div>
          <div style={s.railNote}>
            <strong>Automatic payouts</strong> —{' '}
            {config?.rails?.payouts?.configured
              ? `PayU Payouts is connected${config.rails.payouts.merchant_hint ? ` (${config.rails.payouts.merchant_hint})` : ''}. “Auto” sends straight from the bank account.`
              : `Still needs ${(config?.rails?.payouts?.missing || ['credentials']).join(' + ')}. Until then every payout is a QR you approve yourself — nothing is sent automatically.`}
          </div>
          <div style={s.grid3}>
            <Field label="Payouts client id" hint="OAuth client from the Payouts dashboard.">
              <input style={s.input} type="password" value={setup.payout_client_id} placeholder={config?.rails?.payouts?.configured ? '•••••••• (unchanged)' : 'paste client id'} onChange={(e) => setSetup((p) => ({ ...p, payout_client_id: e.target.value }))} />
            </Field>
            <Field label="Payouts client secret" hint="Server-side only. Never paste this anywhere public.">
              <input style={s.input} type="password" value={setup.payout_client_secret} placeholder={config?.rails?.payouts?.configured ? '•••••••• (unchanged)' : 'paste client secret'} onChange={(e) => setSetup((p) => ({ ...p, payout_client_secret: e.target.value }))} />
            </Field>
            <Field label="Payouts token URL" hint="Only change if PayU gives you a different OAuth endpoint.">
              <input style={s.input} value={setup.payout_token_url} placeholder="leave blank for the default" onChange={(e) => setSetup((p) => ({ ...p, payout_token_url: e.target.value }))} />
            </Field>
          </div>

          <div style={s.setupFoot}>
            <label style={s.checkRow}>
              <input type="checkbox" checked={setup.test_mode} onChange={(e) => setSetup((p) => ({ ...p, test_mode: e.target.checked }))} />
              <span>Use PayU test environment</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSetupOpen(false)} style={s.secondaryBtn}>Cancel</button>
              <button onClick={handleSaveSetup} disabled={setupBusy} style={s.primaryBtn}>
                {setupBusy ? 'Saving…' : 'Save setup'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- panes --- */}
      <div className="split" style={s.split}>
        {/* ------------------------------------------------------ controls -- */}
        {pane === 'send' ? (
          <div style={s.col}>
            <Card
              title="Send money"
              icon={<ArrowUpRight size={16} />}
              subtitle={sendMode === 'qr'
                ? 'Paste their QR — the UPI ID is read straight out of it — then set the amount.'
                : 'Type a UPI ID, set the amount, then approve in your UPI app.'}
              right={
                <div style={s.modeSwitch}>
                  <button
                    type="button"
                    className={`seg-btn${sendMode === 'qr' ? ' seg-on' : ''}`}
                    style={modeBtn(sendMode === 'qr')}
                    onClick={() => switchSendMode('qr')}
                  >
                    <QrCode size={13} /> Using QR
                  </button>
                  <button
                    type="button"
                    className={`seg-btn${sendMode === 'upi' ? ' seg-on' : ''}`}
                    style={modeBtn(sendMode === 'upi')}
                    onClick={() => switchSendMode('upi')}
                  >
                    <Link2 size={13} /> Using UPI ID
                  </button>
                </div>
              }
            >
              {sendError && <div style={s.inlineError}>{sendError}</div>}

              {sendMode === 'qr' ? (
                <>
                  {/* Step 1 — and the only step before the code is read: until
                      there is a payee handle, amount and description have
                      nothing to attach to. Click-anywhere is a mouse
                      convenience; Browse stays the keyboard path, so the row
                      is a plain div rather than a nested role="button".
                      Once read, the same row flips green and reports the UPI
                      ID in place, rather than taking a second row for it. */}
                  <div
                    className={`dropzone${dragging ? ' is-over' : ''}${send.vpa ? ' is-done' : ''}`}
                    onClick={send.vpa ? undefined : () => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
                    style={s.scanRow}
                  >
                    <input
                      ref={fileRef} type="file" accept="image/*" hidden
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    {scanning ? (
                      <><Loader2 size={16} className="spin" color="#F2701D" /><span style={s.scanText}>Reading the QR…</span></>
                    ) : send.vpa ? (
                      <>
                        <Check size={16} style={{ color: '#059669', flexShrink: 0 }} />
                        <span style={s.scanText}>
                          UPI ID read from the QR
                          <code style={s.scanCode}>{send.vpa}</code>
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSend((p) => ({ ...p, vpa: '' })); setSendError(''); }}
                          style={s.scanPick}
                        >
                          Scan another
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload size={16} color="#F2701D" />
                        <span style={s.scanText}>
                          Drop, paste or pick a QR screenshot
                          <span style={s.scanSub}>⌘V works — copy the image in WhatsApp and paste it right here.</span>
                        </span>
                        <kbd style={s.kbd}>⌘V</kbd>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                          style={s.scanPick}
                        >
                          Browse
                        </button>
                      </>
                    )}
                  </div>

                  {!send.vpa && !scanning && (
                    <div style={s.modeHint}>
                      The payee's UPI ID comes out of the code, so there is nothing else to fill in yet —
                      amount and description appear once it has been read.
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Each row is a complete, independent payment — its own UPI
                      ID, amount and description — so a second payee can never
                      inherit the first one's figures. The handle validates
                      itself as it is typed, so there is no Check button.
                      Rows are separated by a rule rather than each sitting in
                      its own bordered box, which read as a card inside a card. */}
                  <div style={s.upiList}>
                    {rows.map((row, i) => {
                      const check = checks[row.id];
                      const state = check?.state === 'checking' ? 'checking' : check?.valid ? 'good' : check ? 'bad' : null;
                      return (
                        <div key={row.id} style={{ ...s.upiRow, ...(i > 0 ? s.upiRowDivided : null) }}>
                          <div style={s.upiRowHead}>
                            <span style={s.upiRowTitle}>Payee {i + 1}</span>
                            {rows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                style={s.upiRemove}
                                title={`Remove payee ${i + 1}`}
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>

                          <div style={s.grid2}>
                            <Field label="UPI ID" hint={i === 0 ? 'Checked as you type.' : undefined}>
                              <input
                                style={{ ...s.input, ...(state === 'good' ? s.inputGood : null), ...(state === 'bad' ? s.inputBad : null) }}
                                value={row.vpa}
                                placeholder="name@okaxis"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck="false"
                                onChange={(e) => updateRow(row.id, { vpa: e.target.value })}
                              />
                            </Field>
                            <Field label="Amount" hint={i === 0 ? 'Required before another can be added.' : undefined}>
                              <div style={s.amountWrap}>
                                <span style={s.rupee}>₹</span>
                                <input
                                  style={{ ...s.input, ...s.amountInput }}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={row.amount}
                                  placeholder="0.00"
                                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                                />
                              </div>
                            </Field>
                          </div>

                          <Field
                            label="Description"
                            hint={i === 0 ? 'Optional — saved on this payment only.' : undefined}
                          >
                            <input
                              style={s.input}
                              value={row.note}
                              placeholder="e.g. October retainer"
                              onChange={(e) => updateRow(row.id, { note: e.target.value })}
                            />
                          </Field>

                          {/* Payee identity belongs to this payment, not the
                              form — two payees are rarely the same vendor. */}
                          <details style={s.moreWrap}>
                            <summary style={s.moreSummary}>
                              <ChevronRight size={14} className="open-chevron" style={s.moreChevron} />
                              Add payee details
                            </summary>
                            <PayeeFields
                              value={row}
                              onChange={(patch) => updateRow(row.id, patch)}
                              vendors={vendors}
                              vendorId={row.vendor_id}
                              onVendor={(v) => pickVendor(v, row.id)}
                            />
                          </details>

                          {state && (
                            <div style={state === 'good' ? s.vpaOk : state === 'bad' ? s.vpaBad : s.vpaChecking}>
                              {state === 'checking'
                                ? <Loader2 size={14} className="spin" />
                                : state === 'good' ? <Check size={14} /> : <AlertCircle size={14} />}
                              <div>
                                {state === 'checking' ? (
                                  <strong>Checking the handle…</strong>
                                ) : (
                                  <>
                                    <strong>{check.valid ? 'Handle looks usable' : 'Handle rejected'}</strong>
                                    {check.payer_name ? ` · registered to ${check.payer_name}` : ''}
                                    {check.reason ? <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>{check.reason}</div> : null}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={s.addRowWrap}>
                    <button
                      type="button"
                      onClick={() => {
                        setRows((prev) => [...prev, { id: (rowIdRef.current += 1), vpa: '', amount: '', note: '', payee_name: '', payee_phone: '', vendor_id: '' }]);
                        setSendError('');
                      }}
                      disabled={!canAddRow}
                      style={s.addRowBtn}
                    >
                      <Link2 size={14} /> Add another UPI
                    </button>
                    {!canAddRow && (
                      <span style={s.addRowHint}>Enter an amount for the last payee first — it has to be mapped before the next one.</span>
                    )}
                  </div>
                </>
              )}

              {/* Shared from here down. The amount is the one thing that is NOT
                  shared: the typed path has already asked for it per payee
                  above, so repeating it here would give it two homes. */}
              {(sendMode === 'upi' || !!send.vpa) && (
                <>
                  {sendMode === 'qr' ? (
                    <div style={s.grid2}>
                      <Field label="Amount" hint="INR, up to 2 decimals. Required.">
                        <div style={s.amountWrap}>
                          <span style={s.rupee}>₹</span>
                          <input
                            style={{ ...s.input, ...s.amountInput }} type="number" min="0" step="0.01"
                            inputMode="decimal" value={send.amount} placeholder="0.00"
                            onChange={(e) => setSend((p) => ({ ...p, amount: e.target.value }))}
                          />
                        </div>
                      </Field>
                      <Field label="Description" hint="Optional — what this payment is for.">
                        <input style={s.input} value={send.note} placeholder="e.g. October retainer" onChange={(e) => setSend((p) => ({ ...p, note: e.target.value }))} />
                      </Field>
                    </div>
                  ) : null}

                  {payoutsReady ? (
                <Field label="How to send" hint="Payouts is connected, so transfers can fire automatically.">
                  <div style={s.radioRow}>
                    <label style={s.checkRow}>
                      <input type="radio" checked={send.mode === 'approval'} onChange={() => setSend((p) => ({ ...p, mode: 'approval' }))} />
                      <span>I approve in my UPI app</span>
                    </label>
                    <label style={s.checkRow}>
                      <input type="radio" checked={send.mode === 'auto'} onChange={() => setSend((p) => ({ ...p, mode: 'auto' }))} />
                      <span>Send automatically via PayU</span>
                    </label>
                  </div>
                </Field>
              ) : (
                <div style={s.railNote}>
                  <strong>Approval rail.</strong> This builds the payment and hands it to your UPI app — you approve it there,
                  then mark it paid. Connect PayU Payouts in UPI setup to send without touching your phone.
                </div>
              )}

              {/* The QR path has exactly one payee, so its details sit here.
                  The typed path puts them inside each row instead. */}
              {sendMode === 'qr' && (
                <details style={s.moreWrap}>
                  <summary style={s.moreSummary}>
                    <ChevronRight size={14} className="open-chevron" style={s.moreChevron} />
                    Add payee details
                  </summary>
                  <PayeeFields
                    value={send}
                    onChange={(patch) => setSend((p) => ({ ...p, ...patch }))}
                    vendors={vendors}
                    vendorId={vendorPick}
                    onVendor={(v) => pickVendor(v, null)}
                  />
                </details>
              )}

              <div style={s.actionRow}>
                {sendBatch.length > 0 && <button onClick={resetSend} style={s.secondaryBtn}>Clear</button>}
                <button onClick={handleSend} disabled={busy || scanning} style={s.primaryBtn}>
                  {busy
                    ? 'Sending…'
                    : sendBatch.length > 0
                      ? 'Send again'
                      : multiCount > 1 ? `Review & send ${multiCount} payments` : 'Review & send'}
                </button>
              </div>
                </>
              )}
            </Card>

            {/* One card per payment. The typed path can create several, and
                each needs its own QR — they are approved one at a time in the
                payer's UPI app, so collapsing them into one would leave the
                rest unpayable. */}
            {sendBatch.map((res, i) => (
              <SendResultCard key={res.payment?.id || i} res={res} index={i} onStatus={setStatus} />
            ))}
            {footnote}
          </div>
        ) : (
          <div style={s.col}>
            <Card title="What are you collecting?" icon={<QrCode size={16} />} subtitle="The amount is locked into the QR — the payer cannot change it.">
              {!collectionVpa ? (
                <div style={s.inlineWarn}>
                  Set your collection UPI ID in <strong>UPI setup</strong> before generating a request.
                </div>
              ) : (
                <>
                  {collectError && <div style={s.inlineError}>{collectError}</div>}
                  <div style={s.grid2}>
                    <Field label="Amount" hint="INR, up to 2 decimals.">
                      <div style={s.amountWrap}>
                        <span style={s.rupee}>₹</span>
                        <input style={{ ...s.input, ...s.amountInput }} type="number" min="0" step="0.01" value={collect.amount} placeholder="0.00" onChange={(e) => setCollect((p) => ({ ...p, amount: e.target.value }))} />
                      </div>
                    </Field>
                    <Field label="Note" hint="Appears in the payer's app.">
                      <input style={s.input} value={collect.note} placeholder="e.g. Campaign #4821" onChange={(e) => setCollect((p) => ({ ...p, note: e.target.value }))} />
                    </Field>
                  </div>
                  <details style={s.moreWrap}>
                    <summary style={s.moreSummary}>
                      <ChevronRight size={14} className="open-chevron" style={s.moreChevron} />
                      Customer details (optional)
                    </summary>
                    <div style={s.grid3}>
                      <Field label="Customer name" hint="Optional.">
                        <input style={s.input} value={collect.customer_name} onChange={(e) => setCollect((p) => ({ ...p, customer_name: e.target.value }))} />
                      </Field>
                      <Field label="Customer phone" hint="10 digits, optional.">
                        <input style={s.input} inputMode="numeric" value={collect.customer_phone} onChange={(e) => setCollect((p) => ({ ...p, customer_phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                      </Field>
                      <Field label="Customer email" hint="Optional.">
                        <input style={s.input} value={collect.customer_email} onChange={(e) => setCollect((p) => ({ ...p, customer_email: e.target.value }))} />
                      </Field>
                    </div>
                  </details>
                  <label style={s.checkRow}>
                    <input type="checkbox" checked={collect.track_with_payu} onChange={(e) => setCollect((p) => ({ ...p, track_with_payu: e.target.checked }))} />
                    <span>Register with PayU so this can be reconciled automatically later</span>
                  </label>
                  <div style={s.actionRow}>
                    {collectResult && <button onClick={resetCollect} style={s.secondaryBtn}>Clear</button>}
                    <button onClick={handleCollect} disabled={collectBusy || !collectionVpa} style={s.primaryBtn}>
                      {collectBusy ? 'Creating…' : 'Create request'}
                    </button>
                  </div>
                </>
              )}
            </Card>

            {collectResult && (
              <Card title="Request created" icon={<Check size={16} />} subtitle={`Ref ${collectResult.payment?.reference}`}>
                {collectResult.payu?.error && (
                  <div style={s.inlineWarn}>PayU could not register this, so it is tracked locally only — {collectResult.payu.error}</div>
                )}
                {collectResult.payu?.link && (
                  <div style={s.linkBox}>
                    <Link2 size={14} />
                    <code style={s.linkCode}>{collectResult.payu.link}</code>
                    <button onClick={() => copyText(collectResult.payu.link).then(() => flash('Link copied'))} style={s.iconBtn} title="Copy link">
                      <Copy size={14} />
                    </button>
                  </div>
                )}
                <QrPanel dataUrl={collectResultQr} uri={collectResult.intent_uri} label="Payer scans this with any UPI app" />
                <div style={s.actionRow}>
                  <button onClick={() => copyText(collectResult.intent_uri).then(() => flash('UPI link copied'))} style={s.secondaryBtn}>
                    <Copy size={15} /> Copy UPI link
                  </button>
                  <ShareButton text={shareText(collectResult)} phone={collectResult?.payment?.counterparty_phone} onCopy={async () => { await copyText(shareText(collectResult)); flash('Message copied — paste it in the Chat tab'); }} />
                </div>
              </Card>
            )}
            {footnote}
          </div>
        )}

        {/* ------------------------------------------------------- preview -- */}
        <div style={s.col}>
          <Card
            title={pane === 'send' ? 'Payment preview' : 'Collection preview'}
            icon={<QrCode size={16} />}
            subtitle={pane === 'send' ? 'What the payee will see.' : 'Updates live as you type.'}
            sticky
          >
            {pane === 'send' ? (
              // primaryPayee, not send: the typed path keeps its values on the
              // first row, so gating on send.vpa would leave the preview stuck
              // on its empty state with a perfectly valid handle entered.
              !primaryPayee.vpa ? (
                <div style={s.emptyState}>
                  <span style={s.emptyGlyph}><QrCode size={30} /></span>
                  <div style={s.emptyTitle}>Nothing to show yet</div>
                  <div style={s.emptyHint}>Drop, paste or type a UPI ID and the payment preview appears here.</div>
                  {Number(primaryPayee.amount) > 0 && (
                    <div style={s.emptyPreviewLine}>
                      <span>Amount ready</span>
                      <strong>{inr(primaryPayee.amount)}</strong>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* primaryPayee, not send: in the typed path the values live
                      on the first row, and with several payees queued the
                      preview has to say which one it is showing. */}
                  <QrPanel dataUrl={liveQr} uri={sendPreviewUri(primaryPayee)} label="Scan with your UPI app" />
                  <DetailRows rows={[
                    ['Paying', primaryPayee.vpa],
                    ['Payee name', primaryPayee.payee_name || '—'],
                    ['Payee phone', primaryPayee.payee_phone || '—'],
                    ['Amount', Number(primaryPayee.amount) > 0 ? inr(primaryPayee.amount) : 'not set — you choose in the app'],
                    ['Note', primaryPayee.note || '—'],
                  ]} />
                  {rows.length > 1 && (
                    <div style={s.emptyPreviewLine}>
                      <span>Previewing</span>
                      <strong>Payee 1 of {rows.length}</strong>
                    </div>
                  )}
                </>
              )
            ) : (
              !collectionVpa ? (
                <div style={s.emptyState}>
                  <span style={s.emptyGlyph}><Wallet size={30} /></span>
                  <div style={s.emptyTitle}>No collection VPA set</div>
                  <div style={s.emptyHint}>Open UPI setup and enter the UPI ID you want money to land in.</div>
                  <button onClick={() => setSetupOpen(true)} style={s.primaryBtn}>Open UPI setup</button>
                </div>
              ) : (
                <>
                  <QrPanel dataUrl={liveQr} uri={collectIntent} label="Payer scans this" />
                  <DetailRows rows={[
                    ['Receiving into', collectionVpa],
                    ['Payee name', config?.upi?.collection_name || '—'],
                    ['Amount', Number(collect.amount) > 0 ? inr(collect.amount) : 'not set — payer chooses'],
                    ['Note', collect.note || 'Payment to BTLbro'],
                  ]} />
                  {liveQr && (
                    <div style={s.actionRow}>
                      <a href={liveQr} download={`btlbro-${collect.amount || 'request'}.png`} style={s.secondaryLink}>
                        <Download size={15} /> Download QR
                      </a>
                      <button onClick={() => copyText(collectIntent).then(() => flash('UPI link copied'))} style={s.secondaryBtn}>
                        <Copy size={15} /> Copy link
                      </button>
                      <button onClick={() => window.location.href = collectIntent} style={s.secondaryBtn}>
                        <ExternalLink size={15} /> Open app
                      </button>
                    </div>
                  )}
                </>
              )
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ helpers --

function sendPreviewUri(send) {
  const params = new URLSearchParams();
  params.set('pa', send.vpa);
  if (send.payee_name) params.set('pn', send.payee_name);
  const amt = Number(send.amount);
  if (Number.isFinite(amt) && amt > 0) params.set('am', amt.toFixed(2));
  params.set('cu', 'INR');
  if (send.note) params.set('tn', send.note);
  return `upi://pay?${params.toString()}`;
}

function shareText(result) {
  const p = result.payment || {};
  return `Hi${p.counterparty_name ? ` ${p.counterparty_name}` : ''}, please pay ${inr(p.amount)} to BTLbro.\n\n${p.note ? `Note: ${p.note}\n\n` : ''}Pay here: ${result.intent_uri}`;
}

function RailDot({ rails }) {
  if (!rails) return null;
  const any = rails.payments?.configured || rails.payouts?.configured;
  return (
    <span style={{
      width: 7, height: 7, borderRadius: 999, marginLeft: 2,
      background: any ? '#10B981' : '#E7E2D8',
    }} />
  );
}

function Card({ title, icon, subtitle, children, right, sticky }) {
  return (
    <div style={{ ...s.card, ...(sticky ? { position: 'sticky', top: 18 } : {}) }}>
      <div style={s.cardHead}>
        <div style={{ minWidth: 0 }}>
          <div style={s.cardTitle}>
            {/* Tinted badge gives every card an identity at a glance — a bare
                glyph next to a bold line reads as decoration, not a marker. */}
            <span style={s.cardIcon}>{icon}</span>
            {title}
          </div>
          {subtitle && <div style={s.cardSub}>{subtitle}</div>}
        </div>
        {right}
      </div>
      <div style={s.cardBody}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      {children}
      {hint && <div style={s.hint}>{hint}</div>}
    </div>
  );
}

// Payee identity: who is this payment going to. Rendered per payment — once
// for the QR path's single payee, once per row of the typed path — so a payee
// name can never leak from one payment onto another.
function PayeeFields({ value, onChange, vendors, vendorId, onVendor }) {
  return (
    <>
      <div style={s.grid2}>
        <Field
          label="Payee"
          hint={vendors.length
            ? 'Pick someone already on file, or type a name.'
            : 'No vendors on file yet — type the name below instead.'}
        >
          <select style={s.input} value={vendorId || ''} onChange={(e) => onVendor(e.target.value)}>
            <option value="">Type a name instead</option>
            {vendors.map((v) => (
              <option key={v.id} value={String(v.id)}>
                {v.name}{v.business_name ? ` — ${v.business_name}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payee name" hint="Shown in your UPI app.">
          <input
            style={s.input}
            value={value.payee_name || ''}
            placeholder="Vendor name"
            onChange={(e) => onChange({ payee_name: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Payee phone" hint="Optional.">
        <input
          style={s.input}
          value={value.payee_phone || ''}
          inputMode="numeric"
          placeholder="10 digits"
          onChange={(e) => onChange({ payee_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
        />
      </Field>
    </>
  );
}

// A dispatched payment. Own component rather than an inline map so each one
// can call useQr for its own QR — a single hook cannot render N codes.
function SendResultCard({ res, index, onStatus }) {
  const payment = res.payment;
  const qr = useQr(res.intent_uri || '');

  if (!payment) return null;

  return (
    <Card
      title={index === 0 ? 'Send result' : `Send result ${index + 1}`}
      icon={<Check size={16} />}
      subtitle={`Ref ${payment.reference} · ${inr(payment.amount)} → ${payment.vpa}`}
    >
      {res.dispatch?.reason && <div style={s.inlineWarn}>{res.dispatch.reason}</div>}
      {res.dispatch?.ok && (
        <div style={s.inlineOk}>
          PayU Payouts accepted it. Status: <strong>{payment.payu_status || 'processing'}</strong>
        </div>
      )}

      <QrPanel dataUrl={qr} uri={res.intent_uri} label="Scan with your UPI app to approve" />

      <div style={s.actionRow}>
        {payment.status === 'awaiting' && (
          <>
            <button onClick={() => onStatus(payment, 'paid')} style={s.successBtn}>
              <Check size={15} /> Mark paid
            </button>
            <button onClick={() => onStatus(payment, 'cancelled')} style={s.secondaryBtn}>
              <X size={15} /> Cancel
            </button>
          </>
        )}
        <button onClick={() => { window.location.href = res.intent_uri; }} style={s.primaryBtn}>
          <ExternalLink size={15} /> Open in UPI app
        </button>
      </div>
    </Card>
  );
}

function QrPanel({ dataUrl, uri, label }) {
  if (!uri) {
    return (
      <div style={s.qrEmpty}>
        <QrCode size={26} color="#C9C2B4" />
        <span>QR appears once the amount or UPI ID is filled in</span>
      </div>
    );
  }
  return (
    <div style={s.qrWrap}>
      {dataUrl
        ? <img src={dataUrl} alt="UPI QR code" style={s.qrImg} />
        : <div style={s.qrLoading}><Loader2 size={20} className="spin" color="#C9C2B4" /></div>}
      <div style={s.qrLabel}>{label}</div>
      <code style={s.qrUri}>{uri.length > 64 ? `${uri.slice(0, 64)}…` : uri}</code>
    </div>
  );
}

function DetailRows({ rows }) {
  return (
    <div style={s.detail}>
      {rows.map(([k, v]) => (
        <div key={k} style={s.detailRow}>
          <span style={s.detailKey}>{k}</span>
          <span style={s.detailVal}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The share affordance used to be `https://wa.me/?text=...`, which has no
 * number in the path: it only opened a chat the device already had, and did
 * nothing anywhere else. Replacing it with a working wa.me link was not the
 * right fix either — it sends whoever is logged into that WhatsApp and throws
 * the user out of the CRM mid-transaction.
 *
 * The one place a customer should be messaged from is the Chat tab, which
 * delivers from the registered BTLbro number. So this row keeps the copyable
 * link and points at the real channel instead of faking a share button.
 */
function ShareButton({ text, phone, onCopy }) {
  return (
    <button onClick={onCopy} style={{ ...s.secondaryLink, background: 'none', border: '1px solid #E7E2D8', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
      <MessageCircle size={15} /> Copy request to send in Chat
    </button>
  );
}

// The QR / UPI ID path switch, which lives in a card header rather than a
// full-width control row — so it is the same control one size down. Shares
// the .seg-btn / .seg-on classes with segBtn for its hover states.
function modeBtn(on) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 30, boxSizing: 'border-box', padding: '0 12px',
    borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600,
    background: on ? '#F2701D' : 'transparent',
    color: on ? '#fff' : '#4A4A4A',
    boxShadow: on ? '0 1px 2px rgba(242,112,29,0.32)' : 'none',
  };
}

// The pane switch in the page's control row.
function segBtn(active) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 36, boxSizing: 'border-box', padding: '0 18px',
    borderRadius: 9, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
    background: active ? '#F2701D' : 'transparent',
    color: active ? '#fff' : '#4A4A4A',
    boxShadow: active ? '0 1px 3px rgba(242,112,29,0.35)' : 'none',
    transition: 'all .15s',
  };
}

function toastStyle(tone) {
  return {
    padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 7, marginBottom: 16,
    background: tone === 'ok' ? '#ECFDF5' : '#FEF2F2',
    color: tone === 'ok' ? '#059669' : '#DC2626',
  };
}

// ------------------------------------------------------------------- styles --

const s = {
  page: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1280 },
  loading: { padding: 40, textAlign: 'center', color: '#949494', fontSize: 13 },

  // Pane switch on the left, setup on the right — one row, centred together.
  controlRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 16, flexWrap: 'wrap',
  },

  banner: {
    padding: '10px 14px', borderRadius: 9, background: '#FEF2F2', color: '#DC2626',
    fontSize: 13, display: 'flex', alignItems: 'center', gap: 7,
  },
  inlineError: {
    padding: '9px 12px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 12.5,
  },
  inlineWarn: {
    padding: '9px 12px', borderRadius: 8, background: '#FEF3C7', color: '#B45309', fontSize: 12.5, lineHeight: 1.5,
  },
  inlineOk: {
    padding: '9px 12px', borderRadius: 8, background: '#ECFDF5', color: '#059669', fontSize: 12.5,
  },
  vpaOk: {
    padding: '10px 12px', borderRadius: 8, background: '#ECFDF5', color: '#065F46',
    fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start',
  },
  vpaBad: {
    padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', color: '#B91C1C',
    fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start',
  },

  segment: {
    display: 'inline-flex', gap: 4, padding: 4, background: '#fff',
    border: '1px solid #E7E2D8', borderRadius: 11,
  },
  // The preview is a single QR + a short detail list, so it never needs as
  // much room as the form. Giving the form the larger share also stops the
  // amount/note pair from collapsing to one narrow column on laptops.
  split: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 0.85fr)', gap: 16, alignItems: 'start' },
  col: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },

  card: {
    background: '#fff', border: '1px solid #E7E2D8', borderRadius: 14,
    boxShadow: '0 1px 3px rgba(22,22,22,0.03)', overflow: 'hidden',
  },
  cardHead: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 12, padding: '15px 18px', borderBottom: '1px solid #F3F0EA',
  },
  cardTitle: {
    fontSize: 14.5, fontWeight: 700, color: '#161616',
    display: 'flex', alignItems: 'center', gap: 9,
  },
  cardIcon: {
    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
    background: '#FFF4EC', color: '#F2701D',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  cardSub: { fontSize: 12, color: '#949494', marginTop: 3, lineHeight: 1.5 },
  cardBody: { padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },

  field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  label: { fontSize: 12, fontWeight: 600, color: '#4A4A4A' },
  hint: { fontSize: 11, color: '#949494', lineHeight: 1.45 },

  input: {
    width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
    border: '1.5px solid #E7E2D8', background: '#FAF9F7', color: '#161616',
    boxSizing: 'border-box', outline: 'none', transition: 'border .15s',
  },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 },

  amountWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  rupee: { position: 'absolute', left: 12, fontSize: 14, color: '#949494', pointerEvents: 'none' },
  amountInput: { paddingLeft: 28, fontSize: 15, fontWeight: 600 },

  // A scanned QR is a shortcut, not the main path. A single dashed row keeps
  // it discoverable without pushing the payee fields below the fold.
  scanRow: {
    border: '1.5px dashed #D8D0C0', borderRadius: 10, padding: '11px 12px',
    background: '#FAF9F7', display: 'flex', alignItems: 'center', gap: 10,
  },
  // Column so the instruction and the WhatsApp hint stack instead of the hint
  // being crushed onto the label's line.
  scanText: {
    fontSize: 12.5, color: '#4A4A4A', fontWeight: 600,
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2,
  },
  scanSub: { fontSize: 11.5, fontWeight: 400, color: '#949494', lineHeight: 1.4 },
  // The handle the scan produced, shown inside the (now green) dropzone. The
  // UPI ID on its own is the whole confirmation — no second status row.
  scanCode: { fontSize: 12.5, fontWeight: 700, color: '#059669', wordBreak: 'break-all' },
  // A drawn key cap reads faster than the word "paste" does.
  kbd: {
    fontFamily: 'inherit', fontSize: 11, fontWeight: 700, color: '#4A4A4A',
    background: '#fff', border: '1px solid #E7E2D8', borderBottomWidth: 2,
    borderRadius: 5, padding: '2px 6px', lineHeight: 1.4, flexShrink: 0,
  },
  scanPick: {
    padding: '5px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: '1px solid #E7E2D8', background: '#fff', color: '#4A4A4A', whiteSpace: 'nowrap',
  },

  // Track for the QR / UPI ID switch that sits in the card header's `right`
  // slot. Kept as a pill so it reads as one control beside the title.
  modeSwitch: {
    display: 'inline-flex', gap: 3, padding: 3, background: '#FAF9F7',
    border: '1px solid #E7E2D8', borderRadius: 10, flexShrink: 0,
  },
  modeHint: { fontSize: 12, color: '#949494', lineHeight: 1.55, padding: '0 2px' },

  moreWrap: { borderTop: '1px solid #F3F0EA', paddingTop: 12 },
  moreSummary: {
    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
    listStyle: 'none', WebkitAppearance: 'none', appearance: 'none',
    fontSize: 12.5, fontWeight: 600, color: '#4A4A4A', userSelect: 'none',
  },
  moreChevron: { transition: 'transform .15s ease', flexShrink: 0 },

  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#4A4A4A', cursor: 'pointer' },
  radioRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  // Rows sit directly in the card with no border or fill of their own — a
  // bordered panel inside a card reads as a card inside a card, and made a
  // three-field form look like a stack of trays. A hairline between rows is
  // enough to show where one payment stops and the next begins.
  upiList: { display: 'flex', flexDirection: 'column', gap: 4 },
  upiRow: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  upiRowDivided: { borderTop: '1px solid #F3F0EA', paddingTop: 16, marginTop: 12 },
  upiRowHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  upiRowTitle: {
    fontSize: 11, fontWeight: 700, color: '#949494',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  upiRemove: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
    border: '1px solid #E7E2D8', background: '#fff', color: '#949494',
  },
  // Live verdict on a handle. Keeping it inside the row means the feedback
  // sits with the field it belongs to, not in a shared status area.
  vpaChecking: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
    borderRadius: 8, background: '#F3F0EA', color: '#4A4A4A',
    fontSize: 12, lineHeight: 1.5,
  },
  inputGood: { borderColor: '#10B981', background: '#F6FEFB' },
  inputBad: { borderColor: '#E0A0A0', background: '#FEF8F8' },
  // Wrapped so the explanatory line drops under the button on narrow cards
  // instead of squeezing it.
  addRowWrap: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  addRowBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px',
    borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
    border: '1px solid #E7E2D8', background: '#fff', color: '#4A4A4A', fontFamily: 'inherit',
  },
  addRowHint: { fontSize: 11.5, color: '#949494', lineHeight: 1.45, flex: 1, minWidth: 180 },

  // Right-aligned, matching cardActions across the other admin tabs: the
  // primary action sits at the far right with secondary actions to its left.
  actionRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' },

  primaryBtn: {
    padding: '11px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: '#F2701D', color: '#fff', fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
  },
  successBtn: {
    padding: '11px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: '#10B981', color: '#fff', fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 7,
  },
  secondaryBtn: {
    padding: '11px 18px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid #E7E2D8', background: '#fff', color: '#4A4A4A',
    display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
  },
  secondaryLink: {
    padding: '11px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600,
    border: '1px solid #E7E2D8', background: '#fff', color: '#4A4A4A',
    display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none', whiteSpace: 'nowrap',
  },
  // 46 = the segment's outer height (4 + 36 + 4 + 2 border), pinned as an
  // explicit box so the two never drift apart as fonts resolve differently.
  ghostBtn: {
    height: 46, boxSizing: 'border-box', padding: '0 16px',
    borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid #E7E2D8', background: '#fff', color: '#4A4A4A',
    display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'inherit',
  },
  iconBtn: {
    padding: 7, borderRadius: 7, cursor: 'pointer', border: '1px solid #E7E2D8',
    background: '#fff', color: '#4A4A4A', display: 'inline-flex', alignItems: 'center',
  },

  qrWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, padding: '6px 0 2px' },
  qrImg: { width: 210, height: 210, borderRadius: 10, border: '1px solid #F3F0EA' },
  qrLoading: {
    width: 210, height: 210, borderRadius: 10, border: '1px dashed #E7E2D8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  qrEmpty: {
    padding: '26px 14px', borderRadius: 10, border: '1px dashed #E7E2D8', background: '#FAF9F7',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
    fontSize: 12, color: '#949494', textAlign: 'center',
  },
  qrLabel: { fontSize: 12, fontWeight: 600, color: '#4A4A4A' },
  qrUri: {
    fontSize: 10.5, color: '#949494', wordBreak: 'break-all', textAlign: 'center',
    maxWidth: '100%', lineHeight: 1.4,
  },

  detail: { display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 9, overflow: 'hidden', border: '1px solid #F3F0EA' },
  detailRow: { display: 'flex', justifyContent: 'space-between', gap: 14, padding: '9px 12px', background: '#FAF9F7', fontSize: 12.5 },
  detailKey: { color: '#949494', flexShrink: 0 },
  detailVal: { color: '#161616', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' },

  emptyState: { padding: '30px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  // Soft accent plate instead of a lone grey glyph — an empty column should
  // look like it is waiting for something, not like it failed to load.
  emptyGlyph: {
    width: 64, height: 64, borderRadius: 18, marginBottom: 4,
    background: 'linear-gradient(135deg, #FFF4EC, #FAF9F7)',
    border: '1px dashed #F6C9A5', color: '#F2701D',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 13.5, fontWeight: 700, color: '#4A4A4A' },
  emptyHint: { fontSize: 12, color: '#949494', maxWidth: 320, lineHeight: 1.5 },
  // With no QR yet the preview column is otherwise dead space. Echoing back
  // the part of the form that IS filled keeps it useful before the payee is.
  emptyPreviewLine: {
    marginTop: 6, paddingTop: 12, borderTop: '1px solid #F3F0EA', width: '100%',
    display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: '#949494',
  },

  linkBox: {
    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px',
    background: '#FAF9F7', border: '1px solid #E7E2D8', borderRadius: 8,
  },
  linkCode: { fontSize: 11.5, color: '#4A4A4A', flex: 1, wordBreak: 'break-all' },

  railNote: {
    padding: '10px 12px', borderRadius: 8, background: '#FFF7F1',
    borderLeft: '3px solid #F2701D', color: '#4A4A4A',
    fontSize: 12, lineHeight: 1.55,
  },
  divider: { height: 1, background: '#F3F0EA' },
  setupFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },

  footnote: { fontSize: 11.5, color: '#949494', lineHeight: 1.6, padding: '0 2px 4px' },
};
