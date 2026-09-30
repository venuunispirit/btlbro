// Telephony service (Twilio) — click-to-call + inbound routing
//
// Click-to-call: dials the exec's device number, then bridges the customer.
// Inbound routing: Twilio webhook → find lead by caller → route to assigned exec's device.
//
// Requires: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in .env or settings.telephony.

import { dbHelpers } from '../db.js';
import { resolveRoute, logMissedCall, routingHealth } from './callRouter.js';

function getConfig() {
  const settings = dbHelpers.getSettings();
  return {
    sid: process.env.TWILIO_SID || settings.telephony?.sid || '',
    token: process.env.TWILIO_TOKEN || settings.telephony?.token || '',
    from: process.env.TWILIO_FROM || settings.telephony?.from_number || '',
    enabled: settings.telephony?.enabled || false,
  };
}

function twilioApi(path, method = 'GET', body = null) {
  const config = getConfig();
  if (!config.sid || !config.token) throw new Error('Twilio not configured');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.sid}${path}`;
  const auth = 'Basic ' + Buffer.from(config.sid + ':' + config.token).toString('base64');

  const opts = {
    method,
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body) {
    opts.body = new URLSearchParams(body).toString();
  }
  return fetch(url, opts).then((r) => r.json());
}

// Click-to-call: dial exec's device, then bridge customer
export async function clickToCall(leadId, staffId) {
  const config = getConfig();
  if (!config.enabled || !config.sid || !config.from) {
    throw new Error('Telephony not configured');
  }

  const lead = dbHelpers.getLeadById(leadId);
  if (!lead) throw new Error('Lead not found');
  if (!lead.phone) throw new Error('No phone number on lead');

  const member = dbHelpers.getUserById(staffId);
  if (!member) throw new Error('Staff member not found');
  const deviceNumber = member.device_number || member.phone;
  if (!deviceNumber) throw new Error('No device number set for this staff member');

  // Create TwiML: dial the exec, then when answered, connect to customer
  const twiml = `<Response><Dial timeout="30" action="/api/telephony/connect-caller" method="POST"><Number statusCallback="/api/telephony/status" statusCallbackMethod="POST">${deviceNumber}</Number></Dial></Response>`;

  // Initiate call to the exec's device
  const result = await twilioApi('/Calls.json', 'POST', {
    To: deviceNumber,
    From: config.from,
    Twiml: twiml,
    StatusCallback: '/api/telephony/status',
    StatusCallbackMethod: 'POST',
  });

  if (result.sid) {
    // Log activity on lead
    dbHelpers.addLeadActivity(leadId, {
      type: 'call',
      description: `Outbound call initiated to ${lead.phone}`,
      actor: member.name || member.email,
      meta: { call_sid: result.sid, direction: 'outbound' },
    });
  }

  return result;
}

// Handle an inbound call webhook from the provider.
//
// The ring list is ordered and sequential: the customer's assigned exec first,
// then their BDM, then the pool. A provider rings each in turn for RING_TIMEOUT
// and moves on, which is the whole point of returning a list rather than one
// number — a call from a known customer reaches the right person first, and an
// unknown caller still reaches a human rather than voicemail.
const RING_TIMEOUT = 25;

export function handleInboundWebhook(body) {
  const callerNumber = body.From;
  const calledNumber = body.To;
  const { lead, targets, reason } = resolveRoute(callerNumber);

  if (!targets.length) {
    // Nothing to ring. Say something, and tell the team, rather than dropping.
    logMissedCall(callerNumber, calledNumber, { targetCount: 0 });
    return `<Response>
      <Say>Thanks for calling BTLbro. Our team is not available right now. Please leave your number with us and we will call you back.</Say>
      <Pause length="1"/>
      <Say>Thank you.</Say>
    </Response>`;
  }

  // A sequential cascade. Each <Number> is tried in turn.
  const dial = targets.map((t) =>
    `<Number statusCallback="/api/telephony/status" statusCallbackMethod="POST" timeout="${RING_TIMEOUT}">${t.number}</Number>`,
  ).join('');

  // Log the attempt against the lead so the trail shows who was rung.
  if (lead) {
    dbHelpers.addLeadActivity(lead.id, {
      type: 'call',
      description: `Inbound call from ${callerNumber} — ringing ${targets.length} (${reason})`,
      actor: 'system',
      meta: {
        direction: 'inbound', from: callerNumber, to: calledNumber,
        outcome: 'routing', ringed: targets.map((t) => t.name), reason,
      },
    });
  }

  // If every target misses, the no-answer action records the missed call.
  return `<Response>
    <Dial timeout="${RING_TIMEOUT * targets.length + 10}" action="/api/telephony/connect-caller" method="POST">
      ${dial}
    </Dial>
  </Response>`;
}

/** Twilio's no-answer target, for one specific number. */
export function handleNoAnswerWebhook(body) {
  const caller = body.From;
  const called = body.To;
  // Only the "none answered" outcome is ours to record; an answered call is
  // already logged, and recording it again would double-count a hit.
  if (body.CallStatus === 'no-answer' || body.DialStatus === 'no-answer' || body.Outcome === 'no-answer') {
    logMissedCall(caller, called, { targetCount: body._targetCount || null, seconds: body.CallDuration || null });
  }
  return '<Response/>';
}

// Handle call status updates
export function handleStatusCallback(body) {
  const callSid = body.CallSid;
  const status = body.CallStatus;
  const duration = body.CallDuration;

  // Could update activity log with final status, but keep it simple for now
  return null;
}

// What is configured, without echoing any secret. The Settings screen uses this
// to show whether calls can route at all; routingHealth() adds the deeper
// diagnosis (who has no number, what is missing).
export function getStatus() {
  const config = getConfig();
  return {
    enabled: config.enabled,
    provider: settingsProvider(),
    from_number: config.from,
    has_credentials: !!(config.sid && config.token),
  };
}

function settingsProvider() {
  return dbHelpers.getSettings()?.telephony?.provider || 'twilio';
}

export { routingHealth };
