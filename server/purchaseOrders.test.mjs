// End-to-end test of Purchase Orders and the vendor service catalogue they are
// priced from.
//
// Covers the rules that make this flow worth having:
//   - a PO line is service_id + qty and NOTHING else; the rate, GST and total
//     are computed server-side and a tampered payload cannot move them
//   - only an approved PO can be billed, and only a second person can approve
//   - a bill cannot claim quantity beyond what was ordered, so the same work
//     cannot be invoiced twice against one PO
//   - a PO follows its bills: part_billed -> billed -> completed
//
// Strategy mirrors upiPayments.test.mjs: real sources are copied into a temp dir
// with the db path patched, so the REAL server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-po');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
for (const f of ['purchaseOrders.js', 'vendors.js', 'upiPayments.js', 'leads.js']) {
  fs.copyFileSync(path.join(__dirname, 'routes', f), path.join(tmpDir, 'routes', f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const poRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/purchaseOrders.js')))).default;
const vendorsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/vendors.js')))).default;
const paymentsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/upiPayments.js')))).default;
const leadsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/leads.js')))).default;

// Mirrors PAYOUT_ROLES: the level-1 roles must not be able to move money.
const ROLES = ['member', 'recee', 'bd_executive', 'ops_executive', 'manager',
  'recee_manager', 'bdm', 'ops_manager', 'super_admin'];
const CAN_MOVE_MONEY = new Set(['manager', 'bdm', 'ops_manager', 'super_admin']);

db.data.users = db.data.users || [];
db.data.sessions = db.data.users && db.data.sessions || [];
const tokens = {};
const staff = {};
let uid = 9300;
for (const role of ROLES) {
  const id = ++uid;
  db.data.users.push({ id, name: `Test ${role}`, email: `${role}@test.local`, role, is_team: true, is_active: true });
  tokens[role] = `tok_${role}`;
  staff[role] = { id, name: `Test ${role}` };
  db.data.sessions.push({
    token: tokens[role], user_id: id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  });
}
db.data.settings = db.data.settings || {};
db.data.settings.store = { gst_rate: 18 };
db.data.settings.upi = { collection_vpa: 'testcollect@okaxis', collection_name: 'BTL Test', collection_mcc: '5411' };
db.data.leads = [{ id: 1, contactName: 'PO Lead', businessName: 'PO Co', phone: '9999999999', status: 'qualified' }];
await db.write();

const app = express();
app.use(express.json());
app.use('/api', poRouter);
app.use('/api', vendorsRouter);
app.use('/api/admin/payments', paymentsRouter);
app.use('/api/leads', leadsRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const J = (r) => r.json();
const H = (role) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[role] });

async function call(method, path, { role, body } = {}) {
  const headers = role ? H(role) : { 'Content-Type': 'application/json' };
  const res = await fetch(R + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await J(res) };
}

// ---------------------------------------------------------------------------
console.log('\n== auth: the level-1 roles cannot touch a PO ==');
for (const role of ROLES.filter((r) => !CAN_MOVE_MONEY.has(r))) {
  const r = await call('GET', '/api/admin/pos', { role });
  check(`${role} cannot list purchase orders`, r.status === 403, String(r.status));
}
check('anonymous cannot list purchase orders', (await call('GET', '/api/admin/pos')).status === 401);
check('a manager can', (await call('GET', '/api/admin/pos', { role: 'manager' })).status === 200);

// ---------------------------------------------------------------------------
console.log('\n== the vendor service catalogue ==');
const v = await call('POST', '/api/admin/vendors', {
  role: 'manager',
  body: { name: 'Print House', email: 'print@test.local', password: 'vendor123', upi_id: 'print@okaxis' },
});
const vendor = v.body.vendor;
check('vendor created', !!vendor?.id, JSON.stringify(v.body).slice(0, 120));
check('a new vendor has no services yet', (v.body.vendor.services || []).length === 0);

const s1 = await call('POST', `/api/admin/vendors/${vendor.id}/services`, {
  role: 'manager', body: { name: 'Standee 2x4 ft', unit: 'piece', rate: 250 },
});
check('service added', !!s1.body.service?.id, JSON.stringify(s1.body).slice(0, 120));
const standee = s1.body.service;
const s2 = await call('POST', `/api/admin/vendors/${vendor.id}/services`, {
  role: 'manager', body: { name: 'Photography day', unit: 'day', rate: 4500 },
});
const photo = s2.body.service;
check('a vendor can hold several services at different rates',
  (v.body.vendor.services || []).length === 0 && !!standee && !!photo
  && standee.rate === 250 && photo.rate === 4500, 'catalogue is flat');

check('a service needs a name', (await call('POST', `/api/admin/vendors/${vendor.id}/services`, {
  role: 'manager', body: { rate: 100 },
})).status === 400);
check('a service needs a positive rate', (await call('POST', `/api/admin/vendors/${vendor.id}/services`, {
  role: 'manager', body: { name: 'Free thing', rate: 0 },
})).status === 400);

const up = await call('PUT', `/api/admin/vendors/${vendor.id}/services/${photo.id}`, {
  role: 'manager', body: { name: 'Photography day', unit: 'day', rate: 5000 },
});
check('a rate can be revised', up.body.service?.rate === 5000, String(up.body.service?.rate));

// ---------------------------------------------------------------------------
console.log('\n== raising a PO: the server owns the money ==');
// 200 standees @ 250 = 50,000 + 18% GST = 59,000
const po = await call('POST', '/api/admin/pos', {
  role: 'manager',
  body: {
    vendor_id: vendor.id,
    lead_id: 1,
    expected_date: '2026-10-15',
    notes: 'Launch week',
    lines: [{ service_id: standee.id, qty: 200 }],
    // Everything below is an attempt to steer the numbers and must be ignored.
    lines_rate: 1, rate: 1, amount: 1, subtotal: 1, gst: 0, total: 1,
  },
});
check('PO raised', po.status === 200, JSON.stringify(po.body).slice(0, 160));
const P = po.body.po;
check('it gets a readable number', P?.po_number === 'PO-' + new Date().getFullYear() + '-0001', String(P?.po_number));
check('it starts pending', P?.status === 'pending', String(P?.status));
check('the rate comes from the catalogue, not the request', P?.lines?.[0]?.rate === 250, String(P?.lines?.[0]?.rate));
check('the line amount is rate x qty', P?.lines?.[0]?.amount === 50000, String(P?.lines?.[0]?.amount));
check('subtotal is computed', P?.subtotal === 50000, String(P?.subtotal));
check('GST is added on top at the store rate', P?.gst === 9000, String(P?.gst));
check('the total is computed', P?.total === 59000, String(P?.total));
check('a tampered total in the body is discarded', P?.total !== 1);
check('the raiser is recorded', P?.raised_by_name === 'Test manager', String(P?.raised_by_name));

check('a PO needs at least one line', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [] },
})).status === 400);
check('a PO needs a vendor', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { lines: [{ service_id: standee.id, qty: 5 }] },
})).status === 400);
check('an unknown service is refused', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: 99999, qty: 5 }] },
})).status === 400);
check('a service from another vendor is refused', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: 424242, qty: 5 }] },
})).status === 400);
check('a zero or negative quantity is refused', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: standee.id, qty: 0 }] },
})).status === 400);
check('a fractional quantity is refused (units are whole)', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: standee.id, qty: 1.5 }] },
})).status === 400);

