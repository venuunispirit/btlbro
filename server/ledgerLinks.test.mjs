// End-to-end test of attributed collection: a ledger row tagged to a lead or a
// shop order, and the per-record money rollup that reads those tags.
//
// Strategy mirrors upiPayments.test.mjs: real sources copied into a temp dir
// with the db path patched, so the REAL server/data/db.json is never touched.
// This suite used to run against the live API and mutated real leads and
// orders on every run.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-links');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
for (const f of ['upiPayments.js', 'leads.js', 'orders.js', 'auth.js', 'shop.js', 'companies.js']) {
  fs.copyFileSync(path.join(__dirname, 'routes', f), path.join(tmpDir, 'routes', f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const paymentsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/upiPayments.js')))).default;
const leadsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/leads.js')))).default;
const ordersRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/orders.js')))).default;
const authRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/auth.js')))).default;
const shopRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/shop.js')))).default;
const companiesRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/companies.js')))).default;

const ROLES = ['member', 'recee', 'bd_executive', 'ops_executive', 'manager',
  'recee_manager', 'bdm', 'ops_manager', 'super_admin'];

db.data.users = db.data.users || [];
db.data.sessions = db.data.sessions || [];
const tokens = {};
let uid = 9200;
for (const role of ROLES) {
  const id = ++uid;
  db.data.users.push({ id, name: `Test ${role}`, email: `${role}@test.local`, role, is_team: true, is_active: true });
  tokens[role] = `tok_${role}`;
  db.data.sessions.push({
    token: tokens[role], user_id: id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  });
}

// One real lead and one real shop order to collect against.
db.data.leads = [{
  id: 1, contactName: 'Sandbox Lead', businessName: 'Sandbox Co', email: 'lead@test.local',
  phone: '9999999999', status: 'new', source: 'checkout',
}];
db.data.shop_orders = [{
  id: 1, user: { name: 'Sandbox Buyer', email: 'buyer@test.local' },
  items: [{ name: 'Poster', qty: 1, price: 500 }], total: 500,
  status: 'placed', payment_status: 'pending', created_at: new Date().toISOString(),
}];
// The collect rail refuses to build a request without a collection VPA.
db.data.settings = db.data.settings || {};
db.data.settings.upi = { collection_vpa: 'testcollect@okaxis', collection_name: 'BTLbro Test', collection_mcc: '5411' };
await db.write();

const app = express();
app.use(express.json());
app.use('/api/admin/payments', paymentsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auth', authRouter);
app.use('/api/shop', shopRouter);
app.use('/api/admin/companies', companiesRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const J = (r) => r.json();

const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.super_admin };
const staffName = 'Test super_admin';
const none = { 'Content-Type': 'application/json' };

console.log('\n== collect against a lead ==');
const leads = await J(await fetch(R + '/api/leads', { headers: H }));
const lead = leads.leads[0];
check('a lead exists to collect against', !!lead, 'none');

let r = await fetch(R + '/api/admin/payments/collect/for', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'lead', id: lead.id, amount: 777, note: 'Part payment' }) });
let res = await J(r);
check('collect 200', r.status === 200, JSON.stringify(res).slice(0, 140));
check('ledger row has lead_id', res.payment?.lead_id === lead.id, String(res.payment?.lead_id));
check('ledger row has NO order_id', res.payment?.order_id == null, String(res.payment?.order_id));
check('direction is in', res.payment?.direction === 'in');
check('employee attribution kept', res.payment?.created_by_name === staffName, res.payment?.created_by_name);
check('intent built for the amount', String(res.intent_uri || '').includes('am=777'));

r = await fetch(R + '/api/admin/payments/collect/for', { method: 'POST', headers: none, body: JSON.stringify({ kind: 'lead', id: lead.id, amount: 10 }) });
check('anonymous collect refused', r.status === 401, 'got ' + r.status);

r = await fetch(R + '/api/admin/payments/collect/for', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'lead', id: 999999, amount: 10 }) });
check('unknown lead refused', r.status === 404, 'got ' + r.status);

r = await fetch(R + '/api/admin/payments/collect/for', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'lead', id: lead.id, amount: -3 }) });
check('negative amount refused', r.status === 400, 'got ' + r.status);

console.log('\n== lead money rollup ==');
r = await fetch(R + `/api/admin/payments/for/lead/${lead.id}`, { headers: H });
let roll = await J(r);
check('rollup 200', r.status === 200);
check('pending_in counted', roll.pending_in === 777, String(roll.pending_in));
check('received still zero (unpaid)', roll.received === 0, String(roll.received));
check('lists the payment', roll.count >= 1, String(roll.count));

// settle it, then the rollup must move
const pid = res.payment.id;
r = await fetch(R + `/api/admin/payments/ledger/${pid}`, { method: 'PUT', headers: H, body: JSON.stringify({ status: 'paid' }) });
check('marked paid', r.status === 200);
roll = await J(await fetch(R + `/api/admin/payments/for/lead/${lead.id}`, { headers: H }));
check('received now 777', roll.received === 777, String(roll.received));
check('pending_in back to 0', roll.pending_in === 0, String(roll.pending_in));
check('net positive', roll.net === 777, String(roll.net));

