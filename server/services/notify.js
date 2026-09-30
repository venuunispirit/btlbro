// Notification fan-out for payment events.
//
// The ledger writes an event into db.data.notifications whenever a movement
// settles (see queuePaymentNotification in db.js). Delivery lives here, kept
// deliberately separate: payment code never imports a channel, so adding email
// or SMS later means adding an adapter below and nothing else.
//
// Today only WhatsApp exists as a transport, and it is unconfigured — so the
// adapter reports itself unavailable and the event simply stays in the feed.
// Nothing throws into a payment path.

import { dbHelpers, setNotificationDispatcher } from '../db.js';
import { sendTextMessage, getStatus as whatsappStatus } from './whatsapp.js';

// A channel is only "live" when its own credentials are present. Returning
// `available: false` instead of throwing is deliberate: the in-app feed is
// always the source of truth, delivery is best-effort on top of it.
const channels = {
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',

    available() {
      const status = whatsappStatus();
      return !!(status && status.configured);
    },

    // Deliver to whoever this event is about. Staff events have no single
    // recipient by design, so only vendor-scoped events go out over WhatsApp.
    async send(notification) {
      if (!notification.vendor_id) return { sent: false, reason: 'no-recipient' };
      const vendor = dbHelpers.getVendorById(notification.vendor_id);
      const to = vendor && vendor.phone;
      if (!to) return { sent: false, reason: 'vendor-has-no-phone' };

      const lines = [
        `*${notification.title}*`,
        notification.body,
        notification.reference ? `Ref: ${notification.reference}` : '',
      ].filter(Boolean);

      await sendTextMessage(to, lines.join('\n'));
      return { sent: true };
    },
  },
};

export function listChannels() {
  return Object.values(channels).map((c) => ({
    id: c.id,
    label: c.label,
    available: (() => { try { return c.available(); } catch { return false; } })(),
  }));
}

// Best-effort delivery for one stored event. Never throws: a failed send must
// not roll back or rethrow into the payment that produced the event.
export async function dispatch(notification) {
  const results = [];
  for (const channel of Object.values(channels)) {
    let available = false;
    try {
      available = channel.available();
    } catch {
      results.push({ channel: channel.id, sent: false, reason: 'config-check-failed' });
      continue;
    }
    if (!available) {
      results.push({ channel: channel.id, sent: false, reason: 'not-configured' });
      continue;
    }
    try {
      const outcome = await channel.send(notification);
      results.push({ channel: channel.id, ...outcome });
    } catch (error) {
      results.push({ channel: channel.id, sent: false, reason: error.message });
    }
  }
  return results;
}

// Fire-and-forget. Called after an event is written; delivery happens outside
// the request that caused it.
export function dispatchAsync(notification) {
  setTimeout(() => {
    dispatch(notification).catch(() => {});
  }, 0).unref?.();
}

// Called once at boot from index.js. db.js holds no knowledge of channels, so
// without this the feed would fill up and nothing would ever be sent.
export function install() {
  setNotificationDispatcher(dispatchAsync);
  return listChannels();
}

// Convenience for callers outside the ledger hook (e.g. a bill was submitted,
// or a vendor registered) that want an in-app event without a payment.
export function record({ audience = 'staff', type, title, body, tone = 'neutral', ...rest }) {
  return dbHelpers.addNotification({ audience, type, title, body, tone, ...rest });
}
