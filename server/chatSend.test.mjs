// Test: the Chat tab's send path.
//
// This suite exists because the send route used to be a liar. It wrote the
// message to our own database, fired the WhatsApp API call without awaiting it,
// and returned { success: true } immediately. With no Meta credentials — the
// state we are actually in — the thread filled with outbound messages that were
// never delivered and the person typing was shown a success toast. A messaging
// feature that silently drops every message is worse than no feature, because
// you find out from the customer.
//
// What is asserted here:
//   - nothing can be sent while WhatsApp has no credentials (503)
//   - a lead with no phone is refused rather than silently dropped
//   - a real send marks the message delivered and returns 200
//   - a Meta rejection marks the message failed and returns 502
//   - bd_executive still cannot message leads assigned to someone else
//   - threads with no lead behind them can be replied to
//   - the status endpoint is reachable (it was shadowed by GET /:leadId)
//
// Strategy mirrors the other suites: temp dir, patched db path, the real
// server/data/db.json is never touched.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '.test-run-chatsend');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });
fs.cpSync(path.join(__dirname, 'middleware'), path.join(tmpDir, 'middleware'), { recursive: true });
fs.mkdirSync(path.join(tmpDir, 'routes'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'routes', 'chat.js'), path.join(tmpDir, 'routes', 'chat.js'));

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const chatRouter = (await import(pathToFileURL(path.join(tmpDir, 'routes', 'chat.js')))).default;

// Pretend to be Meta. `mode` flips the whole suite between "credentials exist"
// and "they do not", and `failNext` makes the provider reject.
//
// Only graph.facebook.com is intercepted — the suite makes real HTTP calls to
// the app under test, and shadowing global.fetch wholesale breaks those.
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (!String(url).includes('graph.facebook.com')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  if (mode === 'unconfigured') {
    return { json: async () => ({ error: { message: 'WhatsApp not configured' } }) };
  }
  if (failNext) {
    const msg = failNext;
    failNext = null;
    return { json: async () => ({ error: { message: msg } }) };
  }
  sent.push(body);
  return { json: async () => ({ messages: [{ id: `wamid.${sent.length}` }] }) };
};

let mode = 'unconfigured';
let failNext = null;
const sent = [];

db.data.users = [
  { id: 1, name: 'Boss', email: 'boss@test.local', role: 'super_admin', is_team: true, is_active: true },
  { id: 3, name: 'Exec Ravi', email: 'ravi@test.local', role: 'bd_executive', is_team: true, is_active: true },
  { id: 7, name: 'Other Exec', email: 'other@test.local', role: 'bd_executive', is_team: true, is_active: true },
];
db.data.leads = [
  { id: 1, contactName: 'Owned Lead', phone: '9876500001', bd_exec_id: 3, bdm_id: null },
  { id: 2, contactName: 'Someone Elses', phone: '9876500002', bd_exec_id: 7, bdm_id: null },
  { id: 3, contactName: 'No Phone', phone: '', bd_exec_id: 3, bdm_id: null },
];
db.data.conversations = [];
db.data.notifications = [];
db.data.settings = { whatsapp: { phone_number_id: '', access_token: '' } };
await db.write();

// Real sessions, so the real requireStaff runs. Stubbing req.staff would skip
// exactly the middleware this route depends on for access control.
const tokens = {};
for (const u of db.data.users) {
  const t = `tok_${u.id}`;
  dbHelpers.addSession({ token: t, user_id: u.id, created_at: new Date().toISOString() });
  tokens[u.id] = t;
}
await db.write();

const app = express();
app.use(express.json());
app.use('/api/admin/chat', chatRouter);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const R = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const post = async (url, body, staffId = 1) => {
  const res = await fetch(`${R}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[staffId]}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (url, staffId = 1) => {
  const res = await fetch(`${R}${url}`, { headers: { authorization: `Bearer ${tokens[staffId]}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const outMessages = (convId) =>
  (db.data.conversations.find((c) => c.id === Number(convId))?.messages || [])
    .filter((m) => m.direction === 'out');

console.log('\nstatus endpoint is reachable');
// GET /:leadId is a catch-all for any single segment. When it was registered
// first it answered '/status' with a lead lookup, so the Chat tab could never
// learn whether it was connected.
{
  const r = await get('/api/admin/chat/status');
  check('GET /status returns 200', r.status === 200, String(r.status));
  check('status reports disabled without credentials', r.body.enabled === false, JSON.stringify(r.body));
  check('status does not leak the raw phone_number_id', r.body.phone_number_id === '', r.body.phone_number_id);
}
{
  // The verification handshake replies with the raw challenge string, not JSON.
  const res = await fetch(`${R}/api/admin/chat/webhook?hub.mode=subscribe&hub.verify_token=btlbro_verify&hub.challenge=abc123`,
    { headers: { authorization: `Bearer ${tokens[1]}` } });
  const text = await res.text();
  check('Meta webhook verification still answers', text === 'abc123', text);
  const bad = await fetch(`${R}/api/admin/chat/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`,
    { headers: { authorization: `Bearer ${tokens[1]}` } });
  check('wrong verify token is rejected', bad.status === 403, String(bad.status));
}

console.log('\nrefuses to send while unconfigured');
{
  const r = await post('/api/admin/chat/conversation/new/send', { text: 'hello' });
  check('unknown conversation is 404, not a silent send', r.status === 404, String(r.status));
}
{
  // Give the lead a conversation, then try to send with no credentials.
  const conv = dbHelpers.addConversation({ lead_id: 1, customer_phone: '9876500001', customer_name: 'Owned Lead', messages: [] });
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'hello' });
  check('send is refused with 503', r.status === 503, String(r.status));
  check('error names the cause', r.body.code === 'whatsapp_not_configured', JSON.stringify(r.body));
  check('nothing reached the provider', sent.length === 0, `sent=${sent.length}`);
  // The whole point: the message must NOT be sitting in the thread looking sent.
  check('no outbound message was recorded', outMessages(conv.id).length === 0, `out=${outMessages(conv.id).length}`);
  check('no activity was logged on the lead',
    !(dbHelpers.getLeadById(1)?.activities || []).some((a) => a.type === 'chat'));
}

