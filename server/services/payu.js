// PayU client — covers the two halves of the admin Payments tab.
//
//  A. PAYMENTS RAIL (collect money *in*)
//     - Dynamic QR  : pg=DBQR, bankcode=UPIDBQR → qrString with the amount baked in
//     - Intent link : command=generate_upi_intent → shareable secure.payu.in/omni link
//     - VPA check   : command=validateVPA
//     - Status      : command=verify_payment
//     Auth = merchant `key` + `salt v1`, SHA-512 hashes.
//
//  B. PAYOUTS RAIL (send money *out*)
//     - Transfer    : POST /payout/v2/payment with `vpa`
//     - Status      : settle on `txnStatus` keyed by `merchantRefId` (nothing else is authoritative)
//     - VPA check   : /payout/merchant/validateVpa
//     Auth = OAuth2 Bearer token + `payoutMerchantId` header. This is a SEPARATE
//     PayU product from the payments gateway: different onboarding, different
//     merchant id, different endpoints. Payouts stays disabled until those
//     credentials exist — see isPayoutsConfigured().
//
// Every function resolves to a result object and never throws for "not
// configured" or "gateway said no", so callers can fall back to the local
// (no-credentials) rail instead of handling exceptions.

import crypto from 'crypto';
import { dbHelpers } from '../db.js';
import { formatAmount } from './upi.js';

const PAYMENTS_HOSTS = {
  test: 'https://test.payu.in',
  live: 'https://secure.payu.in',
};

const PAYOUTS_HOSTS = {
  test: 'https://uatoneapi.payu.in',
  live: 'https://payout.payumoney.com',
};

// The payouts token endpoint is not published in the public docs we could
// verify, so it is configuration rather than a guess. Until it is set, payouts
// stay off and the tab uses the local approval rail.
const DEFAULT_PAYOUT_TOKEN_URLS = {
  test: 'https://uatoneapi.payu.in/payout/v1/oauth/token',
  live: 'https://payout.payumoney.com/payout/v1/oauth/token',
};

const HTTP_TIMEOUT_MS = 25000;

// ---------------------------------------------------------------- config ----

function payuSettings() {
  const settings = dbHelpers.getSettings() || {};
  return settings.payu || {};
}

function envOr(value, ...fallbacks) {
  if (value) return String(value).trim();
  for (const f of fallbacks) if (f) return String(f).trim();
  return '';
}

export function getPaymentsConfig() {
  const s = payuSettings();
  const testMode = s.test_mode !== false;
  return {
    key: envOr(process.env.PAYU_MERCHANT_KEY, s.key),
    salt: envOr(process.env.PAYU_MERCHANT_SALT, s.salt),
    testMode,
    host: testMode ? PAYMENTS_HOSTS.test : PAYMENTS_HOSTS.live,
  };
}

export function getPayoutsConfig() {
  const s = payuSettings();
  const testMode = s.test_mode !== false;
  return {
    merchantId: envOr(process.env.PAYU_PAYOUT_MERCHANT_ID, s.payout_merchant_id),
    clientId: envOr(process.env.PAYU_PAYOUT_CLIENT_ID, s.payout_client_id),
    clientSecret: envOr(process.env.PAYU_PAYOUT_CLIENT_SECRET, s.payout_client_secret),
    tokenUrl: envOr(process.env.PAYU_PAYOUT_TOKEN_URL, s.payout_token_url,
      testMode ? DEFAULT_PAYOUT_TOKEN_URLS.test : DEFAULT_PAYOUT_TOKEN_URLS.live),
    testMode,
    host: testMode ? PAYOUTS_HOSTS.test : PAYOUTS_HOSTS.live,
  };
}

export function isPaymentsConfigured() {
  const c = getPaymentsConfig();
  return Boolean(c.key && c.salt);
}

export function isPayoutsConfigured() {
  const c = getPayoutsConfig();
  return Boolean(c.merchantId && (c.clientId && c.clientSecret));
}

/** Never returns secrets — this object is safe to send to the browser. */
export function describeConfig() {
  const payments = getPaymentsConfig();
  const payouts = getPayoutsConfig();
  return {
    test_mode: payments.testMode,
    payments: {
      configured: isPaymentsConfigured(),
      key_hint: payments.key ? `${payments.key.slice(0, 3)}••••${payments.key.slice(-2)}` : '',
    },
    payouts: {
      configured: isPayoutsConfigured(),
      merchant_hint: payouts.merchantId ? `••••${payouts.merchantId.slice(-3)}` : '',
      missing: [
        !payouts.merchantId && 'payout_merchant_id',
        !(payouts.clientId && payouts.clientSecret) && 'payout_client_id + payout_client_secret',
      ].filter(Boolean),
    },
  };
}

