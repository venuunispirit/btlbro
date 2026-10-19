// End-to-end test of the admin UPI payments API (the Payments tab backend).
// Covers: the Manager+ auth boundary, secret masking, authoritative QR
// re-parsing, amount-locked collection requests, the local approval rail,
// PayU Payouts failure handling, amount precision, and the ledger/summary.
//
// Strategy mirrors sheetSync.test.mjs: copy the real sources into a temp dir
// inside server/ with the db path patched, so node_modules resolution still
// works and the REAL server/data/db.json is never touched. The directory is
// named distinctly because sheetSync.test.mjs uses `.test-run` and currently
// dies before its own cleanup — sharing one path would let the two tests
// clobber each other's db.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Build temp module tree with patched db path ---
const tmpDir = path.join(__dirname, '.test-run-upi');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'middleware'), { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);

for (const f of ['services/upi.js', 'services/payu.js', 'middleware/staffAuth.js', 'routes/upiPayments.js', 'routes/checkout.js', 'routes/settings.js']) {
  fs.copyFileSync(path.join(__dirname, f), path.join(tmpDir, f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const router = (await import(pathToFileURL(path.join(tmpDir, 'routes/upiPayments.js')))).default;

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

// --- Seed one staff user per role, each with a live session ---
const ROLES = ['member', 'recee', 'bd_executive', 'ops_executive', 'manager',
  'recee_manager', 'bdm', 'ops_manager', 'super_admin'];
// Mirrors PAYOUT_ROLES in routes/upiPayments.js. Deliberately excludes the
// level-1 roles that requireManager would otherwise wave through.
const CAN_MOVE_MONEY = new Set(['manager', 'bdm', 'ops_manager', 'super_admin']);

db.data.users = db.data.users || [];
db.data.sessions = db.data.sessions || [];
const tokens = {};
let uid = 9000;
for (const role of ROLES) {
  const id = ++uid;
  db.data.users.push({ id, name: `Test ${role}`, email: `${role}@test.local`, role, is_team: true, is_active: true });
  const token = `tok_${role}`;
  tokens[role] = token;
  db.data.sessions.push({
    token, user_id: id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  });
}
// The checkout pricer reads canonical synced records. Seed one priced location
// so the cart can be priced server-side the way the marketing tool prices it.
db.data.records = [{
  id: 1, file_id: 1, row_index: 0, is_active: true,
  data: {
    name: 'Prestige Kingfisher Tower', type: 'apartments',
    digital_promotion: 3000, lift_promotion: 500,
    lat: 12.9716, lng: 77.5946,
  },
}];
await db.write();

const app = express();
app.use(express.json());
app.use('/api/admin/payments', router);
const checkoutRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/checkout.js')))).default;
app.use('/api/checkout', checkoutRouter);
const settingsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/settings.js')))).default;
app.use('/api/settings', settingsRouter);
const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const root = `http://127.0.0.1:${server.address().port}`;
const base = `${root}/api/admin/payments`;

const call = (method, p, { token, body } = {}) => fetch(base + p, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const mgr = tokens.manager;

console.log('\n== Test 1: unauthenticated requests are rejected ==');
check('GET /config 401 without token', (await call('GET', '/config')).status === 401);
check('POST /send 401 without token', (await call('POST', '/send', { body: {} })).status === 401);
check('GET /ledger 401 with bogus token', (await call('GET', '/ledger', { token: 'nope' })).status === 401);

console.log('\n== Test 2: role matrix — only Manager+ reaches the money ==');
for (const role of ROLES) {
  const res = await call('GET', '/config', { token: tokens[role] });
  const want = CAN_MOVE_MONEY.has(role) ? 200 : 403;
  check(`${role} → ${res.status} (want ${want})`, res.status === want);
}

console.log('\n== Test 3: no endpoint leaks to an executive ==');
for (const [method, p, body] of [
  ['PUT', '/config', { collection_vpa: 'btlbro@okhdfcbank' }],
  ['POST', '/decode', { payload: 'upi://pay?pa=a@okaxis' }],
  ['POST', '/validate-vpa', { vpa: 'a@okaxis' }],
  ['POST', '/collect', { amount: 10 }],
  ['POST', '/send', { vpa: 'a@okaxis', amount: 10, note: 'test note' }],
  ['PUT', '/ledger/1', { status: 'paid' }],
  ['POST', '/ledger/1/reconcile', {}],
  ['GET', '/ledger', undefined],
  ['GET', '/summary', undefined],
]) {
  const res = await call(method, p, { token: tokens.bd_executive, body });
  check(`${method} ${p} 403 for bd_executive`, res.status === 403, `got ${res.status}`);
}

console.log('\n== Test 4: setup + secrets stay write-only ==');
let res = await call('PUT', '/config', {
  token: mgr,
  body: { collection_vpa: 'btlbro@OKHDFCBANK', collection_name: 'BTLbro', collection_mcc: '5411' },
});
let body = await res.json();
check('save collection VPA 200', res.status === 200, `got ${res.status}`);
check('VPA normalised to lowercase', body.upi?.collection_vpa === 'btlbro@okhdfcbank', body.upi?.collection_vpa);
check('receive_ready true', body.receive_ready === true);

res = await call('PUT', '/config', { token: mgr, body: { collection_vpa: 'not-a-vpa' } });
check('invalid VPA rejected', res.status === 400, `got ${res.status}`);

res = await call('PUT', '/config', { token: mgr, body: { key: 'payu_test_key', salt: 'payu_test_salt' } });
const putText = JSON.stringify(await res.json());
check('PUT response hides key', !putText.includes('payu_test_key'), putText.slice(0, 160));
check('PUT response hides salt', !putText.includes('payu_test_salt'));
const getText = await (await call('GET', '/config', { token: mgr })).text();
check('GET /config hides key', !getText.includes('payu_test_key'));
check('GET /config hides salt', !getText.includes('payu_test_salt'));
// An empty secret means "leave as is" so the browser never wipes a live one.
res = await call('PUT', '/config', { token: mgr, body: { key: '', test_mode: true } });
check('blank secret does not wipe stored key',
  dbHelpers.getSettings().payu.key === 'payu_test_key', dbHelpers.getSettings().payu.key);

console.log('\n== Test 5: server re-parses what the browser decoded ==');
res = await call('POST', '/decode', { token: mgr, body: { payload: 'upi://pay?pa=btlbro@okhdfcbank&pn=BTLbro&am=1500.50&tn=Oct%20retainer' } });
body = await res.json();
check('valid payload parses', res.status === 200 && body.intent?.vpa === 'btlbro@okhdfcbank', JSON.stringify(body).slice(0, 120));
check('amount parsed to 2dp', body.intent?.amount === '1500.50', body.intent?.amount);
for (const payload of [
  'https://example.com', 'upi://collect?pa=a@okaxis', 'upi://pay?pa=a@okaxis&am=-5',
  'upi://pay?pa=a@okaxis&am=1.234', 'upi://pay?pa=bad&am=10', 'upi://pay?pn=x', '',
]) {
  const r = await call('POST', '/decode', { token: mgr, body: { payload } });
  check(`rejects ${JSON.stringify(payload).slice(0, 32).padEnd(34)}`, r.status === 400, `got ${r.status}`);
}

console.log('\n== Test 6: collection request is amount-locked ==');
const before = dbHelpers.getPayments().length;
res = await call('POST', '/collect', { token: mgr, body: { amount: 4200.75, note: 'Order 88', customer_name: 'Asha Rao', customer_phone: '9876543210' } });
body = await res.json();
check('collect 200', res.status === 200, JSON.stringify(body).slice(0, 160));
check('ledger row created', dbHelpers.getPayments().length === before + 1);
check('amount stored exactly', body.payment?.amount === 4200.75, String(body.payment?.amount));
check('intent URI carries the amount', String(body.intent_uri || '').includes('am=4200.75'), body.intent_uri);
check('intent points at our VPA', String(body.intent_uri || '').includes('btlbro%40okhdfcbank'));
check('row records the creator', body.payment?.created_by_name === 'Test manager', body.payment?.created_by_name);
check('starts awaiting', body.payment?.status === 'awaiting', body.payment?.status);
check('phone normalised to 10 digits', body.payment?.counterparty_phone === '9876543210');
for (const amount of [0, -5, 1.234, 99999999]) {
  const r = await call('POST', '/collect', { token: mgr, body: { amount } });
  check(`rejects amount ${amount}`, r.status === 400, `got ${r.status}`);
}

console.log('\n== Test 7: collection blocked with no VPA configured ==');
dbHelpers.updateSettingsExtended({ upi: { collection_vpa: '' } });
res = await call('POST', '/collect', { token: mgr, body: { amount: 100 } });
check('400 without a collection VPA', res.status === 400, `got ${res.status}`);
check('error is actionable', String((await res.json()).error).includes('collection VPA'));
await call('PUT', '/config', { token: mgr, body: { collection_vpa: 'btlbro@okhdfcbank' } });

console.log('\n== Test 8: outbound with zero credentials (local rail) ==');
const payout = { vpa: 'vendor@okaxis', amount: 2500, note: 'Oct retainer', payee_name: 'Vendor Ltd' };
res = await call('POST', '/send', { token: mgr, body: { ...payout, mode: 'auto' } });
body = await res.json();
check('send 200', res.status === 200, JSON.stringify(body).slice(0, 160));
check('falls back to approval rail', body.payment?.rail === 'approval', body.payment?.rail);
check('does NOT claim money moved', ['awaiting', 'awaiting_approval'].includes(body.payment?.status), body.payment?.status);
check('invents no gateway txn id', !body.payment?.gateway_txn_id, body.payment?.gateway_txn_id);
check('intent URI built', String(body.intent_uri || '').includes('am=2500.00'));
for (const [patch, label] of [[{ vpa: 'garbage' }, 'malformed payee VPA'], [{ note: 'ab' }, 'too-short note'], [{ amount: 0 }, 'zero amount']]) {
  const r = await call('POST', '/send', { token: mgr, body: { ...payout, ...patch } });
  check(`rejects ${label}`, r.status === 400, `got ${r.status}`);
}

// The description is optional in the form, but a payment that carries no note
// at all cannot be traced — that is what MIN_NOTE exists to prevent. Blank is
// therefore accepted and backfilled, never stored empty.
res = await call('POST', '/send', { token: mgr, body: { ...payout, note: '' } });
body = await res.json();
check('blank description is accepted', res.status === 200, `got ${res.status}: ${JSON.stringify(body).slice(0, 120)}`);
check('but a traceable note is still stored', String(body.payment?.note || '').length >= 3, body.payment?.note);

console.log('\n== Test 9: Payouts never half-claims a transfer ==');
dbHelpers.updateSettingsExtended({ payu: { payout_merchant_id: 'MID123' } }); // credentials missing
res = await call('POST', '/send', { token: mgr, body: { ...payout, mode: 'auto' } });
body = await res.json();
check('partial config still 200', res.status === 200, `got ${res.status}`);
check('partial config falls back to approval', body.payment?.rail === 'approval', body.payment?.rail);
check('tells the user it fell back', String(body.dispatch?.reason || '').includes('not configured'), body.dispatch?.reason);
check('marked awaiting, not paid', body.payment?.status === 'awaiting', body.payment?.status);

// Point the token URL at a closed port so the OAuth handshake fails instantly.
dbHelpers.updateSettingsExtended({
  payu: { payout_merchant_id: 'MID123', payout_client_id: 'cid', payout_client_secret: 'csecret', payout_token_url: 'http://127.0.0.1:1/oauth/token' },
});
res = await call('POST', '/send', { token: mgr, body: { ...payout, mode: 'auto' } });
body = await res.json();
check('unreachable gateway does not crash', res.status === 200, `got ${res.status}`);
check('success flag is FALSE', body.success === false, JSON.stringify(body.dispatch));
check('row marked failed', body.payment?.status === 'failed', body.payment?.status);
check('failure reason recorded', !!body.payment?.failure_reason, JSON.stringify(body.payment));
check('invents no bank ref', !body.payment?.bank_ref);
dbHelpers.updateSettingsExtended({ payu: { payout_merchant_id: '', payout_client_id: '', payout_client_secret: '', payout_token_url: '' } });

console.log('\n== Test 10: amounts are exact, never rounded ==');
for (const amount of [1.234, 2500.005, 99.999, 0.001]) {
  const r = await call('POST', '/send', { token: mgr, body: { ...payout, amount } });
  check(`rejects sub-paisa ${amount}`, r.status === 400, `got ${r.status}`);
}
for (const amount of [2500.5, 4200.75, 0.01, 999999.99]) {
  const r = await call('POST', '/send', { token: mgr, body: { ...payout, amount, mode: 'approval' } });
  check(`accepts ${amount}`, r.status === 200, `got ${r.status}`);
}

console.log('\n== Test 11: ledger, filters and summary stay consistent ==');
res = await call('GET', '/ledger', { token: mgr });
body = await res.json();
const payments = Array.isArray(body) ? body : body.payments;
check('ledger 200 with rows', res.status === 200 && payments.length > 0, `len=${payments?.length}`);
check('newest first', payments[0].created_at >= payments[payments.length - 1].created_at);

const inOnly = await (await call('GET', '/ledger?direction=in', { token: mgr })).json();
const inList = Array.isArray(inOnly) ? inOnly : inOnly.payments;
check('direction filter works', inList.every(p => p.direction === 'in'), inList.map(p => p.direction).join(','));

const target = payments[0];
await call('PUT', `/ledger/${target.id}`, { token: mgr, body: { status: 'paid', note: 'confirmed in bank' } });
const updated = dbHelpers.getPayments().find(p => p.id === target.id);
check('status update persisted', updated.status === 'paid', updated.status);
check('note update persisted', updated.note === 'confirmed in bank', updated.note);
check('unknown status rejected', (await call('PUT', `/ledger/${target.id}`, { token: mgr, body: { status: 'hacked' } })).status === 400);
check('unknown payment 404', (await call('PUT', '/ledger/999999', { token: mgr, body: { status: 'paid' } })).status === 404);

res = await call('GET', '/summary', { token: mgr });
body = await res.json();
check('summary 200', res.status === 200);
check('counts every row', body.count === dbHelpers.getPayments().length, `${body.count} vs ${dbHelpers.getPayments().length}`);
check('splits in/out totals', body.in_total > 0 && body.out_total > 0, `in=${body.in_total} out=${body.out_total}`);
check('paid never exceeds total (in)', body.in_paid <= body.in_total);
check('paid never exceeds total (out)', body.out_paid <= body.out_total);
check('paid + pending + failed reconciles (in)', Math.abs((body.in_paid + body.in_pending + body.in_failed) - body.in_total) < 0.01, `${body.in_paid}+${body.in_pending}+${body.in_failed} vs ${body.in_total}`);
check('paid + pending + failed reconciles (out)', Math.abs((body.out_paid + body.out_pending + body.out_failed) - body.out_total) < 0.01, `${body.out_paid}+${body.out_pending}+${body.out_failed} vs ${body.out_total}`);
check('the unreachable-gateway payout is counted as failed', body.out_failed > 0, String(body.out_failed));
const statusSum = Object.values(body.by_status || {}).reduce((a, b) => a + b, 0);
check('by_status accounts for every row', statusSum === body.count, `${statusSum} vs ${body.count}`);
check('every tile field the UI reads is present',
  ['in_paid', 'in_pending', 'out_paid', 'out_pending'].every(k => typeof body[k] === 'number'),
  JSON.stringify(Object.keys(body)));

// == Test 12: public checkout — the server owns the amount ==
// The customer is not signed in and the browser is not trusted. These assert
// the two things that protect the booking price: the charged amount is derived
// from admin settings, and a lead is recorded even when the rail is dead.
console.log('\n== Test 12: checkout charges the settings amount, not the client\'s ==');

async function pay(body) {
  const res = await fetch(`${root}/api/checkout/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selections: CART, duration_months: 1, ...body }),
  });
  return { status: res.status, body: await res.json() };
}

// A cart the server can price: one location, one real service off the sheet.
const CART = [{ name: 'Prestige Kingfisher Tower', type: 'apartments', services: ['digital promotion'] }];
// digital_promotion 3000 + 10% agency fee (300) = 3300 + 18% GST (594) = 3894
const SERVER_QUOTE = 3894;

function setBookingAmount(v) {
  const s = dbHelpers.getSettings();
  s.payment = { ...(s.payment || {}), min_booking: v };
}

const leadsBefore = dbHelpers.getLeads().length;
setBookingAmount(1750);
let r = await pay({
  businessName: "Asha's Cafe", contactName: 'Asha Rao', phone: '9876543210', email: 'asha@example.com',
  paymentChoice: 'booking', amountPaid: 1, invoice: { total: 99999 },
});
check('checkout 200 without a session', r.status === 200, String(r.status));
check('charges the settings amount, ignoring amountPaid: 1', r.body.amount === 1750, String(r.body.amount));
check('ignores a client-inflated invoice for a booking', r.body.amount !== 99999, String(r.body.amount));
check('lead was created', dbHelpers.getLeads().length === leadsBefore + 1);

const newLead = dbHelpers.getLeads().find(l => l.id === r.body.lead_id);
check('lead records the amount actually due', newLead?.amountPaid === 1750, String(newLead?.amountPaid));
check('quoted total is the server\'s own price, not the client invoice', newLead?.amountQuoted === SERVER_QUOTE, String(newLead?.amountQuoted));
check('a client-inflated invoice cannot inflate the balance', newLead?.amountQuoted !== 99999, String(newLead?.amountQuoted));
check('balance after the booking is quoted - booking', r.body.balance_due === SERVER_QUOTE - 1750, String(r.body.balance_due));
check('lead is linked to its payment', !!newLead?.payment_reference && newLead.payment_reference === r.body.reference);
check('lead is source=checkout', newLead?.source === 'checkout');
check('lead cannot be forged into a later pipeline stage', newLead?.status === 'new', newLead?.status);
check('a client-supplied bd_exec_id is not honoured', newLead?.bd_exec_id === undefined, String(newLead?.bd_exec_id));

// A paying customer is the highest-intent lead we get, so checkout also links
// them to a customer account. That account is what the CRM rolls up over time.
check('checkout auto-creates the customer account', !!r.body.company_id, String(r.body.company_id));
const co = dbHelpers.getCompanyById(r.body.company_id);
check('account records the representative', co?.contact_name === 'Asha Rao', co?.contact_name);
check('account is persisted on the lead', newLead?.company_id === co?.id);
{
  const before = dbHelpers.getCompanies().length;
  const anon = await pay({ contactName: 'No Business', phone: '9876543222', paymentChoice: 'booking', invoice: { total: 4321 } });
  check('no businessName → company_id is null', anon.body.company_id === null, String(anon.body.company_id));
  check('and no account row was created', dbHelpers.getCompanies().length === before, `${dbHelpers.getCompanies().length} vs ${before}`);
}
// Same business, different spelling → same account, not a duplicate.
r = await pay({ businessName: 'ASHA\'S CAFE  pvt ltd', contactName: 'Someone Else', phone: '9876543219', paymentChoice: 'booking', invoice: { total: 4321 } });
check('a differently-spelled repeat is deduped onto one account', !!r.body.company_id && r.body.company_id !== null);
check('and it is the same account as before', r.body.company_id === co?.id, `${r.body.company_id} vs ${co?.id}`);
check('representative is not silently swapped by the repeat', dbHelpers.getCompanyById(co.id).contact_name === 'Asha Rao');

// There is no "pay in full" at checkout. The first charge is always the
// booking amount; the balance is requested later against the lead, as the
// campaign progresses. A client asking for the full total must not get it.
r = await pay({ contactName: 'Full Pay', phone: '9876543211', paymentChoice: 'full', invoice: { total: 4321 } });
check('"full" still charges the booking amount, not the campaign total', r.body.amount === 1750, String(r.body.amount));
check('"full" cannot take the quoted total up front', r.body.amount !== SERVER_QUOTE, String(r.body.amount));
check('the rest is recorded as a balance for later', r.body.balance_due === SERVER_QUOTE - 1750, String(r.body.balance_due));
check('the stored lead is booking-first too', dbHelpers.getLeadById(r.body.lead_id)?.amountPaid === 1750, String(dbHelpers.getLeadById(r.body.lead_id)?.amountPaid));

// A tampered booking choice is also ignored — the server reads its own settings.
r = await pay({ contactName: 'Zero Booking', phone: '9876543210', paymentChoice: 'booking', amountPaid: 0, invoice: { total: 1 } });
check('a zeroed amountPaid cannot produce a free campaign', r.body.amount === 1750, String(r.body.amount));

// The intent itself must carry the amount, or the payer could send less.
check('UPI intent locks the charged amount',
  decodeURIComponent(r.body.intent_uri || '').includes('am=1750.00'), decodeURIComponent(r.body.intent_uri || ''));

// Status poll is public but reveals nothing beyond status/amount.
const poll = await (await fetch(`${root}/api/checkout/status/${r.body.reference}`)).json();
check('status poll reports awaiting', poll.status === 'awaiting', poll.status);

// A location with no sheet row is a gap in OUR pricing data, not something the
// customer did wrong. It must still be payable, on the booking amount, and the
// gap has to be recorded so the recee team can price it and bill the balance.
console.log('\n== Test 12b: an unpriced location is still payable ==');
r = await pay({
  businessName: 'Unpriced Tower Co', contactName: 'Ravi Iyer', phone: '9812345678', email: 'ravi@example.com',
  paymentChoice: 'booking',
  selections: [{ name: 'Some Building We Never Synced', type: 'apartments', services: ['digital promotion'] }],
});
check('checkout is NOT rejected for a missing sheet row', r.status === 200, `${r.status}: ${JSON.stringify(r.body).slice(0, 140)}`);
check('it is charged the booking amount', r.body.amount === 1750, String(r.body.amount));
const unpricedLead = dbHelpers.getLeadById(r.body.lead_id);
check('the gap is recorded on the lead', Array.isArray(unpricedLead?.unpricedLocations) && unpricedLead.unpricedLocations.length === 1, JSON.stringify(unpricedLead?.unpricedLocations));
check('nothing was quoted for it', Number(unpricedLead?.amountQuoted) === 0, String(unpricedLead?.amountQuoted));
check('status poll hides counterparty PII',
  !('counterparty_phone' in poll) && !('counterparty_name' in poll), JSON.stringify(Object.keys(poll)));
const missing = await fetch(`${root}/api/checkout/status/does-not-exist`);
check('unknown reference is a 404', missing.status === 404, String(missing.status));

// A dead rail must not cost us the lead.
// A receed location records 0 for services that are confirmed NOT available
// there. That must mean "charge nothing for it", not "free" and not "unknown" —
// so selecting it adds nothing to the cart rather than erroring the checkout.
console.log('\n== a receed 0 price means not available, not free ==');
{
  db.data.records.push({
    id: 2, file_id: 1, row_index: 1, is_active: true,
    data: {
      name: 'Zero Priced Tower', type: 'apartments', source: 'inhouse',
      // digital_promotion was receed as not offered here.
      digital_promotion: 0, lift_promotion: 4000,
      lat: 12.9716, lng: 77.5946,
    },
  });
  await db.write();

  const z = await pay({
    contactName: 'Zero Test', phone: '9876500099', paymentChoice: 'booking',
    invoice: { total: 1 },
    selections: [{ name: 'Zero Priced Tower', type: 'apartments', services: ['digital promotion'] }],
  });
  check('a 0-priced service can be selected without erroring', z.status === 200, JSON.stringify(z.body).slice(0, 120));
  check('and it contributes nothing to the quote', z.body.quoted_total === 0, String(z.body.quoted_total));
  check('the booking fee is still charged', z.body.amount === 1750, String(z.body.amount));

  // Selecting a service that IS priced on the same row still works.
  const z2 = await pay({
    contactName: 'Zero Test 2', phone: '9876500098', paymentChoice: 'booking',
    invoice: { total: 1 },
    selections: [{ name: 'Zero Priced Tower', type: 'apartments', services: ['lift promotion'] }],
  });
  // 4000 + 10% (400) = 4400 + 18% (792) = 5192
  check('a priced service on the same row prices normally', z2.body.quoted_total === 5192, String(z2.body.quoted_total));
}

console.log('\n== Test 13: lead survives a dead payment rail ==');
dbHelpers.getSettings().upi = { ...(dbHelpers.getSettings().upi || {}), collection_vpa: '' };
const leadsBeforeDead = dbHelpers.getLeads().length;
r = await pay({ contactName: 'Dead Rail', phone: '9000000000', paymentChoice: 'booking', invoice: { total: 5000 } });
check('checkout still succeeds with no collection VPA', r.status === 200, String(r.status));
check('lead is still created', dbHelpers.getLeads().length === leadsBeforeDead + 1);
check('customer gets a presentable message', /not switched on|contact us/i.test(r.body.payment_error || ''), r.body.payment_error);
check('no payment reference is invented', r.body.reference === null, String(r.body.reference));
check('rejects a checkout with no name or phone', (await pay({ invoice: { total: 10 } })).status === 400);

// Throttle: the endpoint is public and unauthenticated.
console.log('\n== Test 14: checkout is rate limited ==');
setBookingAmount(999);
let sawLimit = false;
for (let i = 0; i < 20; i++) {
  const res = await pay({ contactName: 'Flood', phone: '9000000001', paymentChoice: 'booking', invoice: { total: 10 } });
  if (res.status === 429) { sawLimit = true; break; }
}
check('repeated requests are eventually refused with 429', sawLimit);

// == Test 15: linking a movement to a customer account ==
// The Accounts tab attaches money to a company. Linking must be explicit and
// validated — a typo'd id should fail loudly, not quietly file money nowhere.
console.log('\n== Test 15: ledger movements link to a company ==');
const rowId = dbHelpers.getPayments()[0].id;
const ledgerCo = dbHelpers.addCompany({ name: 'Ledger Test Cafe', contact_name: 'Ledger Owner' });

let lr = await call('PUT', `/ledger/${rowId}`, { token: mgr, body: { company_id: ledgerCo.id } }).then((r) => r.json());
check('movement links to the account', lr.payment?.company_id === ledgerCo.id, JSON.stringify(lr.payment?.company_id));
check('link is persisted', dbHelpers.getPayments().find((p) => p.id === rowId)?.company_id === ledgerCo.id);

let lrBad = await call('PUT', `/ledger/${rowId}`, { token: mgr, body: { company_id: 999999 } });
check('an unknown company id is rejected', lrBad.status === 400, String(lrBad.status));
check('and the bad link was NOT written', dbHelpers.getPayments().find((p) => p.id === rowId)?.company_id === ledgerCo.id);

let lrClear = await call('PUT', `/ledger/${rowId}`, { token: mgr, body: { company_id: null } }).then((r) => r.json());
check('a link can be removed', lrClear.payment?.company_id === null, JSON.stringify(lrClear.payment?.company_id));

let lrNoPerm = await call('PUT', `/ledger/${rowId}`, { token: tokens.member, body: { company_id: ledgerCo.id } });
check('a member cannot relink money', lrNoPerm.status === 403, String(lrNoPerm.status));

// == Test 16: changing the booking amount follows OPEN requests ==
// The amount on a ledger row is a snapshot — but of a price nobody has paid
// yet when the row is still awaiting. Settings is the single source of truth,
// so retargeting must move awaiting checkout rows (and their QRs, and their
// lead snapshots) while leaving settled money and deliberate staff requests
// exactly as they were.
console.log('\n== Test 16: a booking-amount change follows open requests ==');
{
  // Seed one row of each kind so the filter has something to be right about.
  const seedLead = dbHelpers.addLead({
    businessName: 'Retarget Cafe', contactName: 'Ret Raj', phone: '9876543999',
    status: 'new', source: 'checkout', amountPaid: 1750, bookingAmount: 1750, amountQuoted: 9000,
  });
  const awaitingRow = dbHelpers.addPayment({
    direction: 'in', status: 'awaiting', amount: 1750, currency: 'INR',
    vpa: 'btlbro@okhdfcbank', counterparty_name: 'Ret Raj',
    reference: 'btl_in_retgt_open', created_by_name: 'Checkout',
    intent_uri: 'upi://pay?pa=btlbro@okhdfcbank&am=1750.00&cu=INR&tr=btl_in_retgt_open',
    rail: 'local', lead_id: seedLead.id,
  });
  dbHelpers.updateLead(seedLead.id, {
    payment_id: awaitingRow.id, payment_reference: awaitingRow.reference, payment_status: 'pending',
  });

  const paidRow = dbHelpers.addPayment({
    direction: 'in', status: 'paid', amount: 1750, currency: 'INR',
    vpa: 'btlbro@okhdfcbank', counterparty_name: 'Settled Sam',
    reference: 'btl_in_retgt_paid', created_by_name: 'Checkout', rail: 'local',
    paid_at: new Date().toISOString(),
  });

  const staffRow = dbHelpers.addPayment({
    direction: 'in', status: 'awaiting', amount: 555, currency: 'INR',
    vpa: 'btlbro@okhdfcbank', counterparty_name: 'Deliberate Dave',
    reference: 'btl_in_retgt_staff', created_by_name: 'Asha Rao', rail: 'local',
  });

  // Watch the event bus while the retarget runs — this is the same channel a
  // customer's open checkout tab listens on.
  const seen = [];
  const { subscribePayment } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
  const off = subscribePayment(awaitingRow.reference, (row) => seen.push(row.amount));

  setBookingAmount(1750);
  // settings lives at /api/settings, not under the admin-payments base the
  // `call` helper prefixes, so it is fetched directly with the staff token.
  const putSettings = (payload) => fetch(`${root}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.super_admin}` },
    body: JSON.stringify(payload),
  }).then((x) => x.json());

  const resPut = await putSettings({ payment: { min_booking: 1999 } });

  const rowNow = dbHelpers.getPayments().find((p) => p.id === awaitingRow.id);
  const paidNow = dbHelpers.getPayments().find((p) => p.id === paidRow.id);
  const staffNow = dbHelpers.getPayments().find((p) => p.id === staffRow.id);
  const leadNow = dbHelpers.getLeadById(seedLead.id);

  check('settings save reports how many requests followed', Number(resPut.retargeted) >= 1, String(resPut.retargeted));
  check('the awaiting checkout row is retargeted', rowNow.amount === 1999, String(rowNow.amount));
  check('its QR is rebuilt with the new amount',
    decodeURIComponent(rowNow.intent_uri || '').includes('am=1999.00'),
    decodeURIComponent(rowNow.intent_uri || ''));
  check('the settled row is untouched', paidNow.amount === 1750, String(paidNow.amount));
  check('a deliberate staff request is untouched', staffNow.amount === 555, String(staffNow.amount));
  check('the lead snapshot follows the new price', leadNow.bookingAmount === 1999 && leadNow.amountPaid === 1999,
    `${leadNow.bookingAmount}/${leadNow.amountPaid}`);
  check('the retarget reached open checkout tabs on the event bus',
    seen.length >= 1 && seen[seen.length - 1] === 1999, JSON.stringify(seen));

  // Saving the same amount again must not churn rows or claim work done.
  const resAgain = await putSettings({ payment: { min_booking: 1999 } });
  check('re-saving the same amount retargets nothing', resAgain.retargeted === 0, String(resAgain.retargeted));
  off();
}

// == Test 17: the checkout status stream pushes settlements in realtime ==
// Polling works but only as fast as its slowest tick, and it dies on a fixed
// ceiling. The stream must open with a snapshot, push the moment the row
// moves, and close itself once the payment is terminal.
console.log('\n== Test 17: SSE status stream pushes instead of polls ==');
{
  const streamRef = 'btl_in_retgt_open';   // still awaiting from Test 16
  const abort = new AbortController();
  const sseRes = await fetch(`${root}/api/checkout/status/stream/${streamRef}`, { signal: abort.signal });
  check('stream opens as event-stream', sseRes.status === 200
    && (sseRes.headers.get('content-type') || '').includes('text/event-stream'),
    `${sseRes.status} ${sseRes.headers.get('content-type')}`);

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  async function nextEvent(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) return JSON.parse(dataLine.slice(6));
        continue;                                   // heartbeat comment, skip
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('SSE frame timeout');
      const result = await Promise.race([
        reader.read(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SSE frame timeout')), left)),
      ]);
      if (result.done) return null;
      buf += decoder.decode(result.value, { stream: true });
    }
  }

  try {
    const snap = await nextEvent();
    check('first frame is a snapshot of the current state', snap?.reference === streamRef && snap?.status === 'awaiting',
      JSON.stringify(snap));
    check('the snapshot carries the retargeted amount', snap?.amount === 1999, String(snap?.amount));
    check('and the QR the customer should be showing', !!snap?.intent_uri, String(snap?.intent_uri));

    // Settle it the way the gateway callback or a staff mark-paid does.
    const liveId = dbHelpers.getPayments().find((p) => p.reference === streamRef).id;
    await call('PUT', `/ledger/${liveId}`, { token: mgr, body: { status: 'paid' } });

    const pushed = await nextEvent();
    check('the settlement is pushed, not waited for', pushed?.status === 'paid' && pushed?.paid === true, JSON.stringify(pushed));

    const after = await nextEvent(2000);
    check('the stream closes itself once the payment is terminal', after === null, String(after));
  } catch (err) {
    check('the stream delivers frames without stalling', false, err.message);
  } finally {
    try { abort.abort(); } catch { /* already closed */ }
  }

  const bad = await fetch(`${root}/api/checkout/status/stream/does-not-exist`);
  check('unknown reference is a 404, not an open-ended stream', bad.status === 404, String(bad.status));
  // A stream for an already-settled row still answers, then ends.
  const doneRes = await fetch(`${root}/api/checkout/status/stream/${streamRef}`);
  const doneBuf = await new Response(doneRes.body).text();
  check('an already-paid reference answers with its terminal state', doneBuf.includes('"paid"'), doneBuf.slice(0, 120));
}

// Cleanup
server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
