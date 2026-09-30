// End-to-end test of the vendor API: self-registration, separate vendor auth,
// bill submission, the admin approve/reject queue, and the payout rail.
//
// Strategy mirrors upiPayments.test.mjs: the real sources are copied into a
// temp dir with the db path patched, so the REAL server/data/db.json is never
// touched. This suite used to run against the live API on :8082 and left
// vendors, bills, payouts and notifications behind on every run.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-vendors');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);

// Copy the whole service/middleware trees rather than chasing imports one by
// one — they pull in each other (sheetBackfill -> gmapLink, notify -> whatsapp).
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
for (const f of ['vendors.js', 'orders.js', 'upiPayments.js', 'purchaseOrders.js']) {
  fs.copyFileSync(path.join(__dirname, 'routes', f), path.join(tmpDir, 'routes', f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const vendorsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/vendors.js')))).default;
const ordersRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/orders.js')))).default;
const paymentsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/upiPayments.js')))).default;
const poRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/purchaseOrders.js')))).default;

// One staff session per role, mirroring PAYOUT_ROLES in routes/vendors.js.
const ROLES = ['member', 'recee', 'bd_executive', 'ops_executive', 'manager',
  'recee_manager', 'bdm', 'ops_manager', 'super_admin'];
const CAN_MOVE_MONEY = new Set(['manager', 'bdm', 'ops_manager', 'super_admin']);

db.data.users = db.data.users || [];
db.data.sessions = db.data.sessions || [];
const tokens = {};
let uid = 9100;
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
await db.write();

const app = express();
app.use(express.json());
app.use('/api', vendorsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin/payments', paymentsRouter);
app.use('/api', poRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

const j = (r) => r.json();
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
};

const admin = { token: tokens.super_admin, user: { id: db.data.users.find((u) => u.role === 'super_admin').id, name: 'Test super_admin' } };
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.token };
const none = { 'Content-Type': 'application/json' };
// A PO must be approved by someone other than the person who raised it.
const MH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.manager };

console.log('\n== auth holes closed ==');
let r = await fetch(R + '/api/orders');
check('GET /api/orders anonymous is refused', r.status === 401, 'got ' + r.status);

r = await fetch(R + '/api/orders/1', { method: 'PUT', headers: none, body: JSON.stringify({ status: 'cancelled' }) });
check('PUT /api/orders anonymous is refused', r.status === 401, 'got ' + r.status);

r = await fetch(R + '/api/orders/1', { method: 'DELETE', headers: none });
check('DELETE /api/orders anonymous is refused', r.status === 401, 'got ' + r.status);

r = await fetch(R + '/api/orders', { headers: { Authorization: 'Bearer ' + admin.token } });
check('GET /api/orders still works for staff', r.status === 200, 'got ' + r.status);

console.log('\n== vendor self-registration ==');
const email = `vendor${Date.now()}@test.com`;
r = await fetch(R + '/api/vendors/register', {
  method: 'POST', headers: none,
  body: JSON.stringify({
    name: 'Ramesh Prints', business_name: 'Ramesh Print House',
    email, phone: '9876500011', upi_id: 'ramesh@ybl', category: 'printing', rate: 450,
    password: 'vendor123',
  }),
});
const reg = await j(r);
check('vendor registers', r.status === 200 && !!reg.token, JSON.stringify(reg).slice(0, 120));
const VT = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token };

r = await fetch(R + '/api/vendors/register', { method: 'POST', headers: none, body: JSON.stringify({ name: 'Dup', email, password: 'vendor123' }) });
check('duplicate vendor email refused', r.status === 409, 'got ' + r.status);

r = await fetch(R + '/api/vendors/register', { method: 'POST', headers: none, body: JSON.stringify({ name: 'Bad', email: `b${Date.now()}@t.com`, upi_id: 'not-a-vpa', password: 'vendor123' }) });
check('invalid UPI ID refused', r.status === 400, 'got ' + r.status);

r = await fetch(R + '/api/vendors/register', { method: 'POST', headers: none, body: JSON.stringify({ name: 'Short', email: `s${Date.now()}@t.com`, password: '123' }) });
check('short password refused', r.status === 400, 'got ' + r.status);

console.log('\n== vendor isolation ==');
r = await fetch(R + '/api/vendors/me');
check('vendor portal needs a token', r.status === 401, 'got ' + r.status);
r = await fetch(R + '/api/vendors/me', { headers: { Authorization: 'Bearer ' + admin.token } });
check('a STAFF token cannot use the vendor portal', r.status === 401, 'got ' + r.status);
r = await fetch(R + '/api/vendors/me', { headers: VT });
const me = await j(r);
check('vendor sees itself', r.status === 200 && me.vendor.email === email);
check('vendor response hides the password hash', me.vendor.password_hash === undefined);

// Bills no longer carry a typed-in amount. Staff price the vendor's services
// once, commit to a quantity on a PO, and the vendor invoices against that PO.
console.log('\n== staff build the price list, then commit to a PO ==');
r = await fetch(R + `/api/admin/vendors/${reg.vendor.id}/services`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: 'Standee 2x4 ft', unit: 'piece', rate: 1000 }),
});
const svc = await j(r);
check('a service is added to the vendor price list', svc.service?.id > 0, JSON.stringify(svc).slice(0, 120));

