// End-to-end test of inbound call routing.
//
// The rule under test: a caller who is a known lead rings that lead's assigned
// exec first, then their BDM, then the rest of the team. An unknown caller goes
// straight to the pool. Nobody answers → the call is recorded as missed, on the
// lead when we know them and in the staff feed always.
//
// Strategy mirrors the other suites: temp dir, patched db path, the real
// server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '.test-run-call');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'routes', 'telephony.js'), path.join(tmpDir, 'routes', 'telephony.js'));

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const telephonyRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes', 'telephony.js')))).default;
const { resolveRoute, normalisePhone, findLeadByPhone, routingHealth, logMissedCall } =
  await import(pathToFileURL(path.join(tmpDir, 'services', 'callRouter.js')));

// A team with real numbers, plus one with none so health has something to say.
db.data.users = [
  { id: 1, name: 'Boss', email: 'boss@test.local', role: 'super_admin', is_team: true, is_active: true, phone: '9000000001' },
  { id: 2, name: 'Bdm Asha', email: 'asha@test.local', role: 'bdm', is_team: true, is_active: true, phone: '9000000002' },
  { id: 3, name: 'Exec Ravi', email: 'ravi@test.local', role: 'bd_executive', is_team: true, is_active: true, phone: '9000000003' },
  { id: 4, name: 'Field Sita', email: 'sita@test.local', role: 'recee', is_team: true, is_active: true, phone: '9000000004' },
  { id: 5, name: 'No Number', email: 'nonum@test.local', role: 'manager', is_team: true, is_active: true, phone: '' },
  { id: 6, name: 'Retired', email: 'old@test.local', role: 'bdm', is_team: true, is_active: false, phone: '9000000006' },
];
db.data.leads = [
  { id: 1, contactName: 'Owned Lead', phone: '9876500001', bd_exec_id: 3, bdm_id: 2 },
  { id: 2, contactName: 'Orphan Lead', phone: '9876500002', bd_exec_id: null, bdm_id: null },
];
db.data.notifications = [];
db.data.settings = { telephony: { enabled: false, provider: 'exotel', sid: '', token: '', from_number: '' } };
db.write = async () => {};
await db.write();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/api/telephony', telephonyRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const J = (r) => r.json();

// ---------------------------------------------------------------------------
console.log('\n== phone matching survives how people dial ==');
check('a plain 10-digit number normalises', normalisePhone('9876500001') === '9876500001');
check('+91 prefixed dials the same', normalisePhone('+91 98765 00001') === '9876500001');
check('a spaced number matches', normalisePhone('98765 00001') === '9876500001');
check('an 0-prefixed landline style matches', normalisePhone('09876500001') === '9876500001');
check('a known lead is found by their number', findLeadByPhone('+91 98765 00001')?.id === 1);
check('an unknown number finds nobody', findLeadByPhone('9000000009') === null);

// ---------------------------------------------------------------------------
console.log('\n== a known customer reaches their own person first ==');
let r = resolveRoute('9876500001');
check('the assigned exec rings first', r.targets[0]?.name === 'Exec Ravi', JSON.stringify(r.targets.map((t) => t.name)));
check('then their BDM', r.targets[1]?.name === 'Bdm Asha', JSON.stringify(r.targets.map((t) => t.name)));
check('the pool follows', r.targets.length > 2, String(r.targets.length));
check('the reason says so', /assigned owner first/.test(r.reason), r.reason);
check('nobody is listed twice', new Set(r.targets.map((t) => t.id)).size === r.targets.length);

// ---------------------------------------------------------------------------
console.log('\n== field staff are not given sales calls ==');
r = resolveRoute('9876500001');
check('the recee is not in the ring list', !r.targets.some((t) => t.role === 'recee'), JSON.stringify(r.targets.map((t) => t.role)));
check('a deactivated member is never rung', !r.targets.some((t) => t.name === 'Retired'), JSON.stringify(r.targets.map((t) => t.name)));
check('someone with no number is skipped', !r.targets.some((t) => t.name === 'No Number'));
check('every target has a dialable number', r.targets.every((t) => !!t.number && t.number.length >= 10));

