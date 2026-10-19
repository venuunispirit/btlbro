// Google Places Autocomplete proxy.
//
//   GET /api/places/autocomplete?input=<text>
//
// Proxies the Google Places API (New) Autocomplete endpoint so the browser
// never sees the API key. Returns a flat list of { label } for the Marketing
// Tool search box. Falls back to an empty list (no crash) when the key is
// missing or the upstream call fails. Biased to India via components=country:in.

import express from 'express';
import { surfaceNearby } from '../services/googleSurface.js';
import { queueBackfill, flushGoogleSoon } from '../services/sheetBackfill.js';
import { dbHelpers } from '../db.js';

const router = express.Router();

router.get('/autocomplete', async (req, res) => {
  try {
    const input = String(req.query.input || '').trim();
    if (input.length < 2) return res.json({ suggestions: [] });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({ suggestions: [], error: 'GOOGLE_MAPS_API_KEY not set' });

    const params = new URLSearchParams({
      key: apiKey,
      input,
      components: 'country:in',
    });

    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await resp.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(502).json({ suggestions: [], error: `Places API status: ${data.status}` });
    }

    const suggestions = (data.predictions || []).map((p) => ({
      label: p.description,
      place_id: p.place_id,
    }));

    res.json({ suggestions });
  } catch (error) {
    res.status(502).json({ suggestions: [], error: error.message });
  }
});