// 1 standee @ 1000 + 18% GST = 1180
r = await fetch(R + '/api/admin/pos', {
  method: 'POST', headers: H,
  body: JSON.stringify({ vendor_id: reg.vendor.id, lines: [{ service_id: svc.service.id, qty: 1 }], total: 1 }),
});
const poRes = await j(r);
check('PO raised', r.status === 200 && !!poRes.po?.id, JSON.stringify(poRes).slice(0, 140));
check('the server prices the PO, ignoring the sent total', poRes.po?.total === 1180, String(poRes.po?.total));
const po = poRes.po;

r = await fetch(R + '/api/vendors/bills', {
  method: 'POST', headers: VT, body: JSON.stringify({ po_id: po.id, lines: [{ service_id: svc.service.id, qty: 1 }] }),
});
const early = await j(r);
check('a vendor cannot bill an unapproved PO', r.status === 400 && /only an approved one/.test(early.error || ''), r.status + ' ' + early.error);

r = await fetch(R + `/api/admin/pos/${po.id}/approve`, { method: 'PUT', headers: MH, body: JSON.stringify({}) });
check('a second manager approves the PO', r.status === 200, 'got ' + r.status);

console.log('\n== vendor submits a bill against the PO ==');
r = await fetch(R + '/api/vendors/bills', {
  method: 'POST', headers: VT,
  body: JSON.stringify({ po_id: po.id, lines: [{ service_id: svc.service.id, qty: 1, rate: 1 }] }),
});
const bill = await j(r);
check('vendor submits a bill', r.status === 200 && bill.bill.status === 'pending', JSON.stringify(bill).slice(0, 120));
check('the bill is priced from the PO rate, not the request', bill.bill?.amount === 1180, String(bill.bill?.amount));

r = await fetch(R + '/api/vendors/bills', { method: 'POST', headers: VT, body: JSON.stringify({ po_id: po.id, lines: [{ service_id: svc.service.id, qty: -5 }] }) });
check('negative bill refused', r.status === 400, 'got ' + r.status);

r = await fetch(R + '/api/vendors/bills', { method: 'POST', headers: VT, body: JSON.stringify({ lines: [{ service_id: svc.service.id, qty: 1 }] }) });
check('a bill with no purchase order refused', r.status === 400, 'got ' + r.status);

console.log('\n== staff bill queue ==');
r = await fetch(R + '/api/admin/vendors/bills', { headers: none });
check('bill queue needs staff', r.status === 401, 'got ' + r.status);
r = await fetch(R + '/api/admin/vendors/bills', { headers: H });
const queue = await j(r);
check('staff sees the bill', r.status === 200 && queue.bills.some((b) => b.id === bill.bill.id));

