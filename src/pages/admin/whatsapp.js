// WhatsApp click-to-chat: message a customer from inside the CRM.
//
// This is a deep link, not an integration. https://wa.me/<intl number> opens the
// staff member's own WhatsApp with the conversation and message pre-filled; they
// press send. No Meta account, no Business verification, no approval, no cost.
//
// The one thing that must be right is the number format. wa.me needs the FULL
// international number with the country code and no punctuation:
//
//     9876500001  ->  wa.me/919876500001     (what we send)
//     9876500001  ->  wa.me/?text=...        (what PaymentsTab used to send)
//
// The second form has no number in it, so it only works on a device that already
// has that chat open. For messaging an arbitrary lead it silently did nothing.

/** The number BTLbro sends from, shown in every message. */
export const BTLBRO_WA = '6366870248';
const DEFAULT_CODE = '91'; // India

/**
 * Full international number for wa.me, or '' if we cannot build one.
 * Strips +, spaces, dashes and a leading 0, then prefixes the country code.
 */
export function toWaNumber(phone, countryCode = DEFAULT_CODE) {
  const raw = String(phone || '');
  if (!raw) return '';
  // A number already carrying +91 or 0091 should not become 9191...
  if (raw.trim().startsWith('+')) {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 11 ? digits : `${countryCode}${digits}`;
  }
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length !== 10) return '';
  return `${countryCode}${digits}`;
}

/** The click-to-chat link. Empty string when there is no usable number. */
export function waLink(phone, text, countryCode = DEFAULT_CODE) {
  const num = toWaNumber(phone, countryCode);
  if (!num) return '';
  const body = String(text || '').trim();
  return body ? `https://wa.me/${num}?text=${encodeURIComponent(body)}` : `https://wa.me/${num}`;
}

/** Is there a number worth offering a WhatsApp button for? */
export function canWhatsApp(phone) {
  return toWaNumber(phone) !== '';
}

const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * Message templates. Each returns a string; the staff member can edit it before
 * sending, which is the point — these are starters, not rigid copy.
 *
 * `ctx` is whatever the calling tab has on the record: name, business, amount
 * paid or owed, reference, date.
 */
export const TEMPLATES = [
  {
    id: 'follow_up',
    label: 'Follow up',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, this is ${c.who || 'BTLbro'}. Just following up on your enquiry${c.business ? ` for ${c.business}` : ''}. Would you like me to share a quote?`,
  },
  {
    id: 'payment_reminder',
    label: 'Payment reminder',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, a quick reminder that ${c.amount ? `${inr(c.amount)} ` : ''}is pending on your ${c.what || 'campaign'}${c.reference ? ` (ref ${c.reference})` : ''}. You can pay here: ${c.link || 'https://btlbro.in/checkout'}`,
  },
  {
    id: 'payment_received',
    label: 'Payment received',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, we've received your payment of ${inr(c.amount)}${c.reference ? ` (ref ${c.reference})` : ''}. Thank you — we'll keep you posted.`,
  },
  {
    id: 'site_visit',
    label: 'Site visit scheduled',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, your site visit is confirmed for ${c.date || 'the scheduled date'}. Our team will be there. Please share the gate/entry details if not already sent.`,
  },
  {
    id: 'quote_ready',
    label: 'Quote ready',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, your quote is ready${c.amount ? `: ${inr(c.amount)}` : ''}. Shall I send the full breakdown?`,
  },
  {
    id: 'campaign_live',
    label: 'Campaign live',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, your campaign is live${c.locations ? ` across ${c.locations} locations` : ''}. Here are the live details — let us know if anything needs changing.`,
  },
  {
    id: 'thank_you',
    label: 'Thank you',
    build: (c = {}) =>
      `Hi ${c.name || 'there'}, thanks for choosing ${c.who || 'BTLbro'}. We'd love to hear how the campaign went — one line is plenty.`,
  },
];

/** Build a message from a template id. Falls back to a plain greeting. */
export function buildMessage(templateId, ctx = {}) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return '';
  return t.build(ctx);
}
