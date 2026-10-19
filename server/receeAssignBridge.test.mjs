// Verifies that assigning a location row in the Data section creates/re-points
// the matching recee site-survey request, so the assignment reaches the recee.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '.test-run-recee-assign');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'routes', 'cms.js'), path.join(tmpDir, 'routes', 'cms.js'));

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const cmsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes', 'cms.js')))).default;

let uid = 9500;
const mkUser = (role, name) => {
  const id = ++uid;
  db.data.users.push({ id, name, email: `${role}${id}@test.local`, role, is_team: true, is_active: true });
  const token = `tok_${role}_${id}`;
  db.data.sessions.push({ token, user_id: id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString() });
  return { id, token };
};
db.data.users = [];
db.data.sessions = [];
db.data.site_surveys = [];
const mgr = mkUser('recee_manager', 'Recce Mgr');
const exec = mkUser('recee', 'Recce Exec');
const exec2 = mkUser('recee', 'Recce Exec Two');

db.data.records = [{
  id: 42, file_id: 1, row_index: 0,
  data: {
    name: 'Phoenix Mall', type: 'mall', lat: 12.9716, lng: 77.5946,
    source: 'google', is_active: true,
    services: { standee: 0, 'digital screen': 0 },
  },
}];
await db.write();

const app = express();
app.use(express.json());
app.use('/api/admin', cmsRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? (pass++, console.log('  OK  ' + n)) : (fail++, console.log('  FAIL ' + n + (x ? ' -> ' + x : ''))); };
const H = (u) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + u.token });

// 1. Assign creates a request on the recee's queue.
let res = await fetch(`${R}/api/admin/records/assign`, {
  method: 'POST', headers: H(mgr), body: JSON.stringify({ ids: [42], member_id: exec.id }),
});
let j = await res.json();
check('assign succeeds', res.ok, JSON.stringify(j));
check('one survey created', j.surveys_created === 1, JSON.stringify(j));

let surveys = dbHelpers.getSiteSurveys();
check('a request now exists', surveys.length === 1);
const s = surveys[0];
check('request points at the location row', s.record_id === 42);
check('request carries the target coords', s.target_lat === 12.9716 && s.target_lng === 77.5946);
check('request is assigned to the exec', s.assigned_to_id === exec.id);
check('request status is assigned', s.status === 'assigned', s.status);
check('request lists the row services', Array.isArray(s.services) && s.services.length === 2, JSON.stringify(s.services));
check('record is stamped assigned', dbHelpers.getRecordById(42).data.assigned_to === exec.id);
check('record recee_status is pending', dbHelpers.getRecordById(42).data.recee_status === 'pending');

// 2. Re-assigning re-points the SAME open request, no duplicate.
res = await fetch(`${R}/api/admin/records/assign`, {
  method: 'POST', headers: H(mgr), body: JSON.stringify({ ids: [42], member_id: exec2.id }),
});
j = await res.json();
check('reassign succeeds', res.ok, JSON.stringify(j));
check('no new survey on reassign', j.surveys_created === 0 && j.surveys_updated === 1, JSON.stringify(j));
surveys = dbHelpers.getSiteSurveys();
check('still exactly one request', surveys.length === 1);
check('request re-pointed to exec2', surveys[0].assigned_to_id === exec2.id);

// 3. Assigning to a non-recee does not create a survey (nobody could action it).
const bd = mkUser('bd_executive', 'BD Exec');
res = await fetch(`${R}/api/admin/records/assign`, {
  method: 'POST', headers: H(mgr), body: JSON.stringify({ ids: [42], member_id: bd.id }),
});
j = await res.json();
check('assign to non-recee succeeds', res.ok, JSON.stringify(j));
check('no survey action for non-recee', j.surveys_created === 0 && j.surveys_updated === 0, JSON.stringify(j));

// 4. Completing the survey flips the row's recee_status to done.
const open = dbHelpers.getSiteSurveys().find((x) => x.record_id === 42);
dbHelpers.updateSiteSurvey(open.id, {
  status: 'done', verified: true, prices: { standee: 500 }, completed_at: new Date().toISOString(),
  submitted_by: 'Recce Exec', submitted_by_id: exec.id, manager_name: 'M', manager_phone: '1',
});
dbHelpers.applySurveyToRecord(42, { services: { standee: 500 }, survey: dbHelpers.getSiteSurveys().find((x) => x.id === open.id), byName: 'Recce Exec', byId: exec.id });
const rec = dbHelpers.getRecordById(42).data;
check('row recee_status is done after survey', rec.recee_status === 'done', rec.recee_status);
check('row needs_recee cleared', rec.needs_recee === false);
check('row promoted to inhouse', rec.source === 'inhouse', rec.source);

console.log('\n========================================');
console.log(`${pass} passed, ${fail} failed`);
server.close();
process.exit(fail ? 1 : 0);