console.log('\n== collect against a shop order ==');
// make an order
r = await fetch(R + '/api/shop/checkout', { method: 'POST', headers: H, body: JSON.stringify({ items: [{ key: 'rollup-probe', product_id: 1, name: 'Probe', qty: 1, unit_price: 500 }], address: { line1: '1 St', city: 'Delhi', pin: '110001', phone: '9999999999' }, notes: 'rollup probe' }) });
const order = await J(r);
check('shop order created', r.status === 200 && !!order.order_id, JSON.stringify(order).slice(0, 120));

r = await fetch(R + '/api/admin/payments/collect/for', { method: 'POST', headers: H, body: JSON.stringify({ kind: 'order', id: order.order_id, amount: 590, note: 'Order payment' }) });
res = await J(r);
check('order collect 200', r.status === 200, JSON.stringify(res).slice(0, 140));
check('ledger row has order_id', res.payment?.order_id === order.order_id, String(res.payment?.order_id));
check('ledger row has NO lead_id', res.payment?.lead_id == null, String(res.payment?.lead_id));
check('NO company created for a product order', res.payment?.company_id == null, String(res.payment?.company_id));

console.log('\n== product orders create no company ==');
const before = (await J(await fetch(R + '/api/admin/companies', { headers: H }))).total;
await fetch(R + '/api/shop/checkout', { method: 'POST', headers: H, body: JSON.stringify({ items: [{ key: 'nc-probe', product_id: 1, name: 'P', qty: 1, unit_price: 100 }], address: { line1: '2 St', city: 'Delhi', pin: '110001', phone: '9999999999' }, notes: 'no company probe' }) });
const after = (await J(await fetch(R + '/api/admin/companies', { headers: H }))).total;
check('company count unchanged by product orders', before === after, `${before} -> ${after}`);

roll = await J(await fetch(R + `/api/admin/payments/for/order/${order.order_id}`, { headers: H }));
check('order rollup 200', roll.kind === 'order');
check('order pending_in counted', roll.pending_in === 590, String(roll.pending_in));

console.log('\n== order row reflects the request ==');
const orders = await J(await fetch(R + '/api/orders', { headers: H }));
const mine = orders.orders.find((o) => o.id === order.order_id);
check('order marked payment pending', mine?.payment_status === 'pending', mine?.payment_status);

console.log('\n== the Paid column: received sums every collection ==');
// The Leads table shows amount_received. It must be the money that has actually
// landed across the booking AND the later progress payment, not just the first
// request and not the amount merely asked for.
{
  const { leads } = await J(await fetch(R + '/api/leads', { headers: H }));
  const l = leads.find((x) => x.id === lead.id);

  check('received counts only settled money', l.amount_received === 777, String(l.amount_received));
  check('an unsettled request is pending, not received', l.amount_pending === 0, String(l.amount_pending));
  check('the quoted campaign total is carried for the table', l.amount_quoted === 0, String(l.amount_quoted));

  // Ask for more money against the same lead.
  const second = await J(await fetch(R + '/api/admin/payments/collect/for', {
    method: 'POST', headers: H, body: JSON.stringify({ kind: 'lead', id: lead.id, amount: 500, note: 'Second' }),
  }));
  check('a second collection is accepted', second.payment?.id > 0, JSON.stringify(second).slice(0, 100));

  const mid = (await J(await fetch(R + '/api/leads', { headers: H }))).leads.find((x) => x.id === lead.id);
  check('an unpaid collection does NOT inflate received', mid.amount_received === 777, String(mid.amount_received));
  check('it shows as pending instead', mid.amount_pending === 500, String(mid.amount_pending));

  await fetch(R + `/api/admin/payments/ledger/${second.payment.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ status: 'paid' }) });
  const after = (await J(await fetch(R + '/api/leads', { headers: H }))).leads.find((x) => x.id === lead.id);
  check('received accumulates across both collections', after.amount_received === 1277, String(after.amount_received));
  check('pending clears once it lands', after.amount_pending === 0, String(after.amount_pending));

  // Money going OUT (a vendor bill) must never look like customer income.
  // Outgoing rows are minted by the vendor bill-approval flow, which needs the
  // vendors router, so seed the row directly and assert only the aggregation.
  db.data.payments.push({
    reference: 'out_probe_1', direction: 'out', status: 'paid', amount: 300,
    lead_id: lead.id, order_id: null, company_id: null, note: 'Vendor bill',
    created_at: new Date().toISOString(),
  });
  await db.write();
  const withOut = (await J(await fetch(R + '/api/leads', { headers: H }))).leads.find((x) => x.id === lead.id);
  check('outgoing spend is excluded from received', withOut.amount_received === 1277, String(withOut.amount_received));
  check('outgoing spend is not counted as pending either', withOut.amount_pending === 0, String(withOut.amount_pending));
}

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

process.exit(fail ? 1 : 0);
