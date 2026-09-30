// Test: WhatsApp messaging — the click-to-chat number format, and inbound
// sender matching.
//
// Two separate things, and the second only matters once the first is right.
//
// 1. Outbound. wa.me needs the FULL international number with no punctuation.
//    `https://wa.me/?text=...` has no number in the path at all, which is what
//    PaymentsTab used to emit: it only resolves on a device that already had
//    that exact chat open, and silently does nothing everywhere else.
//
// 2. Inbound. Meta reports a sender as "919876500001" while a lead we stored
//    from a web form holds "9876500001". getConversationByPhone is an exact
//    string compare, so the raw value opened a duplicate thread for a customer
//    we already had, and the message never reached the lead timeline.
//
// Strategy mirrors the other suites: temp dir, patched db path, the real
// server/data/db.json is never touched.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '.test-run-wa');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const dbSource = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8')
  .replace(`path.join(__dirname, 'data')`, `path.join(__dirname, 'test-data')`);
fs.writeFileSync(path.join(tmpDir, 'db.js'), dbSource);
fs.cpSync(path.join(__dirname, 'services'), path.join(tmpDir, 'services'), { recursive: true });

const { dbHelpers, default: db } = await import(pathToFileURL(path.join(tmpDir, 'db.js')));
const wa = await import(pathToFileURL(path.join(tmpDir, 'services', 'whatsapp.js')));
const { toWaNumber, waLink, canWhatsApp, TEMPLATES, buildMessage } =
  await import(pathToFileURL(path.join(__dirname, '..', 'src', 'pages', 'admin', 'whatsapp.js')));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('\nwa.me number format');
// The three shapes a phone arrives in from our own forms and imports.
check('bare 10 digits gets the country code', toWaNumber('9876500001') === '919876500001', toWaNumber('9876500001'));
check('+91 prefix is not doubled', toWaNumber('+919876500001') === '919876500001', toWaNumber('+919876500001'));
check('+91 with spaces is stripped', toWaNumber('+91 98765 00001') === '919876500001', toWaNumber('+91 98765 00001'));
check('leading trunk zero is dropped', toWaNumber('09876500001') === '919876500001', toWaNumber('09876500001'));
check('dashes and parens are stripped', toWaNumber('+91-98765-00001') === '919876500001', toWaNumber('+91-98765-00001'));

// A short number cannot become a full international one, and guessing would
// send the message to a stranger. Refusing to build a link is the right answer.
check('too-short number yields no link target', toWaNumber('12345') === '', toWaNumber('12345'));
check('empty phone yields no link target', toWaNumber('') === '');
check('undefined phone yields no link target', toWaNumber(undefined) === '');
check('canWhatsApp is false without a usable number', canWhatsApp('123') === false);
check('canWhatsApp is true for a real number', canWhatsApp('9876500001') === true);

console.log('\nlink shape');
const link = waLink('9876500001', 'Hello there');
check('link carries the number in the path', link.startsWith('https://wa.me/919876500001?'), link);
check('message is url-encoded, not raw', link.includes('text=Hello%20there'), link);
check('no number means no link at all', waLink('123', 'Hello') === '', waLink('123', 'Hello'));
check('number-only link when there is no body', waLink('9876500001', '') === 'https://wa.me/919876500001', waLink('9876500001', ''));
// The regression this file exists for.
check('link is never the numberless wa.me form', !link.startsWith('https://wa.me/?'));

console.log('\ntemplates');
check('every template has an id, label and build', TEMPLATES.every((t) => t.id && t.label && typeof t.build === 'function'));
check('template ids are unique', new Set(TEMPLATES.map((t) => t.id)).size === TEMPLATES.length);
check('follow up greets the contact by name', buildMessage('follow_up', { name: 'Asha' }).includes('Hi Asha'), buildMessage('follow_up', { name: 'Asha' }));
check('unknown template id builds nothing', buildMessage('nope', {}) === '');
check('templates survive a record with no fields at all', TEMPLATES.every((t) => t.build({}).length > 20));
check('payment reminder quotes the amount', buildMessage('payment_reminder', { amount: 9999 }).includes('9,999'), buildMessage('payment_reminder', { amount: 9999 }));

console.log('\ninbound matching');
db.data.leads = [{ id: 1, contactName: 'Asha Rao', phone: '9876500001' }];
db.data.conversations = [];
db.data.notifications = [];
db.write = async () => {};

// The exact number we stored must find the lead, in every format Meta or a
// handset might report.
for (const [label, from] of [
  ['bare 10 digits', '9876500001'],
  ['international', '919876500001'],
  ['plus-prefixed', '+919876500001'],
  ['spaced', '+91 98765 00001'],
  ['trunk zero', '09876500001'],
]) {
  const r = wa.routeInboundMessage({ from, text: `hi (${label})` });
  check(`lead found from ${label}`, r?.conversation?.lead_id === 1, `lead_id=${r?.conversation?.lead_id}`);
  check(`name backfilled from lead on ${label}`, r?.conversation?.customer_name === 'Asha Rao', r?.conversation?.customer_name);
}

// All five of the above are the same human, so they must land in ONE thread
// rather than five — this is the duplicate-thread bug.
const threads = (db.data.conversations || []).length;
check('five formats of one number create one thread', threads === 1, `threads=${threads}`);
const msgs = (db.data.conversations?.[0]?.messages || []).length;
check('every message is kept on that one thread', msgs === 5, `messages=${msgs}`);
check('all five are inbound', (db.data.conversations?.[0]?.messages || []).every((m) => m.direction === 'in'));

// A number we have never seen still gets a thread, just not linked to a lead.
const unknown = wa.routeInboundMessage({ from: '9000000009', text: 'is anyone there' });
check('unknown caller still gets a thread', !!unknown?.conversation?.id);
check('unknown caller is not linked to a lead', unknown?.conversation?.lead_id == null, `lead_id=${unknown?.conversation?.lead_id}`);
check('unknown caller thread is not the known customer', unknown?.conversation?.id !== db.data.conversations[0].id);

// A message with no sender cannot be attributed to anybody, so it must not
// create an empty thread that later looks like a real customer.
check('message with no from is ignored', wa.routeInboundMessage({ text: 'orphan' }) === null);
check('empty payload is ignored', wa.routeInboundMessage(null) === null);

console.log('\nlead timeline');
const acts = dbHelpers.getLeadById(1)?.activities || [];
check('inbound message is logged on the lead timeline',
  acts.some((a) => a.type === 'chat' && String(a.description).includes('WhatsApp message received')),
  JSON.stringify(acts.map((a) => a.type)));

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
