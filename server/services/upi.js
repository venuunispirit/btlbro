// UPI intent (URI) parsing and construction.
//
// A UPI QR is just a string. This module is the single source of truth for
// turning that string into structured data and back again, with no network
// calls and no dependencies so it can be unit-tested and reused server-side.
//
// Spec: `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>&tr=<ref>&mc=<mcc>`
//
// NPCI retired UPI Collect (VPA push) for P2M on 28 Feb 2026, so every flow
// here is intent/QR based: the *payer* always pulls, never pushes.

const SCHEME = 'upi:';

// Provider handles are alphabetic, 2-32 chars. The local part is far looser in
// practice (dots, dashes, underscores are all common), so we stay permissive
// there and let the bank be the real authority.
const VPA_RE = /^[A-Za-z0-9._-]{1,256}@[A-Za-z]{2,32}$/;

// Only genuinely dangerous characters get stripped. `?`, `#` and `&` look risky
// in a query string but are safe here because every value is encoded and decoded
// through URLSearchParams — replacing them would silently mangle notes.
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const WHITESPACE_RE = /\s+/g;

export function normalizeVpa(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isValidVpa(raw) {
  return VPA_RE.test(normalizeVpa(raw));
}

/**
 * Format-only VPA check. This is a sanity filter, not proof the handle exists —
 * a handle can be well-formed and still belong to nobody. Only the issuing bank
 * (or PayU's validateVPA) can answer that.
 */
export function validateVpaFormat(raw) {
  const vpa = normalizeVpa(raw);
  if (!vpa) return { valid: false, vpa: '', reason: 'VPA is empty' };
  if (vpa.includes(' ')) return { valid: false, vpa, reason: 'VPA must not contain spaces' };
  if (!vpa.includes('@')) return { valid: false, vpa, reason: 'VPA must be in the form name@bank' };
  if (vpa.split('@').length !== 2) return { valid: false, vpa, reason: 'VPA must contain exactly one @' };
  if (!VPA_RE.test(vpa)) return { valid: false, vpa, reason: 'VPA has an unsupported format' };
  return { valid: true, vpa, reason: '' };
}

function clean(value) {
  return String(value == null ? '' : value)
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

export function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  // Two decimals, always. UPI rejects bare integers and trailing-zero variance
  // is a common cause of "amount mismatch" failures.
  return n.toFixed(2);
}

/**
 * Parse a scanned/entered UPI payload.
 *
 * Accepts a full intent URI, a bare `pay:` scheme, or a raw VPA pasted straight
 * from a bank app (some QR generators emit just the handle).
 *
 * @returns {{ok: boolean, reason?: string, vpa?: string, payeeName?: string,
 *            amount?: string, note?: string, txnRef?: string, currency?: string,
 *            mcc?: string, raw?: string, kind?: 'intent'|'vpa'}}
 */
export function parseUpiPayload(raw) {
  const input = String(raw || '').trim();
  if (!input) return { ok: false, reason: 'Nothing to read' };

  const isUri = /^upi:/i.test(input);

  if (!isUri) {
    // A bare VPA is legitimate input, so accept it instead of erroring.
    const check = validateVpaFormat(input);
    if (check.valid) {
      return { ok: true, kind: 'vpa', vpa: check.vpa, raw: input };
    }
    return {
      ok: false,
      reason: check.reason || 'Not a UPI QR code or VPA — this looks like a different type of code.',
    };
  }

  // `upi://pay?...`, `upi:pay?...` and `upi://pay?...` all appear in the wild.
  const afterScheme = input.replace(/^upi:(\/\/)?/i, '');
  const qIndex = afterScheme.indexOf('?');
  if (qIndex === -1) {
    return { ok: false, reason: 'UPI code has no payment parameters' };
  }

  const action = afterScheme.slice(0, qIndex).replace(/^\/+/, '').toLowerCase();
  if (action !== 'pay') {
    return { ok: false, reason: `Unsupported UPI action “${action || 'unknown'}” — only “pay” is supported.` };
  }

  const params = new URLSearchParams(afterScheme.slice(qIndex + 1));
  const vpa = normalizeVpa(params.get('pa'));

  if (!vpa) {
    return { ok: false, reason: 'UPI code is missing the payee address (pa)' };
  }
  const check = validateVpaFormat(vpa);
  if (!check.valid) {
    return { ok: false, reason: `Payee address looks invalid — ${check.reason}` };
  }

  const rawAmount = clean(params.get('am'));
  let amount = '';
  if (rawAmount) {
    const n = Number(rawAmount);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: `UPI code carries an unusable amount (“${rawAmount}”)` };
    }
    const fixed = Number(formatAmount(n));
    // Never silently round a scanned amount — a QR asking for 10.129 and one
    // asking for 0.004 must both be rejected rather than quietly changed.
    if (Math.abs(fixed - n) > 0.0001) {
      return { ok: false, reason: `UPI code amount “${rawAmount}” has more than 2 decimal places` };
    }
    if (fixed <= 0) {
      return { ok: false, reason: 'UPI code amount rounds down to zero' };
    }
    amount = formatAmount(n);
  }

  return {
    ok: true,
    kind: 'intent',
    vpa,
    payeeName: clean(params.get('pn')),
    amount,
    note: clean(params.get('tn')),
    txnRef: clean(params.get('tr')),
    currency: (clean(params.get('cu')) || 'INR').toUpperCase(),
    mcc: clean(params.get('mc')),
    raw: input,
  };
}

/**
 * Build a UPI intent URI.
 *
 * `amount` is what makes this useful for collection: when it is present the
 * payer cannot change it, which is the whole point of a "money already set" QR.
 */
export function buildUpiUri({
  vpa,
  payeeName = '',
  amount = '',
  note = '',
  txnRef = '',
  currency = 'INR',
  mcc = '',
} = {}) {
  const check = validateVpaFormat(vpa);
  if (!check.valid) throw new Error(check.reason || 'Invalid VPA');

  const params = new URLSearchParams();
  params.set('pa', check.vpa);
  if (clean(payeeName)) params.set('pn', clean(payeeName));
  const amt = formatAmount(amount);
  if (amt) params.set('am', amt);
  params.set('cu', (clean(currency) || 'INR').toUpperCase());
  if (clean(note)) params.set('tn', clean(note));
  if (clean(txnRef)) params.set('tr', clean(txnRef));
  if (clean(mcc)) params.set('mc', clean(mcc));

  return `${SCHEME}//pay?${params.toString()}`;
}

/** Merchant category codes worth having on an intent. */
export const MCC = {
  GENERIC: '5411',
  MARKETPLACE: '5399',
  RESTAURANT: '5812',
  TRANSPORT: '4111',
  SERVICES: '7299',
};

export default {
  MCC,
  buildUpiUri,
  formatAmount,
  isValidVpa,
  normalizeVpa,
  parseUpiPayload,
  validateVpaFormat,
};
