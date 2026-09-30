// End-to-end test of the recee site-survey verification flow.
//
// The claim under test: a location only becomes OURS (inhouse) when someone
// actually stood there. Concretely —
//   1. a request carries the target location's coordinates
//   2. the server recomputes the distance on submit and never trusts the client
//   3. a capture outside 200m is parked for review, not silently accepted
//   4. a 0 service price means "confirmed not available", not "unknown"
//   5. only a verified, priced capture flips a google row to inhouse, and the
//      google provenance is kept so the flip stays explainable
//   6. a manager can accept a bad capture, attributed
//
// Strategy mirrors upiPayments.test.mjs: real sources copied into a temp dir
// with the db path patched, so the REAL server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-recee');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'routes', 'recee.js'), path.join(tmpDir, 'routes', 'recee.js'));

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const receeRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes', 'recee.js')))).default;

const ROLES = ['recee', 'recee_manager', 'bd_executive', 'ops_executive', 'manager',
  'bdm', 'ops_manager', 'super_admin'];
const tokens = {};
const staff = {};
let uid = 9400;
db.data.users = db.data.users || [];
db.data.sessions = db.data.sessions || [];
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

// A Google-flagged location with coordinates and an unpriced service list —
// exactly the shape a Nearby-search result has.
db.data.records = [{
  id: 1, file_id: 1, row_index: 0,
  data: {
    name: 'Prestige Kingfisher Towers', type: 'apartment services',
    lat: 12.9716, lng: 77.5946, source: 'google',
    services: { standee: 0, 'digital notification': 0 },
    is_active: true,
  },
}];
await db.write();

const app = express();
app.use(express.json());
app.use('/api/recee', receeRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const J = (r) => r.json();
const H = (role) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[role] });

async function call(m, p, { role, body } = {}) {
  const res = await fetch(R + p, { method: m, headers: role ? H(role) : H('manager'), body: body && JSON.stringify(body) });
  return { status: res.status, body: await J(res) };
}

// Target: the seeded record. ~111 m per 0.001 degree of latitude at this
// latitude, so these offsets are easy to reason about.
const T = { lat: 12.9716, lng: 77.5946 };

// ---------------------------------------------------------------------------
console.log('\n== the request carries the target location ==');
let r = await call('POST', '/api/recee/requests', {
  role: 'ops_manager',
  body: {
    title: 'Prestige Kingfisher Towers', address: 'Lavelle Road, Bengaluru',
    record_id: 1, services: [{ name: 'standee' }, { name: 'digital notification' }],
  },
});
check('ops manager can create a request', r.status === 200, JSON.stringify(r.body).slice(0, 140));
const req1 = r.body.survey;
check('it inherits the record coordinates', req1?.target_lat === T.lat && req1?.target_lng === T.lng,
  `${req1?.target_lat},${req1?.target_lng}`);
check('it knows which record it is for', req1?.record_id === 1, String(req1?.record_id));
check('it knows that record was a Google listing', req1?.target_source === 'google', String(req1?.target_source));
check('it is verifiable, so it starts as pending', req1?.status === 'new', String(req1?.status));

