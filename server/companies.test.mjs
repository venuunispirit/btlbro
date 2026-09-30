// Tests for the customer-account (companies) layer and the public lead intake
// hardening that feeds it.
//
// Strategy mirrors upiPayments.test.mjs: copy the real sources into a temp dir
// inside server/ with the db path patched, so node_modules resolution still
// works and the REAL server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = path.join(__dirname, '.test-run-companies');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpDir, 'services'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'middleware'), { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);

for (const f of [
  'middleware/staffAuth.js',
  'routes/leads.js',
  'routes/companies.js',
  'services/sheetBackfill.js',
  'services/sheetWriter.js',
  'services/gmapLink.js',
  'services/sheetSync.js',
  'services/spreadsheetParser.js',
  'services/sheetSyncError.js',
  'services/geocode.js',
]) {
  fs.copyFileSync(path.join(__dirname, f), path.join(tmpDir, f));
}

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const leadsRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/leads.js')))).default;
const companiesRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes/companies.js')))).default;

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}
function section(title) { console.log(`\n== ${title} ==`); }

// --- Staff sessions: one per role ---
db.data.users = [];
db.data.sessions = [];
const tokens = {};
let uid = 8000;
for (const role of ['bd_executive', 'bdm', 'ops_manager', 'manager', 'member', 'super_admin']) {
  const id = ++uid;
  db.data.users.push({ id, name: `Test ${role}`, email: `${role}@test.local`, role, is_team: true, is_active: true });
  const token = `tok_${role}`;
  tokens[role] = token;
  db.data.sessions.push({ token, user_id: id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString() });
}
db.data.leads = [];
db.data.companies = [];
db.data.payments = [];
await db.write();