console.log('\nnow with credentials');
db.data.settings.whatsapp = {
  phone_number_id: '123456789012345',
  access_token: 'EAAG_test_token',
  business_name: 'BTLbro',
  display_number: '+91 63668 70248',
  webhook_url: 'https://example.test/api/admin/chat/webhook',
};
await db.write();
mode = 'configured';
{
  const r = await get('/api/admin/chat/status');
  check('status reports connected', r.body.enabled === true, JSON.stringify(r.body));
  check('status masks the phone_number_id', r.body.phone_number_id === '***2345', r.body.phone_number_id);
  check('status shows the sending number', r.body.display_number === '+91 63668 70248', r.body.display_number);
}
{
  const conv = dbHelpers.addConversation({ lead_id: 1, customer_phone: '9876500001', customer_name: 'Owned Lead', messages: [] });
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'Your quote is ready' }, 3);
  check('send returns 200', r.status === 200, JSON.stringify(r.body));
  check('message is marked delivered', r.body.message?.status === 'sent', JSON.stringify(r.body.message));
  check('provider id is stored', r.body.message?.provider_message_id === 'wamid.1', r.body.message?.provider_message_id);
  check('exactly one message reached the provider', sent.length === 1, `sent=${sent.length}`);
  check('provider got the digits only', sent[0]?.to === '9876500001', sent[0]?.to);
  check('provider got the message body', sent[0]?.text?.body === 'Your quote is ready', JSON.stringify(sent[0]));
  check('no error left on the message', !r.body.message?.error, r.body.message?.error);
  check('activity logged on the lead',
    (dbHelpers.getLeadById(1)?.activities || []).some((a) => a.type === 'chat' && a.description.includes('Message sent')));
}

console.log('\nprovider rejection is surfaced, not swallowed');
{
  const conv = dbHelpers.addConversation({ lead_id: 1, customer_phone: '9876500001', customer_name: 'Owned Lead', messages: [] });
  failNext = '(#131030) Message undeliverable — outside the 24 hour window';
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'cold outreach' });
  check('send returns 502', r.status === 502, String(r.status));
  check('error code identifies the provider rejection', r.body.code === 'whatsapp_send_failed', JSON.stringify(r.body));
  check('Meta’s own reason is passed through', String(r.body.details).includes('24 hour window'), r.body.details);
  // The regression: this used to render as a normal orange sent bubble.
  const m = outMessages(conv.id)[0];
  check('message is marked failed', m?.status === 'failed', m?.status);
  check('the provider error is stored on the message', String(m?.error).includes('24 hour window'), m?.error);
  check('no provider id on a failed message', !m?.provider_message_id, m?.provider_message_id);
  check('no activity logged for an undelivered message',
    !(dbHelpers.getLeadById(1)?.activities || []).some((a) => a.description?.includes('cold outreach')));
}

console.log('\ninput validation');
{
  const conv = dbHelpers.addConversation({ lead_id: 1, customer_phone: '9876500001', messages: [] });
  const empty = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: '   ' });
  check('blank message is rejected', empty.status === 400, String(empty.status));
  const before = sent.length;
  const bad = await post(`/api/admin/chat/conversation/${conv.id}/send`, {});
  check('missing text is rejected', bad.status === 400, String(bad.status));
  check('neither reached the provider', sent.length === before, `sent=${sent.length}`);
}
{
  const conv = dbHelpers.addConversation({ lead_id: 3, customer_phone: '', customer_name: 'No Phone', messages: [] });
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'hi' });
  check('conversation with no number is refused', r.status === 400, String(r.status));
  check('refusal names the missing phone', r.body.code === 'no_phone', JSON.stringify(r.body));
  const leadRoute = await post('/api/admin/chat/3/send', { text: 'hi' });
  check('lead route refuses a lead with no phone', leadRoute.status === 400, String(leadRoute.status));
}

console.log('\nthread with no lead behind it');
{
  // An unknown customer who messaged us first. There is no lead, so the
  // lead-scoped route cannot reach this thread at all.
  const conv = dbHelpers.addConversation({ lead_id: null, customer_phone: '9000000009', customer_name: 'Walk In', messages: [] });
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'Thanks for reaching out' });
  check('can be replied to', r.status === 200, JSON.stringify(r.body));
  check('provider got the right number', sent.at(-1)?.to === '9000000009', sent.at(-1)?.to);
}

console.log('\nassignment rules still hold');
{
  // Lead 2 belongs to exec 7, so exec 3 must not be able to message them.
  const conv = dbHelpers.addConversation({ lead_id: 2, customer_phone: '9876500002', customer_name: 'Someone Elses', messages: [] });
  const before = sent.length;
  const r = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'let me know' }, 3);
  check('other exec is refused', r.status === 403, String(r.status));
  check('refusal did not send', sent.length === before, `sent=${sent.length}`);
  const owner = await post(`/api/admin/chat/conversation/${conv.id}/send`, { text: 'let me know' }, 7);
  check('the assigned exec can send', owner.status === 200, JSON.stringify(owner.body));
  // The conversation route must not be a way around the lead route's rules.
  const leadRoute = await post('/api/admin/chat/2/send', { text: 'sneaky' }, 3);
  check('lead route also enforces assignment', leadRoute.status === 403, String(leadRoute.status));
}

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