// ----------------------------------------------------------------- hash ----

function sha512(input) {
  return crypto.createHash('sha512').update(String(input), 'utf8').digest('hex');
}

/**
 * Payment hash for `_payment` / Dynamic QR (pg=DBQR). PayU's documented formula:
 *   sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT)
 * Two traps: `phone` is sent as a request field but is NOT hashed, and the
 * `||||||` is exactly 5 empty slots (udf6..udf10) — six makes 7 pipes and PayU
 * rejects it as "incorrectly calculated hash". `amount` must match byte-for-byte.
 */
export function paymentHash({ key, salt, txnid, amount, productinfo, firstname, email, udf = {} }) {
  const u = (n) => (udf[`udf${n}`] == null ? '' : String(udf[`udf${n}`]));
  const hashString = [
    key, txnid, amount, productinfo, firstname, email,
    u(1), u(2), u(3), u(4), u(5),
    '', '', '', '', '',
    salt,
  ].join('|');
  return { hash: sha512(hashString), hashString };
}

/** Service-API hash: sha512(key|command|var1|salt). Only var1 is signed. */
export function serviceHash({ key, salt, command, var1 = '' }) {
  const hashString = [key, command, var1, salt].join('|');
  return { hash: sha512(hashString), hashString };
}

/**
 * Reverse hash — verifies a surl/furl callback really came from PayU.
 * Documented as: salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|
 * productinfo|amount|txnid|key. Note `status` sits second and `key` is last.
 */
export function reverseHash({ key, salt, status = '', ...fields }) {
  const f = (v) => (v == null ? '' : String(v));
  const hashString = [
    salt, status,
    '', '', '', '', '',
    f(fields.udf5), f(fields.udf4), f(fields.udf3), f(fields.udf2), f(fields.udf1),
    f(fields.email), f(fields.firstname), f(fields.productinfo),
    f(fields.amount), f(fields.txnid), key,
  ].join('|');
  return { hash: sha512(hashString), hashString };
}

// ------------------------------------------------------------ http helper ----

/**
 * PayU answers a misconfigured Dynamic QR setup with a 500 and a vague
 * "Merchant Integration Exception". The usual cause is not our payload: the
 * DBQR flag has to be switched on for the merchant by PayU. Say that plainly
 * instead of surfacing a bare 500, because nothing here can be fixed in code.
 */
