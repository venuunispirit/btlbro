// Regression test: a member edited in the Team tab must actually appear in their
// department, and must not slip past the department disable-cascade.
//
// The bug this pins down: the Team form's <select> sends department_id as the
// STRING '2', the server stored it verbatim, and every read did a strict
// `department_id === Number(id)`. So '2' === 2 was false — the member vanished
// from the Departments members table AND escaped being deactivated when their
// department was disabled. Invisible either way, which is why it went unnoticed.
//
// Strategy mirrors upiPayments.test.mjs: temp tree, patched db path, the real
// server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-dept');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
for (const f of ['team.js', 'departments.js']) {
  fs.copyFileSync(path.join(__dirname, 'routes', f), path.join(tmpDir, 'routes', f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const teamRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/team.js')))).default;
const deptRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/departments.js')))).default;

const SUPS = ['super_admin', 'manager'];
db.data.users = db.data.users || [];
db.data.sessions = db.data.sessions || [];
const tokens = {};
let uid = 9500;
for (const role of [...SUPS, 'bd_executive', 'recee', 'ops_executive']) {
  const id = ++uid;
  db.data.users.push({ id, name: `Test ${role}`, email: `${role}@test.local`, role, is_team: true, is_active: true });
  tokens[role] = `tok_${role}`;
  db.data.sessions.push({
    token: tokens[role], user_id: id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 864e5).toISOString(),
  });
}
db.data.departments = [
  { id: 1, name: 'BD', description: '', is_active: true, created_at: new Date().toISOString() },
  { id: 2, name: 'Recee', description: '', is_active: true, created_at: new Date().toISOString() },
];
await db.write();

const app = express();
app.use(express.json());
app.use('/api/admin/team', teamRouter);
app.use('/api/admin/departments', deptRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const J = (r) => r.json();
const H = (role) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[role] });

async function call(m, p, { role, body } = {}) {
  const res = await fetch(R + p, { method: m, headers: role ? H(role) : H('super_admin'), body: body && JSON.stringify(body) });
  return { status: res.status, body: await J(res) };
}

// ---------------------------------------------------------------------------
console.log('\n== assigning a department from the Team form ==');
// The form sends whatever <select>.value is: a STRING. That is the exact shape
// that used to poison the column.
let r = await call('POST', '/api/admin/team', {
  role: 'super_admin',
  body: { name: 'String Id Rep', email: 'string.rep@test.local', password: 'secret123', role: 'bd_executive', department_id: '1' },
});
check('member created', r.status === 200, JSON.stringify(r.body).slice(0, 140));
const rep = r.body.member;
check('the API returns a NUMBER for department_id', typeof rep.department_id === 'number', typeof rep.department_id);
check('and it is the right department', rep.department_id === 1, String(rep.department_id));
check('the stored row is a number too, not a string',
  typeof dbHelpers.getUserById(rep.id).department_id === 'number',
  typeof dbHelpers.getUserById(rep.id).department_id);

// This is the assertion that failed before: the Departments members list.
const inDept1 = dbHelpers.getUsersByDepartment(1);
check('the member is found by their department', inDept1.some((u) => u.id === rep.id),
  JSON.stringify(inDept1.map((u) => u.name)));
check('exactly one member in that department', inDept1.length === 1, String(inDept1.length));

// ---------------------------------------------------------------------------
console.log('\n== moving a member between departments ==');
r = await call('PUT', `/api/admin/team/${rep.id}`, { role: 'super_admin', body: { department_id: '2' } });
check('moved to department 2', r.body.member?.department_id === 2, String(r.body.member?.department_id));
check('they left department 1', dbHelpers.getUsersByDepartment(1).length === 0, String(dbHelpers.getUsersByDepartment(1).length));
check('and joined department 2', dbHelpers.getUsersByDepartment(2).some((u) => u.id === rep.id));

// Clearing it must store null, not '' or 'null'.
r = await call('PUT', `/api/admin/team/${rep.id}`, { role: 'super_admin', body: { department_id: '' } });
check('clearing the department stores null', r.body.member?.department_id === null, JSON.stringify(r.body.member?.department_id));
r = await call('PUT', `/api/admin/team/${rep.id}`, { role: 'super_admin', body: { department_id: '1' } });
check('and it can be set again', r.body.member?.department_id === 1, String(r.body.member?.department_id));

// ---------------------------------------------------------------------------
console.log('\n== the disable cascade must reach them ==');
// This is the part that silently failed: getUsersByDepartment fed the cascade,
// so a string id meant disabling the department did NOT deactivate its member.
check('the member is active to begin with', dbHelpers.getUserById(rep.id).is_active !== false);
r = await call('PUT', '/api/admin/departments/1', { role: 'super_admin', body: { is_active: false } });
check('department disabled', r.status === 200, String(r.status));
check('its member was deactivated too', dbHelpers.getUserById(rep.id).is_active === false,
  String(dbHelpers.getUserById(rep.id).is_active));
check('their prior state was snapshotted', dbHelpers.getUserById(rep.id).dept_prev_active === true,
  String(dbHelpers.getUserById(rep.id).dept_prev_active));

r = await call('PUT', '/api/admin/departments/1', { role: 'super_admin', body: { is_active: true } });
check('re-enabling restores them', dbHelpers.getUserById(rep.id).is_active === true,
  String(dbHelpers.getUserById(rep.id).is_active));

// ---------------------------------------------------------------------------
console.log('\n== legacy string rows are still readable ==');
// Anything written before the coercion fix must not hide a member.
db.data.users.push({
  id: 999, name: 'Legacy String Row', email: 'legacy@test.local', role: 'bd_executive',
  is_team: true, is_active: true, department_id: '2',
});
await db.write();
check('a legacy string id is still matched by department lookup',
  dbHelpers.getUsersByDepartment(2).some((u) => u.id === 999),
  JSON.stringify(dbHelpers.getUsersByDepartment(2).map((u) => u.name)));

// Deleting a department must clear the link on legacy rows too, or they are
// left pointing at a department that no longer exists.
await dbHelpers.deleteDepartment(2);
check('deleting a department unlinks even a string-typed member',
  dbHelpers.getUserById(999).department_id === null,
  String(dbHelpers.getUserById(999).department_id));

// ---------------------------------------------------------------------------
console.log('\n== a non-existent department is not silently accepted ==');
r = await call('PUT', `/api/admin/team/${rep.id}`, { role: 'super_admin', body: { department_id: '9999' } });
const stillSet = dbHelpers.getUserById(rep.id).department_id;
check('an unknown department id does not corrupt the member',
  stillSet === 1 || stillSet === null, String(stillSet));

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