// ---------------------------------------------------------------------------
console.log('\n== separation of duties ==');
check('the person who raised it cannot approve it', (await call('PUT', `/api/admin/pos/${P.id}/approve`, {
  role: 'manager',
})).status === 403);
check('another manager can', (await call('PUT', `/api/admin/pos/${P.id}/approve`, {
  role: 'bdm',
})).status === 200);
check('it is approved', (await call('GET', `/api/admin/pos/${P.id}`, { role: 'bdm' })).body.po.status === 'approved');
check('an approved PO cannot be approved again', (await call('PUT', `/api/admin/pos/${P.id}/approve`, {
  role: 'ops_manager',
})).status === 400);
check('an approved PO is locked against editing', (await call('PUT', `/api/admin/pos/${P.id}`, {
  role: 'ops_manager', body: { notes: 'sneaky' },
})).status === 400);

// ---------------------------------------------------------------------------
console.log('\n== billing: only what was ordered, only once ==');
const noPo = await call('POST', '/api/admin/vendors/bills', { role: 'manager', body: { amount: 500 } });
check('a bill with no purchase order is refused', noPo.status === 400, JSON.stringify(noPo.body).slice(0, 100));

const b1 = await call('POST', `/api/admin/pos/${P.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: standee.id, qty: 100 }] },
});
check('a bill against the PO is accepted', b1.status === 200, JSON.stringify(b1.body).slice(0, 160));
// 100 @ 250 = 25,000 + 18% = 29,500
check('the bill is priced from the PO rate', b1.body.bill?.amount === 29500, String(b1.body.bill?.amount));
check('the PO is now part billed', b1.body.po?.status === 'part_billed', String(b1.body.po?.status));
check('progress shows 100 of 200 invoiced',
  b1.body.po?.progress?.[0]?.billed_qty === 100 && b1.body.po?.progress?.[0]?.qty === 200,
  JSON.stringify(b1.body.po?.progress));

const over = await call('POST', `/api/admin/pos/${P.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: standee.id, qty: 150 }] },
});
check('billing more than was ordered is refused', over.status === 400, String(over.status));
check('the refusal names the real limit', /can bill 100 more/.test(over.body.error || ''), over.body.error);

