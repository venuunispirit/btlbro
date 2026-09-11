// Admin settings API (persisted in db.json, not localStorage).
//
//   GET /api/settings  → { settings: { per_location_price, agency_fee } }
//   PUT /api/settings  → update settings (numbers only)

import express from 'express';
import { dbHelpers } from '../db.js';

const router = express.Router();

// GET current settings
router.get('/', (req, res) => {
  try {
    res.json({ settings: dbHelpers.getSettings() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings', details: error.message });
  }
});

// PUT update settings
router.put('/', (req, res) => {
  try {
    const body = req.body || {};
    let settings;

    // Nested sub-settings: { payment: {...}, store: {...} } or flat legacy keys
    if (body.payment || body.store) {
      const cur = dbHelpers.getSettings();
      const clean = { ...cur };
      clean.payment = { ...clean.payment, ...(body.payment || {}) };
      clean.store = { ...clean.store, ...(body.store || {}) };
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