// Geocode a free-text place or PIN code → lat/lng via Google Geocoding API.
//
//   GET /api/places/geocode?input=<text>
//
// Replaces the Nominatim call in the Marketing Tool so a searched Google
// suggestion resolves to its precise coordinates. Returns { lat, lng } or
// { error } (never throws).
router.get('/geocode', async (req, res) => {
  try {
    const input = String(req.query.input || '').trim();
    if (!input) return res.status(400).json({ error: 'input is required' });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({ error: 'GOOGLE_MAPS_API_KEY not set' });

    const params = new URLSearchParams({
      key: apiKey,
      address: input,
      components: 'country:IN',
    });

    const resp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const data = await resp.json();

    if (data.status !== 'OK' || !data.results || !data.results[0] || !data.results[0].geometry) {
      return res.json({ error: `Geocode status: ${data.status}` });
    }
    const { lat, lng } = data.results[0].geometry.location;
    res.json({ lat, lng, formatted_address: data.results[0].formatted_address });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Static map image proxy.
//
//   GET /api/places/staticmap?lat=<n>&lng=<n>[&zoom=15][&size=600x270]
//
// The Google Static Maps API key stays on the server — the browser only ever
// requests this proxy, never Google directly. Returns the raw PNG with a cache
// header so repeat views (same site, same size) don't re-bill the API.
// Falls back to a 502 JSON error the caller can turn into a placeholder.
router.get('/staticmap', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'lat/lng required' });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY not set' });

    // Static Maps caps a single render at 640x640 (free tier) — clamp to it.
    const size = String(req.query.size || '600x270').trim();
    const zoom = Math.min(Math.max(parseInt(req.query.zoom, 10) || 15, 1), 20);

    const params = new URLSearchParams({
      key: apiKey,
      center: `${lat},${lng}`,
      zoom: String(zoom),
      size: /^\d{2,3}x\d{2,3}$/.test(size) ? size : '600x270',
      maptype: 'roadmap',
      markers: `color:0xF2701D|size:mid|label:S|${lat},${lng}`,
    });

    const resp = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || !contentType.startsWith('image/')) {
      const text = await resp.text().catch(() => '');
      return res.status(502).json({ error: `Static Maps error`, detail: text.slice(0, 200) });
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Nearby search for catchment-relevant places around a point (Places API New).
//
//   GET /api/places/nearby?lat=<n>&lng=<n>&radius=<m>&types=cafe,supermarket
//
// Returns real places (name + coordinates + category) so the Marketing Tool can
// visually show EVERYTHING around the user even when our sheet has no data for
// that catchment. These are "on request" — handled manually, not bookable.
// type → Google includedTypes mapping lives here so the frontend stays simple.
const TYPE_TO_GOOGLE = {
  apartments: ['apartment_building', 'apartment_complex'],
  corporates: ['corporate_office', 'coworking_space'],
  cafes: ['cafe', 'coffee_shop', 'restaurant'],
  supermarkets: ['supermarket', 'convenience_store', 'grocery_store'],
  malls: ['shopping_mall', 'department_store'],
  schools: ['school', 'primary_school', 'secondary_school'],
  colleges: ['university'],
  cinema: ['movie_theater'],
  parks: ['park'],
  hospitals: ['hospital', 'medical_center'],
  convention_centers: ['banquet_hall', 'convention_center', 'event_venue'],
};

// Types Google's Nearby (New) searchNearby rejects outright. We drop them
// instead of letting one bad type fail the whole batch request.
const UNSUPPORTED_NEARBY_TYPES = new Set([
  'office', 'business_operation', 'office_building', 'clinic', 'health',
]);

// Track a searched location from the Marketing Tool so it reaches the master
// sheet (CRM Backfill) and immediately appears in the Data tab.
//
//   POST /api/places/track  { name, lat, lng, type, source }
router.post('/track', (req, res) => {
  try {
    const { name, lat, lng, type, source } = req.body || {};
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ error: 'name required' });
    const lt = Number(lat);
    const lg = Number(lng);
    if (!Number.isFinite(lt) || !Number.isFinite(lg)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }

    const src = source === 'from google' || source === 'google' ? 'from google' : 'inhouse';
    const t = String(type || 'searched').trim() || 'searched';

    queueBackfill({ name: nm, type: t, lat: lt, lng: lg, source: src });
    // Push the row to the master sheet now (fire-and-forget) so the location
    // reaches CRM Backfill instead of waiting for a manual flush.
    flushGoogleSoon();

    // Best-effort: upsert an active record so it shows in the Data tab before
    // the next sheet sync. It is flagged `crm_backfill` so a sync never
    // deactivates it while the sheet write is still in flight. The sheet
    // remains the source of truth.
    try {
      dbHelpers.upsertRecord({
        sheet_id: `${t} | ${nm}`,
        name: nm,
        source: src === 'from google' ? 'google' : src,
        type: t,
        tab_name: t,
        sl_no: '',
        pin_code: '',
        has_pin_column: false,
        distance_km: 0,
        has_distance_column: false,
        lat: lt,
        lng: lg,
        gmap_link: '',
        gmap_query: nm,
        services: {},
        crm_backfill: true,
        is_active: true,
      });
    } catch (e) {
      // record upsert is best-effort — never fail the request over it
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/nearby', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.json({ places: [], error: 'GOOGLE_MAPS_API_KEY not set' });

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'lat/lng required' });
    // The user-selected radius IS the only limit — Google returns its full
    // in-radius set. 50,000m is Google's hard per-search cap.
    const radius = Math.min(Math.max(parseInt(req.query.radius) || 5000, 1000), 50000);

    const types = String(req.query.types || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => TYPE_TO_GOOGLE[t]);
    if (types.length === 0) return res.json({ places: [] });

    // Google caps each searchNearby call at 20 results (pagination removed in
    // the New API). To return EVERYTHING inside the user's radius we fire one
    // request PER catchment type — each gets its own 20 in-radius, then we
    // merge + dedupe. No artificial business limit is applied on top of that.

    async function searchOne(includedTypes) {
      const body = {
        includedTypes,
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius },
        },
      };
      try {
        const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.displayName,places.location,places.types,places.id',
          },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok) return [];
        return (data.places || []).map((p) => ({
          place_id: p.id,
          name: (p.displayName && p.displayName.text) || 'Unknown',
          lat: p.location.latitude,
          lng: p.location.longitude,
          types: p.types || [],
        }));
      } catch {
        return [];
      }
    }

    const batches = await Promise.all(types.map(async (t) => {
      // Drop any Google-rejected type so one bad value never empties a request.
      const includedTypes = TYPE_TO_GOOGLE[t].filter((g) => !UNSUPPORTED_NEARBY_TYPES.has(g));
      if (includedTypes.length === 0) return [];
      return searchOne(includedTypes);
    }));

    const seen = new Map();
    for (const batch of batches) {
      for (const p of batch) {
        if (!seen.has(p.place_id)) seen.set(p.place_id, p);
      }
    }
    const places = [...seen.values()];

    // Auto-surface non-inhouse places into catchment tabs (fire-and-forget)
    surfaceNearby(places);

    res.json({ places, count: places.length, radius });
  } catch (error) {
    res.status(502).json({ places: [], error: error.message });
  }
});

export default router;