const app = express();
app.use(express.json());
app.use('/api/leads', leadsRouter);
app.use('/api/admin/companies', companiesRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

function call(method, url, body, role) {
  return fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const postLead = (body) => call('POST', '/api/leads', body).then(async (r) => ({ status: r.status, json: await r.json() }));

// ---------------------------------------------------------------- dedupe key

section('companyKey — normalization for dedupe');
check('strips case and punctuation', dbHelpers.companyKey('Cafe Coffee House') === 'cafe coffee house');
check('strips legal suffixes', dbHelpers.companyKey('Cafe Coffee House Pvt Ltd.') === 'cafe coffee house');
check('"Co"/"Company" collapse too', dbHelpers.companyKey('CAFE COFFEE HOUSE & Co') === 'cafe coffee house');
check('collapses whitespace', dbHelpers.companyKey('Cafe   Coffee\tHouse') === 'cafe coffee house');
check('keeps a real name intact', dbHelpers.companyKey('Byg Brewski Brewing Company') === 'byg brewski brewing');
check('empty input is not a company', dbHelpers.companyKey('   ') === '' && dbHelpers.companyKey(null) === '');
check(
  'does NOT fuzzy-merge similar names',
  dbHelpers.companyKey('Cafe Coffee') !== dbHelpers.companyKey('Cafe Cofee')
);

// ------------------------------------------------------------ auto-creation

section('A lead auto-creates its company');
{
  const { status, json } = await postLead({
    businessName: 'Cafe Coffee House', contactName: 'Asha Rao', phone: '9876500001', email: 'asha@cafe.test',
  });
  check('lead created', status === 200 && json.lead?.id > 0);
  check('lead carries a company_id', !!json.lead?.company_id);
  const company = dbHelpers.getCompanyById(json.lead.company_id);
  check('company row exists', !!company);
  check('display name preserved verbatim', company.name === 'Cafe Coffee House');
  check('name_key normalized', company.name_key === 'cafe coffee house');
  check('representative recorded', company.contact_name === 'Asha Rao');
  check('phone recorded', company.phone === '9876500001');
  check('defaults are sane', company.is_active === true && !!company.created_at);
}

section('B. same company, different spelling → one account, two leads');
{
  const first = dbHelpers.getCompanies()[0];
  const { json } = await postLead({
    businessName: 'CAFE COFFEE HOUSE PVT LTD', contactName: 'Rohit Verma', phone: '9876500002',
  });
  check('second lead created', !!json.lead?.id);
  check('deduped onto the same company', json.lead.company_id === first.id);
  check('still exactly one company', dbHelpers.getCompanies().length === 1);
  check('display name NOT rewritten by the second lead', dbHelpers.getCompanyById(first.id).name === 'Cafe Coffee House');
  check('representative NOT silently swapped', dbHelpers.getCompanyById(first.id).contact_name === 'Asha Rao');
}

section('C. a different company gets its own account');
{
  const before = dbHelpers.getCompanies().length;
  const { json } = await postLead({ businessName: 'Byg Brewski Brewing Company', contactName: 'Nikhil' });
  check('new company created', dbHelpers.getCompanies().length === before + 1);
  check('and is distinct from the cafe', json.lead.company_id !== dbHelpers.getCompanies()[0].id);
  check('normalized to "byg brewski brewing"', dbHelpers.getCompanyById(json.lead.company_id).name_key === 'byg brewski brewing');
}

section('D. blank businessName is not a company');
{
  const before = dbHelpers.getCompanies().length;
  const { json } = await postLead({ businessName: '   ', contactName: 'Walk-in' });
  check('lead still created', !!json.lead?.id);
  check('no company created', dbHelpers.getCompanies().length === before);
  check('company_id is null', json.lead.company_id == null);
}

// ------------------------------------------------- public intake hardening

section('E. public POST /api/leads cannot forge pipeline state');
{
  const { json } = await postLead({
    businessName: 'Forge Test Co', contactName: 'Mallory',
    status: 'completed', cold_flag: true, payment_status: 'paid',
    bd_exec_id: 8001, ops_exec_id: 8002, bdm_id: 8002, company_id: 999,
  });
  const lead = dbHelpers.getLeadById(json.lead.id);
  check('status forced back to new', lead.status === 'new', `got ${lead.status}`);
  check('cold_flag not accepted', lead.cold_flag === false, `got ${lead.cold_flag}`);
  check('payment_status not accepted', lead.payment_status === undefined, `got ${lead.payment_status}`);
  check('bd_exec_id not accepted', lead.bd_exec_id === undefined, `got ${lead.bd_exec_id}`);
  check('ops_exec_id not accepted', lead.ops_exec_id === undefined, `got ${lead.ops_exec_id}`);
  check('bdm_id not accepted', lead.bdm_id === undefined, `got ${lead.bdm_id}`);
  check('company_id comes from the server, not the client', lead.company_id === dbHelpers.getCompanyByNameKey('forge test').id);
}

section('F. long strings are truncated, not stored raw');
{
  const { json } = await postLead({ businessName: 'X'.repeat(500), contactName: 'Y'.repeat(500) });
  check('businessName capped at 100', json.lead.businessName.length === 100, `len ${json.lead.businessName.length}`);
  check('contactName capped at 100', json.lead.contactName.length === 100);
}

// ---------------------------------------------------------------- backfill

section('G. legacy leads are backfilled on read');
{
  // Simulate pre-companies data: a lead with a businessName and no company_id.
  // Same account as the cafe, spelled the way a human would type it.
  const legacy = dbHelpers.addLead({ businessName: 'Cafe Coffee House LLP', contactName: 'Old Timer', status: 'new' });
  check('legacy lead has no company_id', legacy.company_id == null);
  check('still exactly 4 companies before backfill', dbHelpers.getCompanies().length === 4);

  const res = await call('GET', '/api/leads', null, 'super_admin');
  const { leads } = await res.json();
  check('backfill ran on GET /api/leads', !!dbHelpers.getLeadById(legacy.id).company_id);
  check('deduped onto the existing cafe account', dbHelpers.getLeadById(legacy.id).company_id === dbHelpers.getCompanies()[0].id);
  check('no extra company created', dbHelpers.getCompanies().length === 4, `got ${dbHelpers.getCompanies().length}`);
  check('representative not overwritten by backfill', dbHelpers.getCompanies()[0].contact_name === 'Asha Rao');
  check('list is returned', Array.isArray(leads) && leads.length > 0);
}

section('G2. a genuinely different legacy name becomes its own account');
{
  const before = dbHelpers.getCompanies().length;
  const legacy = dbHelpers.addLead({ businessName: 'Legacy Cafe Pvt Ltd', contactName: 'Other Owner', status: 'new' });
  dbHelpers.backfillCompanies();
  check('new company created for the new name', dbHelpers.getCompanies().length === before + 1);
  check('linked to the new company, not the cafe', dbHelpers.getLeadById(legacy.id).company_id !== dbHelpers.getCompanies()[0].id);
  check('key is "legacy cafe"', dbHelpers.getCompanyById(dbHelpers.getLeadById(legacy.id).company_id).name_key === 'legacy cafe');
}

section('H. backfill is idempotent');
{
  const before = dbHelpers.getCompanies().length;
  const r1 = dbHelpers.backfillCompanies();
  const r2 = dbHelpers.backfillCompanies();
  check('second run links nothing new', r2.linked === 0, `linked ${r2.linked}`);
  check('company count unchanged', dbHelpers.getCompanies().length === before);
  check('first run may link, second does not', r1.linked >= 0);
}

section('I. every lead now resolves to a company');
{
  const orphans = dbHelpers.getLeads().filter((l) => l.businessName && l.businessName.trim() && !l.company_id);
  check('no orphan leads with a business name', orphans.length === 0, `${orphans.length} orphans`);
}

// --------------------------------------------------------- helper contracts

section('J. company helpers');
{
  const cafe = dbHelpers.getCompanies()[0];
  check('getCompanyById resolves', dbHelpers.getCompanyById(cafe.id)?.id === cafe.id);
  check('getCompanyById rejects garbage', dbHelpers.getCompanyById('nope') == null);
  check('getCompanyByNameKey resolves', dbHelpers.getCompanyByNameKey('cafe coffee house')?.id === cafe.id);
  check('getCompanyByNameKey rejects empty', dbHelpers.getCompanyByNameKey('') == null);

  const renamed = dbHelpers.updateCompany(cafe.id, { name: 'Cafe Coffee House Global' });
  check('rename recomputes the key', renamed.name_key === 'cafe coffee house global', `got ${renamed.name_key}`);

  const before = dbHelpers.getCompanies().length;
  dbHelpers.updateCompany(9999, { name: 'Ghost' });
  check('updating a missing company is a no-op', dbHelpers.getCompanies().length === before);
  check('and returns null', dbHelpers.updateCompany(9999, { name: 'Ghost' }) == null);

  check('linkLeadToCompany on a missing lead is safe', dbHelpers.linkLeadToCompany(999999) == null);
  check('findOrCreateCompany with no name returns null', dbHelpers.findOrCreateCompany({}) == null);
}

// ------------------------------------------------------------- API: access

section('K. /api/admin/companies requires a staff session');
{
  const anon = await call('GET', '/api/admin/companies');
  check('anonymous is 401', anon.status === 401, `got ${anon.status}`);
}

section('L. roles that must not see accounts at all');
{
  const member = await call('GET', '/api/admin/companies', null, 'member');
  check('member is refused', member.status === 403, `got ${member.status}`);
}

section('M. account list scoping');
{
  // Give the cafe a lead assigned to the bd_executive, and one to nobody.
  const cafe = dbHelpers.getCompanies()[0];
  const [execLead, bdmLead] = dbHelpers.getLeads().filter((l) => Number(l.company_id) === cafe.id);
  dbHelpers.updateLead(execLead.id, { bd_exec_id: 8001, bdm_id: 8002 });
  dbHelpers.updateLead(bdmLead.id, { bd_exec_id: 8002, bdm_id: 8002 });

  const execView = await (await call('GET', '/api/admin/companies', null, 'bd_executive')).json();
  const execIds = execView.companies.map((c) => c.id);
  check('bd_executive sees only their assigned account', execIds.length === 1 && execIds[0] === cafe.id, `saw ${execIds}`);

  const bdmView = await (await call('GET', '/api/admin/companies', null, 'bdm')).json();
  check('bdm sees their domain', bdmView.companies.some((c) => c.id === cafe.id));

  const adminView = await (await call('GET', '/api/admin/companies', null, 'super_admin')).json();
  check('super_admin sees every account', adminView.companies.length === dbHelpers.getCompanies().length);

  const managerView = await (await call('GET', '/api/admin/companies', null, 'manager')).json();
  check('manager sees every account', managerView.companies.length === dbHelpers.getCompanies().length);

  const row = adminView.companies.find((c) => c.id === cafe.id);
  check('list carries a lead_count', typeof row.lead_count === 'number' && row.lead_count >= 2);
  check('list carries money totals', row.totals && typeof row.totals.outstanding === 'number');
}

section('N. drill-down access control');
{
  const cafe = dbHelpers.getCompanies()[0];
  const exec = await call('GET', `/api/admin/companies/${cafe.id}`, null, 'bd_executive');
  check('assigned exec can open the account', exec.status === 200, `got ${exec.status}`);

  const member = await call('GET', `/api/admin/companies/${cafe.id}`, null, 'member');
  check('member is refused the drill-down', member.status === 403, `got ${member.status}`);

  const missing = await call('GET', '/api/admin/companies/999999', null, 'super_admin');
  check('unknown account is 404', missing.status === 404, `got ${missing.status}`);
}

// ------------------------------------------------------------ API: timeline

section('O. the timeline is synthesised from every source');
{
  const cafe = dbHelpers.getCompanies()[0];
  const lead = dbHelpers.getLeadById(dbHelpers.getLeads().find((l) => Number(l.company_id) === cafe.id).id);
  const now = new Date().toISOString();

  // A payment linked only through the lead's payment_reference.
  dbHelpers.addPayment({
    direction: 'in', status: 'paid', amount: 5000, currency: 'INR',
    reference: 'ref_tl_1', note: 'Campaign booking', paid_at: now,
  });
  dbHelpers.updateLead(lead.id, { payment_reference: 'ref_tl_1' });

  // A manual ledger movement with no FK at all — only the counterparty name,
  // spelled the way a human would type the same account.
  dbHelpers.addPayment({
    direction: 'out', status: 'paid', amount: 1200, currency: 'INR',
    reference: 'ref_tl_2', note: 'Vendor payout',
    counterparty_name: `${cafe.name} Pvt Ltd`,
  });

  // A full WhatsApp thread, longer than the 50-char activities stub.
  const longText = 'Please confirm the launch date for the Koramangala catchments, we can start next Monday.';
  const conv = dbHelpers.addConversation({ lead_id: lead.id, customer_phone: '9876500001', customer_name: 'Asha Rao', messages: [] });
  dbHelpers.addMessageToConversation(conv.id, { direction: 'out', text: longText, sender_id: 8001, sender_name: 'Sales Rep', status: 'sent' });
  dbHelpers.addMessageToConversation(conv.id, { direction: 'system', text: 'Message sent to 9876500001', status: 'sent' });
  dbHelpers.addMessageToConversation(conv.id, { direction: 'in', text: 'Monday works.', status: 'received' });
  dbHelpers.addLeadActivity(lead.id, { type: 'chat', description: 'Message sent: "Please confirm the launch date…"', actor: 'Sales Rep' });
  dbHelpers.addLeadActivity(lead.id, { type: 'call', description: 'Outbound call initiated to 9876500001', actor: 'Sales Rep', meta: { direction: 'outbound' } });
  dbHelpers.addLeadActivity(lead.id, { type: 'status_change', description: 'Status changed from new to in_followup', actor: 'Sales Rep' });
  dbHelpers.addLeadNote(lead.id, { text: 'Wants monthly retainer', author: 'Sales Rep', author_id: 8001 });

  const res = await (await call('GET', `/api/admin/companies/${cafe.id}`, null, 'super_admin')).json();

  check('leads are attached', res.leads.length >= 2);
  check('conversations are attached', res.conversations.length === 1);
  check('payments roll up (linked + by name)', res.payments.length === 2, `got ${res.payments.length}`);

  const chat = res.timeline.filter((e) => e.kind === 'chat');
  check('chat events come from the conversation store', chat.length === 2, `got ${chat.length}`);
  check('FULL message text survives (not the 50-char stub)', chat.some((e) => e.detail === longText));
  check('delivery receipts are excluded', !res.timeline.some((e) => e.detail === 'Message sent to 9876500001'));
  check('chat is not double-counted from activities', chat.length === 2);

  check('payment events are NOT in the relationship timeline', res.timeline.filter((e) => e.kind === 'payment').length === 0);
  check('note event present', res.timeline.some((e) => e.kind === 'note' && e.detail === 'Wants monthly retainer'));
  check('status_change event present', res.timeline.some((e) => e.kind === 'status_change'));
  check('account creation event present', res.timeline.some((e) => e.kind === 'company'));
  check(
    'lead creation is reported once, not twice',
    res.timeline.filter((e) => e.kind === 'lead' || e.kind === 'created').length === res.leads.length,
    `got ${res.timeline.filter((e) => e.kind === 'lead' || e.kind === 'created').length} for ${res.leads.length} leads`
  );

  const stamps = res.timeline.map((e) => new Date(e.at).getTime());
  check('timeline is chronological', stamps.every((t, i) => i === 0 || stamps[i - 1] <= t));

  check('totals: received 5000', res.company.totals.received === 5000, `got ${res.company.totals.received}`);
  check('totals: sent 1200', res.company.totals.sent === 1200, `got ${res.company.totals.sent}`);
  check('totals: outstanding 3800', res.company.totals.outstanding === 3800, `got ${res.company.totals.outstanding}`);
  check('name-matched payment is flagged as inferred', res.inferred_payment_ids.includes(res.payments.find((p) => p.reference === 'ref_tl_2').id));
  check('FK-linked payment is NOT flagged', !res.inferred_payment_ids.includes(res.payments.find((p) => p.reference === 'ref_tl_1').id));
}

section('P. an account with no payments reports zeroes, not nulls');
{
  const brew = dbHelpers.getCompanies().find((c) => c.name_key === 'byg brewski brewing');
  const res = await (await call('GET', `/api/admin/companies/${brew.id}`, null, 'super_admin')).json();
  check('totals are zeroed', res.company.totals.received === 0 && res.company.totals.outstanding === 0);
  check('payments is an empty array', Array.isArray(res.payments) && res.payments.length === 0);
  check('timeline still has the lead', res.timeline.length > 0);
}

// ---------------------------------------------------------- API: rename/merge

section('Q. renaming onto another account is refused, not silently merged');
{
  const cafe = dbHelpers.getCompanies()[0];
  const brew = dbHelpers.getCompanies().find((c) => c.name_key === 'byg brewski brewing');
  const nameBefore = dbHelpers.getCompanyById(cafe.id).name;
  const res = await call('PUT', `/api/admin/companies/${cafe.id}`, { name: 'Byg Brewski Brewing Company' }, 'super_admin');
  check('409 Conflict', res.status === 409, `got ${res.status}`);
  const body = await res.json();
  check('error names the clashing account', /Merge them instead/.test(body.error), body.error);
  check('original name untouched', dbHelpers.getCompanyById(cafe.id).name === nameBefore);
  check('brewster untouched', dbHelpers.getCompanyById(brew.id).name === 'Byg Brewski Brewing Company');
}

section('R. normal edits and access control on PUT');
{
  const cafe = dbHelpers.getCompanies()[0];
  const ok = await call('PUT', `/api/admin/companies/${cafe.id}`, { contact_name: 'Asha R. Rao', pincode: '560034' }, 'super_admin');
  check('edit succeeds', ok.status === 200);
  const body = await ok.json();
  check('contact_name updated', body.company.contact_name === 'Asha R. Rao');
  check('pincode updated', body.company.pincode === '560034');

  const rename = await (await call('PUT', `/api/admin/companies/${cafe.id}`, { name: 'Cafe Coffee House Global LLP' }, 'super_admin')).json();
  check('free rename recomputes the key', rename.company.name_key === 'cafe coffee house global');

  const member = await call('PUT', `/api/admin/companies/${cafe.id}`, { name: 'Hacked' }, 'member');
  check('member cannot edit (403 before 401-level work)', member.status === 403, `got ${member.status}`);

  const noop = await call('PUT', `/api/admin/companies/${cafe.id}`, {}, 'super_admin');
  check('empty patch is a harmless no-op', noop.status === 200);
}

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n========================================`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