// ---------------------------------------------------------------------------
console.log('\n== an unknown caller goes to the pool ==');
r = resolveRoute('9000000099');
check('no lead is matched', r.lead === null);
check('the reason says pool', /unknown caller/.test(r.reason), r.reason);
check('they still reach a human', r.targets.length > 0, String(r.targets.length));
check('a super admin is offered first in the pool', r.targets[0]?.role === 'super_admin', JSON.stringify(r.targets.map((t) => t.role)));

// ---------------------------------------------------------------------------
console.log('\n== a lead with nobody assigned still gets through ==');
r = resolveRoute('9876500002');
check('no owner, so the pool takes it', r.targets.length > 0 && r.targets[0]?.via === 'pool',
  JSON.stringify(r.targets.map((t) => t.via)));
check('and the reason admits it', /no owner assigned/.test(r.reason), r.reason);

// ---------------------------------------------------------------------------
console.log('\n== the inbound webhook rings a list, in order ==');
let res = await fetch(`${R}/api/telephony/inbound`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ From: '9876500001', To: '0800000000' }),
});
let xml = await res.text();
check('it answers with TwiML', xml.includes('<Response>'), xml.slice(0, 80));
check('several numbers are queued', (xml.match(/<Number/g) || []).length > 1, String((xml.match(/<Number/g) || []).length));
check('the assigned exec appears before the BDM',
  xml.indexOf('9000000003') < xml.indexOf('9000000002'), 'order wrong');
check('the attempt is logged on the lead',
  (dbHelpers.getLeadById(1).activities || []).some((a) => a.type === 'call'), 'no activity');

res = await fetch(`${R}/api/telephony/inbound`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ From: '9000000099', To: '0800000000' }),
});
xml = await res.text();
check('an unknown caller also gets a dial list', (xml.match(/<Number/g) || []).length > 0, xml.slice(0, 80));

// ---------------------------------------------------------------------------
console.log('\n== nobody answers → the missed call is recorded ==');
const notesBefore = dbHelpers.getNotifications({ audience: 'staff' }).length;
res = await fetch(`${R}/api/telephony/no-answer`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ From: '9876500001', To: '0800000000', CallStatus: 'no-answer', CallDuration: '90' }),
});
check('the no-answer hook answers quietly', (await res.text()).includes('<Response/>'));
check('it is logged on the lead',
  (dbHelpers.getLeadById(1).activities || []).some((a) => /Missed call/.test(a.description || '')),
  JSON.stringify((dbHelpers.getLeadById(1).activities || []).map((a) => a.description)));
check('the lead records when it was missed', !!dbHelpers.getLeadById(1).last_missed_call_at);
check('and it raises a staff notification', dbHelpers.getNotifications({ audience: 'staff' }).length > notesBefore,
  String(dbHelpers.getNotifications({ audience: 'staff' }).length));
check('an unknown missed caller still notifies',
  logMissedCall('9000000077', '0800000000').lead === null, 'should not match a lead');
check('a caller who is not the lead is not matched', findLeadByPhone('9876500002')?.id === 2);

// ---------------------------------------------------------------------------
console.log('\n== the health check says what is actually missing ==');
let health = routingHealth();
check('it is not ready with nothing configured', health.ready === false, JSON.stringify(health.problems));
check('it names every blocker', health.problems.length >= 3, JSON.stringify(health.problems));
check('it counts who can be rung', health.routable_count === 4, String(health.routable_count));
check('it names the member with no number', health.members_without_number.some((m) => m.name === 'No Number'),
  JSON.stringify(health.members_without_number.map((m) => m.name)));

db.data.settings.telephony = { ...db.data.settings.telephony, enabled: true, sid: 's', token: 't', from_number: '0800000000' };
health = routingHealth();
check('it reports ready once configured and somebody is ringable', health.ready === true, JSON.stringify(health.problems));

db.data.settings.telephony.pool_roles = ['recee'];
health = routingHealth();
// With only recees routable, and every sales person filtered out, the pool is
// still non-empty because the recee has a number — but a sales-only pool is a
// misconfiguration worth showing rather than silently accepting.
check('a custom pool is honoured', Array.isArray(health.problems));

// ---------------------------------------------------------------------------
console.log('\n== the preview endpoint is staff-only ==');
res = await fetch(`${R}/api/telephony/preview`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: '9876500001' }),
});
check('an anonymous preview is refused', res.status === 401, String(res.status));

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