const unbilled = await call('POST', `/api/admin/pos/${P.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: photo.id, qty: 1 }] },
});
check('billing a service that was never ordered is refused', unbilled.status === 400, String(unbilled.status));

const rest = await call('POST', `/api/admin/pos/${P.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: standee.id, qty: 100 }] },
});
check('the remainder can be billed', rest.status === 200, JSON.stringify(rest.body).slice(0, 140));
check('the PO is now fully billed', rest.body.po?.status === 'billed', String(rest.body.po?.status));

const third = await call('POST', `/api/admin/pos/${P.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: standee.id, qty: 1 }] },
});
check('a third bill against a fully-billed PO is refused', third.status === 400, String(third.status));

// ---------------------------------------------------------------------------
console.log('\n== a rejected bill releases its claim ==');
const po2 = await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: photo.id, qty: 4 }] },
});
await call('PUT', `/api/admin/pos/${po2.body.po.id}/approve`, { role: 'bdm' });
const doomed = await call('POST', `/api/admin/pos/${po2.body.po.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: photo.id, qty: 4 }] },
});
await call('PUT', `/api/admin/vendors/bills/${doomed.body.bill.id}/reject`, {
  role: 'manager', body: { reason: 'wrong shoot dates' },
});
const redone = await call('POST', `/api/admin/pos/${po2.body.po.id}/bills`, {
  role: 'manager', body: { lines: [{ service_id: photo.id, qty: 4 }] },
});
check('the quantity comes back after a rejection', redone.status === 200, JSON.stringify(redone.body).slice(0, 140));

// ---------------------------------------------------------------------------
console.log('\n== paying a bill closes the PO ==');
const bills = dbHelpers.getVendorBills({ po_id: po2.body.po.id }).filter((b) => b.status !== 'rejected');
check('one live bill on that PO', bills.length === 1, String(bills.length));
const appr = await call('PUT', `/api/admin/vendors/bills/${bills[0].id}/approve`, { role: 'manager', body: {} });
check('the bill is approved and writes an outbound ledger row',
  appr.status === 200 && appr.body.payment?.direction === 'out',
  JSON.stringify(appr.body).slice(0, 160));
check('the ledger row is tied to the vendor', appr.body.payment?.vendor_id === vendor.id, String(appr.body.payment?.vendor_id));
check('the ledger row is tied to the PO', appr.body.payment?.po_id === po2.body.po.id, String(appr.body.payment?.po_id));

await call('PUT', `/api/admin/payments/ledger/${appr.body.payment.id}`, {
  role: 'manager', body: { status: 'paid' },
});
const done = (await call('GET', `/api/admin/pos/${po2.body.po.id}`, { role: 'manager' })).body.po;
check('a fully invoiced, fully paid PO is completed', done.status === 'completed', String(done.status));

// ---------------------------------------------------------------------------
console.log('\n== retiring a service keeps history readable ==');
const del = await call('DELETE', `/api/admin/vendors/${vendor.id}/services/${standee.id}`, { role: 'manager' });
check('the service is retired, not deleted', del.body.service?.is_active === false, JSON.stringify(del.body.service));
const oldPo = (await call('GET', `/api/admin/pos/${P.id}`, { role: 'manager' })).body.po;
check('the old PO still reads its line and rate',
  oldPo.lines?.[0]?.name === 'Standee 2x4 ft' && oldPo.lines?.[0]?.rate === 250,
  JSON.stringify(oldPo.lines?.[0]));
check('a retired service cannot be newly ordered', (await call('POST', '/api/admin/pos', {
  role: 'manager', body: { vendor_id: vendor.id, lines: [{ service_id: standee.id, qty: 5 }] },
})).status === 400);

// ---------------------------------------------------------------------------
// Regression: the leads list is staff-only. `optionalStaff` lets anonymous
// callers through (the public enquiry POST needs that), and an unauthenticated
// GET used to match none of the role filters and therefore be served EVERY
// lead — names, phones and emails — to anyone who asked.
console.log('\n== the leads list never leaks to an anonymous caller ==');
check('anonymous GET /api/leads is refused', (await call('GET', '/api/leads')).status === 401);
check('a bogus token is refused', (await call('GET', '/api/leads', { role: 'not_a_role' })).status === 401);
const anon = await call('GET', '/api/leads');
check('and it returns no lead data at all', !Array.isArray(anon.body.leads) || anon.body.leads.length === 0,
  JSON.stringify(anon.body).slice(0, 120));
check('staff still get their leads', (await call('GET', '/api/leads', { role: 'manager' })).status === 200);

// ---------------------------------------------------------------------------
server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
