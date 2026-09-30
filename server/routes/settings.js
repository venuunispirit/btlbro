// Admin settings API (persisted in db.json, not localStorage).
//
//   GET /api/settings  → public pricing subset (+ full object for signed-in staff)
//   PUT /api/settings  → super admin only
//
// The GET is unauthenticated because the public checkout (QuickCheckout) needs
// the live prices to quote a customer. That means the response MUST NOT carry
// secrets: the settings blob also holds `payment.key_secret`, `payu.key`,
// `payu.salt`, `telephony.token` and `whatsapp.access_token`. Anyone who pasted
// one of those into the admin form would otherwise be publishing it to the
// internet. So we redact for anonymous callers and only hand back the full
// object to a signed-in staff member.

import express from 'express';
import { dbHelpers } from '../db.js';
import { optionalStaff, requireSuperAdmin } from '../middleware/staffAuth.js';

const router = express.Router();

// Keys that must never reach an unauthenticated caller.
const SECRET_PATHS = [
  ['payment', 'key_secret'],
  ['payu', 'key'],
  ['payu', 'salt'],
  ['payu', 'payout_merchant_id'],
  ['payu', 'payout_client_id'],
  ['payu', 'payout_client_secret'],
  ['payu', 'payout_token_url'],
  ['telephony', 'token'],
  ['whatsapp', 'access_token'],
];

function redactSettings(settings) {
  const copy = { ...settings };
  for (const [group, key] of SECRET_PATHS) {
    if (copy[group] && typeof copy[group] === 'object' && copy[group][key]) {
      copy[group] = { ...copy[group], [key]: '' };
    }
  }
  return copy;
}

// GET current settings — public, but secrets stripped unless signed in as staff.
router.get('/', optionalStaff, (req, res) => {
  try {
    const settings = dbHelpers.getSettings();
    res.json({ settings: req.staff ? settings : redactSettings(settings) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings', details: error.message });
  }
});

// PUT update settings — super admin only.
// This writes live prices and gateway credentials, so an unauthenticated
// write here would let anyone repoint the booking amount or swap the payout
// account.
router.put('/', requireSuperAdmin, (req, res) => {
  try {
    const body = req.body || {};
    let settings;

    // Nested sub-settings, or flat legacy keys. `upi`/`payu` must be listed
    // here too: the legacy branch below is a 2-key allowlist, so a body
    // carrying only `{ upi: … }` would be silently dropped on the floor.
    if (body.payment || body.store || body.telephony || body.whatsapp || body.upi || body.payu) {
      const cur = dbHelpers.getSettings();
      const clean = { ...cur };
      clean.payment = { ...clean.payment, ...(body.payment || {}) };
      clean.store = { ...clean.store, ...(body.store || {}) };
      clean.telephony = { ...clean.telephony, ...(body.telephony || {}) };
      clean.whatsapp = { ...clean.whatsapp, ...(body.whatsapp || {}) };
      clean.upi = { ...clean.upi, ...(body.upi || {}) };
      clean.payu = { ...clean.payu, ...(body.payu || {}) };
      if (typeof body.agency_fee === 'number') clean.agency_fee = body.agency_fee;
      if (typeof body.per_location_price === 'number') clean.per_location_price = body.per_location_price;
      settings = dbHelpers.updateSettingsExtended(clean);
    } else {
      settings = dbHelpers.updateSettings(body);
    }
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings', details: error.message });
  }
});

export default router;
