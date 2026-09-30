// Inbound call routing — who should ring when a customer calls BTLbro.
//
// The rule the business asked for, in order:
//
//   1. If the caller's number matches a lead, that lead's assigned BD exec.
//   2. Then that lead's BDM.
//   3. Then the rest of the team, as a pool.
//   4. Nobody answerable → say something, and log a missed call on the lead so
//      the enquiry is not lost.
//
// Two design points worth stating, because both are load-bearing:
//
//  * The result is an ORDERED LIST, not a set. A provider rings a list
//    sequentially and moves to the next when one does not answer, which is
//    what "assigned person first, then pool" actually means in practice. Ringing
//    everyone at once would be a different, much more disruptive product.
//
//  * Availability is deliberately not modelled. The decision was "always
//    available, no status" — so everyone with a routable number is ringable.
//    That is a real operational cost (the whole team can be pinged at 11pm) and
//    `excludedIds` is the hook to add a busy toggle later without changing the
//    shape of anything here.
//
// The phone match is a "last 10 digits" comparison, not equality. Customers
// dial with and without +91, and a number stored as "98765 43210" has to match
// one dialled as "+91 98765 43210".

import { dbHelpers } from '../db.js';

// Roles that get a customer's sales call. Field staff (recee, ops_executive)
// are deliberately excluded: a recee driving between sites is the worst person
// to hand a pricing question to.
const DEFAULT_POOL_ROLES = [
  'bdm', 'bd_executive', 'manager', 'recee_manager', 'ops_manager', 'super_admin',
];

/** Digits only, and only the last 10 — enough to make both dial formats match. */
export function normalisePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (!digits) return '';
  // Drop a leading 0 (landline style 0987…) and a country code.
  const tail = digits.length > 10 ? digits.slice(-10) : digits.replace(/^0+/, '');
  return tail.length === 10 ? tail : tail;
}

function routableNumber(user) {
  return user?.device_number || user?.phone || '';
}

/** Find the lead this caller belongs to, if we know them. */
export function findLeadByPhone(from) {
  const wanted = normalisePhone(from);
  if (!wanted) return null;
  return dbHelpers.getLeads().find((l) => l.phone && normalisePhone(l.phone) === wanted) || null;
}

function poolFor(roles, excluded) {
  return dbHelpers.getTeamMembers()
    .filter((m) => m.is_active !== false)
    .filter((m) => roles.includes(m.role))
    .filter((m) => routableNumber(m))
    .filter((m) => !excluded.has(m.id))
    // Super admins first in the pool: they are the people least likely to be
    // absent and most likely to be able to actually help.
    .sort((a, b) => {
      const rank = (r) => (r === 'super_admin' ? 0 : r === 'manager' ? 1 : 2);
      return rank(a.role) - rank(b.role) || a.id - b.id;
    });
}

/**
 * The ordered ring list for an inbound call.
 *
 * @returns {{
 *   lead: object|null,
 *   targets: Array<{ id:number, name:string, role:string, number:string, via:string }>,
 *   reason: string,
 * }}
 */
export function resolveRoute(from) {
  const lead = findLeadByPhone(from);
  const seen = new Set();
  const targets = [];

  const push = (user, via) => {
    if (!user || user.is_active === false) return;
    const number = routableNumber(user);
    if (!number || seen.has(user.id)) return;
    seen.add(user.id);
    targets.push({ id: user.id, name: user.name || user.email, role: user.role, number, via });
  };

  // 1 + 2. The people already working this customer.
  if (lead) {
    if (lead.bd_exec_id) push(dbHelpers.getUserById(lead.bd_exec_id), 'assigned exec');
    if (lead.bdm_id) push(dbHelpers.getUserById(lead.bdm_id), 'assigned bdm');
  }

  // 3. Everyone else, so the call is never simply dropped.
  const roles = dbHelpers.getSettings()?.telephony?.pool_roles?.length
    ? dbHelpers.getSettings().telephony.pool_roles
    : DEFAULT_POOL_ROLES;
  for (const m of poolFor(roles, seen)) push(m, 'pool');

  return {
    lead,
    targets,
    reason: lead
      ? (targets.some((t) => t.via.startsWith('assigned'))
        ? 'known customer, assigned owner first'
        : 'known customer, no owner assigned — pool')
      : 'unknown caller — pool',
  };
}

/**
 * Record that a customer called and nobody picked up.
 *
 * Written as a lead activity when we know who called, and always as a staff
 * notification, because a missed call that only exists in a provider dashboard
 * is a missed call that gets forgotten.
 */
export function logMissedCall(from, to, { targetCount = 0, seconds = null } = {}) {
  const number = String(from || '');
  const lead = findLeadByPhone(number);
  const stamp = new Date().toISOString();

  if (lead) {
    dbHelpers.addLeadActivity(lead.id, {
      type: 'call',
      description: `Missed call from ${number}${seconds ? ` (${seconds}s)` : ''}`,
      actor: 'system',
      meta: { direction: 'inbound', outcome: 'missed', from: number, to, target_count: targetCount, at: stamp },
    });
    dbHelpers.updateLead(lead.id, { last_missed_call_at: stamp, last_missed_call_from: number });
  }

  dbHelpers.addNotification({
    audience: 'staff',
    type: 'missed_call',
    tone: 'warn',
    title: 'Missed call',
    body: lead
      ? `${lead.contactName || lead.business_name || number} called and it went unanswered.`
      : `${number} called BTLbro and it went unanswered.`,
    ...(lead ? { lead_id: lead.id } : {}),
    phone: number,
    at: stamp,
  });

  return { lead, recorded: true };
}

/** Is the number configured well enough for a call to land anywhere? */
export function routingHealth() {
  const settings = dbHelpers.getSettings() || {};
  const t = settings.telephony || {};
  const members = dbHelpers.getTeamMembers().filter((m) => m.is_active !== false);
  const routable = members.filter((m) => routableNumber(m));
  const missing = members.filter((m) => !routableNumber(m)).map((m) => ({ id: m.id, name: m.name, role: m.role }));
  return {
    enabled: !!t.enabled,
    provider: t.provider || 'twilio',
    has_credentials: !!(t.sid && t.token),
    has_number: !!t.from_number,
    team_size: members.length,
    routable_count: routable.length,
    members_without_number: missing,
    // A number with nobody to ring is worse than no number: the caller hears
    // ringing and is dropped.
    ready: !!(t.enabled && t.sid && t.token && t.from_number && routable.length > 0),
    problems: [
      !t.enabled && 'Telephony is switched off in Settings',
      !(t.sid && t.token) && 'No provider credentials saved',
      !t.from_number && 'No BTLbro number set',
      routable.length === 0 && 'No team member has a phone or device number to ring',
    ].filter(Boolean),
  };
}