r = await call('POST', '/api/recee/requests', { role: 'recee', body: { title: 'x', address: 'y' } });
check('a recee executive cannot create requests', r.status === 403, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n== assign it to the recee executive ==');
r = await call('PUT', `/api/recee/surveys/${req1.id}/assign`, { role: 'ops_manager', body: { assigned_to_id: staff.recee.id } });
check('ops manager assigns', r.status === 200, JSON.stringify(r.body).slice(0, 140));
check('the assignee is recorded', r.body.survey?.assigned_to_id === staff.recee.id, String(r.body.survey?.assigned_to_id));
r = await call('PUT', `/api/recee/surveys/${req1.id}/assign`, { role: 'ops_manager', body: { assigned_to_id: staff.bd_executive.id } });
check('it cannot be assigned to a non-recee', r.status === 400, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n== a capture from far away is refused ==');
// ~1.1 km north of the target.
r = await call('POST', '/api/recee/submit', {
  role: 'recee',
  body: {
    request_id: req1.id, lat: 12.9816, lng: 77.5946, accuracy: 10,
    manager_name: 'Ramesh', manager_phone: '9999999999', address: 'Lavelle Road',
    prices: [{ name: 'standee', price: 250 }, { name: 'digital notification', price: 3500 }],
  },
});
check('the capture is accepted but NOT marked done', r.body.survey?.status === 'needs_review',
  String(r.body.survey?.status));
check('verification reports the failure', r.body.verification?.ok === false, JSON.stringify(r.body.verification));
check('it reports the real distance', r.body.verification?.distance_m > 1000, String(r.body.verification?.distance_m));
check('the record is NOT promoted to inhouse', dbHelpers.recordSource(dbHelpers.getRecordById(1)) === 'google',
  dbHelpers.recordSource(dbHelpers.getRecordById(1)));
check('the record is not marked verified', dbHelpers.getRecordById(1).data.verified !== true,
  JSON.stringify(dbHelpers.getRecordById(1).data.verified));

// ---------------------------------------------------------------------------
console.log('\n== accuracy is added to the distance, not ignored ==');
// 150 m away with a 100 m accuracy error: 250 m effective, so refused.
let far = await call('POST', '/api/recee/requests', {
  role: 'ops_manager', body: { title: 't', address: 'a', record_id: 1, lat: T.lat, lng: T.lng },
});
far = await call('PUT', `/api/recee/surveys/${far.body.survey.id}/assign`, { role: 'ops_manager', body: { assigned_to_id: staff.recee.id } });
r = await call('POST', '/api/recee/submit', {
  role: 'recee',
  body: { request_id: far.body.survey.id, lat: 12.9730, lng: 77.5946, accuracy: 100, address: 'a', manager_name: 'm', manager_phone: '1' },
});
check('distance + accuracy over the limit is refused', r.body.survey?.status === 'needs_review', String(r.body.survey?.status));

// A hopeless accuracy (5 km error circle) is not treated as proof of anything.
r = await call('POST', '/api/recee/submit', {
  role: 'recee',
  body: { request_id: far.body.survey.id, lat: T.lat + 0.00001, lng: T.lng, accuracy: 5000, address: 'a', manager_name: 'm', manager_phone: '1' },
});
check('a useless GPS accuracy is rejected outright', r.body.verification?.reason === 'accuracy_too_low',
  JSON.stringify(r.body.verification));

// ---------------------------------------------------------------------------
console.log('\n== a genuine on-site capture completes and promotes the record ==');
r = await call('POST', '/api/recee/requests', {
  role: 'ops_manager',
  body: { title: 'Prestige Kingfisher Towers', address: 'Lavelle Road', record_id: 1, services: [{ name: 'standee' }, { name: 'digital notification' }] },
});
const req2 = r.body.survey;
await call('PUT', `/api/recee/surveys/${req2.id}/assign`, { role: 'ops_manager', body: { assigned_to_id: staff.recee.id } });

// ~30 m north, 12 m accuracy: comfortably inside.
r = await call('POST', '/api/recee/submit', {
  role: 'recee',
  body: {
    request_id: req2.id, lat: T.lat + 0.00027, lng: T.lng, accuracy: 12,
    manager_name: 'Ramesh Kumar', manager_phone: '9880000111', address: 'Lavelle Road, Bengaluru',
    notes: 'Gate 2, ask for facilities',
    // A 0 here is the key case: confirmed NOT available at this site.
    prices: [{ name: 'standee', price: 250 }, { name: 'digital notification', price: 0 }],
  },
});
check('an on-site capture is done', r.body.survey?.status === 'done', String(r.body.survey?.status));
check('verification passes', r.body.verification?.ok === true, JSON.stringify(r.body.verification));
check('the distance is recorded for the audit trail', Number.isFinite(r.body.verification?.distance_m),
  String(r.body.verification?.distance_m));

const rec = dbHelpers.getRecordById(1).data;
check('the record is now inhouse', dbHelpers.recordSource(dbHelpers.getRecordById(1)) === 'inhouse',
  dbHelpers.recordSource(dbHelpers.getRecordById(1)));
check('the google provenance is KEPT', rec.original_source === 'google', String(rec.original_source));
check('we can see who receed it', rec.surveyed_by === 'Test recee', String(rec.surveyed_by));
check('and when', !!rec.surveyed_at, String(rec.surveyed_at));
check('it records how it was verified', rec.verification_method === 'site_survey', String(rec.verification_method));
check('the positive price landed', rec.services.standee === 250, String(rec.services.standee));
check('the 0 is stored as 0 — confirmed not available, not missing', rec.services['digital notification'] === 0,
  String(rec.services['digital notification']));
check('the manager contact is captured', rec.manager_contact?.name === 'Ramesh Kumar',
  JSON.stringify(rec.manager_contact));

check('a done request cannot be resubmitted', (await call('POST', '/api/recee/submit', {
  role: 'recee', body: { request_id: req2.id, lat: T.lat, lng: T.lng, accuracy: 10, address: 'a', manager_name: 'm', manager_phone: '1' },
})).status === 409);

// ---------------------------------------------------------------------------
console.log('\n== a manager can accept a capture the radius rejected ==');
r = await call('PUT', `/api/recee/surveys/${req1.id}/override`, { role: 'recee', body: { reason: 'nope' } });
check('a recee executive cannot wave through their own bad capture', r.status === 403, String(r.status));
r = await call('PUT', `/api/recee/surveys/${req1.id}/override`, { role: 'manager', body: { reason: '' } });
check('a reason is required', r.status === 400, String(r.status));
r = await call('PUT', `/api/recee/surveys/${req1.id}/override`, { role: 'manager', body: { reason: 'GPS dead in the basement lobby' } });
check('a manager can accept it', r.status === 200 && r.body.survey?.status === 'done', JSON.stringify(r.body).slice(0, 160));
check('the override is attributed', r.body.survey?.override_by === 'Test manager', String(r.body.survey?.override_by));
check('the override reason is kept', /basement/.test(r.body.survey?.override_reason || ''), String(r.body.survey?.override_reason));
check('it is flagged as an override, not a clean verification', r.body.survey?.verified_by_override === true,
  String(r.body.survey?.verified_by_override));
check('the original distance is still on the record', Number.isFinite(r.body.survey?.geo?.distance_m),
  String(r.body.survey?.geo?.distance_m));

// ---------------------------------------------------------------------------
console.log('\n== source casing is read through one normaliser ==');
db.data.records.push({ id: 2, file_id: 1, row_index: 1, data: { name: 'X', source: 'Inhouse', is_active: true } });
db.data.records.push({ id: 3, file_id: 1, row_index: 2, data: { name: 'Y', source: 'from google', is_active: true } });
check('"Inhouse" reads as inhouse', dbHelpers.recordSource(dbHelpers.getRecordById(2)) === 'inhouse');
check('"from google" reads as google', dbHelpers.recordSource(dbHelpers.getRecordById(3)) === 'google');

console.log('\n== distance maths ==');
check('identical points are 0 m apart', dbHelpers.distanceMeters(T.lat, T.lng, T.lat, T.lng) === 0);
check('~1.1 km north measures about right',
  Math.abs(dbHelpers.distanceMeters(T.lat, T.lng, T.lat + 0.01, T.lng) - 1112) < 20,
  String(dbHelpers.distanceMeters(T.lat, T.lng, T.lat + 0.01, T.lng)));
check('missing coordinates are not "close"', dbHelpers.isWithinCaptureRadius(null, null, T.lat, T.lng, 5).ok === false);

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