console.log('\n== approving pays into the ledger ==');
r = await fetch(R + `/api/admin/vendors/bills/${bill.bill.id}/approve`, { method: 'PUT', headers: H, body: JSON.stringify({}) });
const appr = await j(r);
check('approve 200', r.status === 200, JSON.stringify(appr).slice(0, 160));
check('ledger row created', !!appr.payment?.id, 'no payment row');
check('direction is out', appr.payment?.direction === 'out');
check('linked to the vendor', appr.payment?.vendor_id === reg.vendor.id);
check('linked to the bill', appr.payment?.vendor_bill_id === bill.bill.id);
check('employee attribution recorded', appr.payment?.created_by_name === admin.user.name, appr.payment?.created_by_name);
check('company deliberately NOT set', appr.payment?.company_id === null, String(appr.payment?.company_id));
check('a UPI intent was built', String(appr.intent_uri || '').startsWith('upi://pay?'), String(appr.intent_uri).slice(0, 60));
check('intent carries the amount', String(appr.intent_uri || '').includes('am=1180'));

const paymentId = appr.payment.id;

// The row shows in the shared ledger.
r = await fetch(R + '/api/admin/payments/ledger', { headers: H });
const ledger = await j(r);
check('payout is in the shared ledger', ledger.payments.some((p) => p.id === paymentId));

console.log('\n== settle it: approval then paid ==');
r = await fetch(R + `/api/admin/payments/ledger/${paymentId}`, { method: 'PUT', headers: H, body: JSON.stringify({ status: 'paid' }) });
check('marked paid', r.status === 200, 'got ' + r.status);

r = await fetch(R + '/api/vendors/me', { headers: VT });
const me2 = await j(r);
check('vendor sees the payout as paid', me2.payouts.some((p) => p.id === paymentId && p.status === 'paid'));
check('bill follows its payment to paid', me2.bills.some((b) => b.id === bill.bill.id && b.status === 'paid'), JSON.stringify(me2.bills.map((b) => b.id + ':' + b.status)));
check('vendor totals show money paid', me2.totals.paid === 1180, String(me2.totals.paid));

console.log('\n== automatic notifications ==');
r = await fetch(R + '/api/admin/vendors', { headers: H });
const vendors = await j(r);
check('vendor list with totals', r.status === 200 && vendors.vendors.length > 0);
const vrow = vendors.vendors.find((v) => v.id === reg.vendor.id);
check('totals.paid rolled up on the vendor', vrow?.totals?.paid === 1180, JSON.stringify(vrow?.totals));

console.log('\n== guards ==');
r = await fetch(R + `/api/admin/vendors/bills/${bill.bill.id}/approve`, { method: 'PUT', headers: H, body: JSON.stringify({}) });
check('cannot approve an already-approved bill', r.status === 400, 'got ' + r.status);

const noUpi = await fetch(R + '/api/admin/vendors', {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: 'No UPI Co', email: `nou${Date.now()}@t.com`, password: 'vendor123' }),
});
const noUpiId = (await j(noUpi)).vendor.id;
const noUpiSvc = (await j(await fetch(R + `/api/admin/vendors/${noUpiId}/services`, {
  method: 'POST', headers: H, body: JSON.stringify({ name: 'Anything', unit: 'unit', rate: 100 }),
}))).service;
const noUpiPo = await j(await fetch(R + '/api/admin/pos', {
  method: 'POST', headers: H, body: JSON.stringify({ vendor_id: noUpiId, lines: [{ service_id: noUpiSvc.id, qty: 1 }] }),
}));
await fetch(R + `/api/admin/pos/${noUpiPo.po.id}/approve`, { method: 'PUT', headers: MH, body: JSON.stringify({}) });
const b2 = await j(await fetch(R + '/api/admin/vendors/bills', {
  method: 'POST', headers: H, body: JSON.stringify({ po_id: noUpiPo.po.id, lines: [{ service_id: noUpiSvc.id, qty: 1 }] }),
}));
r = await fetch(R + `/api/admin/vendors/bills/${b2.bill.id}/approve`, { method: 'PUT', headers: H, body: JSON.stringify({}) });
check('cannot pay a vendor with no UPI ID', r.status === 400 && /UPI ID/.test((await j(r)).error), 'got ' + r.status);

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