function dynamicQrErrorReason(res, cfg) {
  const raw = String(res.error || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const isMerchantIntegration = /merchant integration exception/i.test(raw) || res.status >= 500;
  if (isMerchantIntegration) {
    return 'PayU rejected the Dynamic QR at their end ("Merchant Integration Exception"). '
      + 'UPI QR needs the DBQR flag enabled on your merchant account — ask your PayU '
      + 'contact/KAM to enable it, or share their referenceId. Requests still work '
      + 'without it: the QR and link built locally are fully usable.';
  }
  return raw || `Dynamic QR request failed (HTTP ${res.status})`;
}

async function postForm(url, fields, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
      body: new URLSearchParams(fields).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `PayU did not respond within ${HTTP_TIMEOUT_MS / 1000}s`
      : err.message;
    return { ok: false, status: 0, data: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, body, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `PayU did not respond within ${HTTP_TIMEOUT_MS / 1000}s`
      : err.message;
    return { ok: false, status: 0, data: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function serviceCall(command, var1, var2) {
  const cfg = getPaymentsConfig();
  if (!isPaymentsConfigured()) {
    return { ok: false, reason: 'PayU merchant key/salt not configured' };
  }
  const { hash } = serviceHash({ key: cfg.key, salt: cfg.salt, command, var1 });
  const fields = { key: cfg.key, command, var1, hash };
  if (var2 !== undefined) fields.var2 = var2;
  const res = await postForm(`${cfg.host}/merchant/postservice.php?form=2`, fields);
  if (!res.ok) {
    return { ok: false, reason: res.error || `PayU ${command} failed (HTTP ${res.status})` };
  }
  return { ok: true, data: res.data };
}

// ==================================================== A. PAYMENTS RAIL (IN) ==

/**
 * Dynamic QR. Returns a qrString with the amount already fixed, so the payer
 * cannot edit it — this is the "money already set" collection QR.
 */
export async function createDynamicQr({ txnid, amount, note = '', payeeName = '', email = '', phone = '', expirySeconds = 0, callbackBase = '' }) {
  const cfg = getPaymentsConfig();
  if (!isPaymentsConfigured()) {
    return { ok: false, reason: 'PayU merchant key/salt not configured' };
  }
  const amt = formatAmount(amount);
  if (!amt) return { ok: false, reason: 'A positive amount is required' };

  const productinfo = 'UPI Collection';
  const firstname = payeeName || 'Collection';
  // phone is a request field but is deliberately NOT part of the hash.
  const phoneField = phone || '9999999999';
  const { hash } = paymentHash({
    key: cfg.key, salt: cfg.salt, txnid, amount: amt,
    productinfo, firstname, email,
  });

  const fields = {
    key: cfg.key,
    txnid,
    amount: amt,
    productinfo,
    firstname,
    email,
    phone: phoneField,
    pg: 'DBQR',
    bankcode: 'UPIDBQR',
    txn_s2s_flow: '4',
    s2s_client_ip: '127.0.0.1',
    s2s_device_info: 'BTLbro-Admin',
    hash,
  };
  // surl/furl are listed as mandatory by PayU for Dynamic QR. Omitting them
  // fails with EX158 "Incomplete input details". They are also how we learn a
  // payment landed, so they must point at our callback route.
  const base = String(callbackBase || '').replace(/\/+$/, '');
  if (base) {
    fields.surl = `${base}/api/payments/callback?status=success`;
    fields.furl = `${base}/api/payments/callback?status=failure`;
  }
  if (expirySeconds > 0) fields.expiry_time = String(expirySeconds);

  const res = await postForm(`${cfg.host}/_payment`, fields);
  if (!res.ok) {
    return { ok: false, reason: dynamicQrErrorReason(res, cfg), status: res.status, detail: res.error || null };
  }
  const d = res.data || {};
  const result = d.result || {};
  const meta = d.metaData || {};
  if (!result.qrString) {
    return {
      ok: false,
      reason: d.message || meta.message || 'PayU returned no QR string',
      raw: d,
    };
  }
  return {
    ok: true,
    data: {
      qr_string: result.qrString,
      payment_id: result.paymentId || '',
      merchant_vpa: result.merchantVpa || '',
      payu_txnid: meta.txnId || txnid,
      status: meta.unmappedStatus || meta.txnStatus || 'pending',
      otp_post_url: result.otpPostUrl || '',
    },
  };
}

/** Shareable hosted payment link with the amount fixed. */
export async function generateIntentLink({ txnId, amount, note = '', merchantVpa = '', expirySeconds = 0, refUrl = '' }) {
  const amt = formatAmount(amount);
  if (!amt) return { ok: false, reason: 'A positive amount is required' };

  const payload = { transactionId: txnId, transactionAmount: amt };
  if (merchantVpa) payload.merchantVpa = merchantVpa;
  if (note) payload.txnNote = note;
  if (expirySeconds > 0) payload.expiryTime = String(expirySeconds);
  if (refUrl) payload.refUrl = refUrl;

  const res = await serviceCall('generate_upi_intent', JSON.stringify(payload));
  if (!res.ok) return res;
  const d = res.data || {};
  if (!d.link) {
    return { ok: false, reason: d.msg || 'PayU returned no intent link', raw: d };
  }
  return { ok: true, data: { link: d.link, message: d.message || d.msg || '' } };
}

/**
 * Format + existence check for a VPA. Requires merchant credentials; without
 * them the caller should rely on the local format check only.
 */
export async function validateVpa(vpa) {
  const res = await serviceCall('validateVPA', vpa);
  if (!res.ok) return res;
  const d = res.data || {};
  return {
    ok: true,
    data: {
      vpa: d.vpa || vpa,
      // isVPAValid is 1/0 for this legacy endpoint and true/false on the v2 one.
      is_valid: d.isVPAValid === 1 || d.isVPAValid === true || d.isValidVpa === true,
      autopay_valid: d.isAutoPayVPAValid === 1 || d.isAutoPayVPAValid === true,
      payer_name: d.payerAccountName && d.payerAccountName !== 'NA' ? d.payerAccountName : '',
    },
  };
}

/** Authoritative status for a collection txn. */
export async function verifyPayment(txnid) {
  const res = await serviceCall('verify_payment', txnid);
  if (!res.ok) return res;
  const d = res.data || {};
  const txns = Array.isArray(d.transaction_details)
    ? d.transaction_details
    : Object.values(d.transaction_details || {});
  const t = txns[0] || d;
  return {
    ok: true,
    data: {
      txnid: t.txnid || txnid,
      // _payment uses metaData.unmappedStatus; verify_payment lowercases it.
      status: t.unmappedstatus || t.status || '',
      amount: t.amount || '',
      mihpayid: t.mihpayid || '',
      bank_ref: t.bank_ref_num || '',
      mode: t.mode || '',
      error: t.error && t.error !== 'E000' ? t.error : '',
      error_message: t.error_Message && t.error_Message !== 'No Error' ? t.error_Message : '',
    },
  };
}

// ==================================================== B. PAYOUTS RAIL (OUT) ==

let tokenCache = { token: '', expiresAt: 0 };

async function payoutAccessToken() {
  const cfg = getPayoutsConfig();
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return { ok: true, token: tokenCache.token };
  }
  if (!cfg.merchantId || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, reason: 'PayU Payouts credentials are not configured' };
  }
  const res = await postForm(cfg.tokenUrl, {
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  }, { headers: { payoutMerchantId: cfg.merchantId } });

  if (!res.ok) {
    return { ok: false, reason: res.error || `Payouts auth failed (HTTP ${res.status})` };
  }
  const token = (res.data || {}).access_token || (res.data || {}).accessToken || '';
  if (!token) return { ok: false, reason: 'Payouts auth returned no access token', raw: res.data };
  const expiresIn = Number((res.data || {}).expires_in) || 3600;
  tokenCache = { token, expiresAt: Date.now() + (expiresIn - 120) * 1000 };
  return { ok: true, token };
}

async function payoutCall(path, body) {
  const cfg = getPayoutsConfig();
  const auth = await payoutAccessToken();
  if (!auth.ok) return auth;
  const res = await postJson(`${cfg.host}${path}`, body, {
    headers: { Authorization: `Bearer ${auth.token}`, payoutMerchantId: cfg.merchantId },
  });
  if (!res.ok) {
    return { ok: false, reason: res.error || `PayU Payouts request failed (HTTP ${res.status})`, raw: res.data };
  }
  return { ok: true, data: res.data };
}

/**
 * Fire a UPI transfer to a beneficiary VPA.
 * `merchantRefId` is the only handle we get back for status — keep it.
 */
export async function payoutTransfer({ merchantRefId, vpa, name, email = '', phone = '', amount, purpose = '' }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'A positive amount is required' };
  if (!isPayoutsConfigured()) return { ok: false, reason: 'PayU Payouts credentials are not configured' };

  const entry = {
    beneficiaryName: name || 'Beneficiary',
    amount: Number(amt.toFixed(2)),
    batchId: merchantRefId,
    merchantRefId,
    paymentType: 'UPI',
    vpa,
    purpose: purpose || 'Payment',
    retry: false,
  };
  if (email) entry.beneficiaryEmail = email;
  if (phone) entry.beneficiaryMobile = phone;

  const res = await payoutCall('/payout/v2/payment', [entry]);
  if (!res.ok) return res;
  const d = res.data || {};
  return {
    ok: true,
    data: {
      status_code: d.status ?? d.code ?? null,
      message: d.msg || d.message || '',
      raw: d,
    },
  };
}

/** Settle payout state from `txnStatus` — nothing else in the payload is authoritative. */
export async function payoutStatus(merchantRefId) {
  const cfg = getPayoutsConfig();
  if (!isPayoutsConfigured()) return { ok: false, reason: 'PayU Payouts credentials are not configured' };
  const res = await payoutCall('/payout/v2/transaction/status', { merchantRefId });
  if (!res.ok) return res;
  const d = res.data || {};
  const list = d.transactionDetails || d.data?.transactionDetails || [];
  const t = Array.isArray(list) ? list[0] : (list || {});
  return {
    ok: true,
    data: {
      merchant_ref_id: t.merchantRefId || merchantRefId,
      txn_status: t.txnStatus || '',
      status_description: t.txnStatusDescription || '',
      bank_ref: t.bankTransactionRefNo || '',
      name_with_bank: t.nameWithBank || '',
      fee: t.fee ?? null,
      succeeded_on: t.succeedOn || '',
    },
  };
}

/** Existence check on the payouts side (test env only accepts `kk@okaxis`). */
export async function payoutValidateVpa(vpa) {
  const cfg = getPayoutsConfig();
  const auth = await payoutAccessToken();
  if (!auth.ok) return auth;
  const url = `${cfg.host}/payout/merchant/validateVpa?vpa=${encodeURIComponent(vpa)}`;
  const res = await postForm(url, {}, {
    headers: { Authorization: `Bearer ${auth.token}`, payoutMerchantId: cfg.merchantId },
  });
  if (!res.ok) return { ok: false, reason: res.error || `Payouts VPA check failed (HTTP ${res.status})` };
  return { ok: true, data: res.data || {} };
}

export function isPayoutSuccess(status) {
  return String(status || '').toUpperCase() === 'SUCCESS';
}

export default {
  createDynamicQr,
  describeConfig,
  generateIntentLink,
  getPaymentsConfig,
  getPayoutsConfig,
  isPaymentsConfigured,
  isPayoutsConfigured,
  isPayoutSuccess,
  paymentHash,
  payoutStatus,
  payoutTransfer,
  payoutValidateVpa,
  reverseHash,
  serviceHash,
  validateVpa,
  verifyPayment,
};
