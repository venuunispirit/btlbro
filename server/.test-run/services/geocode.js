// Geocoding service — turns Google-Maps place queries and PIN codes into
// lat/lng using the free OpenStreetMap Nominatim API.
//
// - Nominatim usage policy: max ~1 request/second + a descriptive User-Agent.
// - Results are cached in data/geocode-cache.json so each place is geocoded
//   once ever; failed lookups are NOT cached (they retry on the next sync).
// - Used by the sheet sync (place names from GMaps links) so the marketing
//   tool can compute pincode → place distances.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'data', 'geocode-cache.json');

const MIN_GAP_MS = 1100; // Nominatim courtesy: ≤ ~1 req/s
const REQUEST_TIMEOUT_MS = 15000;

let cache = {};
try {
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch {
  cache = {};
}

let cacheTimer = null;
function saveCacheSoon() {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
    } catch (e) {
      console.warn('[Geocode] Could not persist cache:', e.message);
    }
  }, 500);
}

const FAILURE_TTL_MS = 24 * 60 * 60 * 1000; // retry failed lookups once a day

let lastCallAt = 0;
async function politeGap() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function nominatimSearch(params) {
  const qs = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'in', ...params });
  await politeGap();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { 'User-Agent': 'BTLbroSync/1.0 (marketing tool geocoding)' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Geocode a free-text place. Returns { lat, lng, display_name } or null.
// Failed lookups are remembered for 24h so syncs don't waste their geocoding
// budget retrying queries Nominatim can't resolve.
export async function geocodeQuery(text) {
  const key = `q:${String(text).toLowerCase().trim()}`;
  const cached = cache[key];
  if (cached) {
    if (cached.failed) return null; // recent failure — don't retry yet
    return cached;
  }

  const results = await nominatimSearch({ q: text });
  const hit = results && results[0];
  if (hit && hit.lat && hit.lon) {
    const value = { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), display_name: hit.display_name || '' };
    cache[key] = value;
    saveCacheSoon();
    return value;
  }
  cache[key] = { failed: true, at: Date.now() };
  saveCacheSoon();
  return null;
}

// Geocode a 6-digit Indian PIN code to its nominal (central) point.
export async function geocodePincode(pin) {
  const key = `pin:${pin}`;
  if (cache[key]) return cache[key];

  const results = await nominatimSearch({ postalcode: pin, country: 'India' });
  const hit = results && results[0];
  if (hit && hit.lat && hit.lon) {
    const value = { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), display_name: hit.display_name || '' };
    cache[key] = value;
    saveCacheSoon();
    return value;
  }
  return null;
}

// Build progressively shorter query variants from a GMaps link query like
// "Prestige Kingfisher Towers, Lavelle Road, Bengaluru, Karnataka, India".
// Longest (most specific) first, ending with the place name + city guesses.
export function geocodeVariants(query) {
  const clean = String(query || '')
    .replace(/\s*,\s*India\s*\.?\s*$/i, '')
    .trim();
  if (!clean) return [];
  const segs = clean.split(',').map((s) => s.trim()).filter(Boolean);

  const variants = [];
  for (let n = segs.length; n >= 1; n--) {
    variants.push(segs.slice(0, n).join(', '));
  }
  // Common trap: "Bangalore" is often missing from OSM entries but "Bengaluru" works
  const first = segs[0] || clean;
  if (!/bengaluru|bangalore/i.test(first)) {
    variants.push(`${first}, Bengaluru`);
    variants.push(`${first} Bengaluru`);
  }
  return [...new Set(variants)];
}

// Try variants in order until one resolves. Returns {lat,lng,display_name} | null.
// Variants recently failed (cached <24h) are skipped without a network call.
export async function geocodePlaceVariants(query) {
  for (const variant of geocodeVariants(query)) {
    const key = `q:${variant.toLowerCase().trim()}`;
    const cached = cache[key];
    if (cached && cached.failed) continue;
    const hit = await geocodeQuery(variant);
    if (hit) return hit;
  }
  return null;
}

// Extract coordinates / search query from a Google Maps URL.
// Handles @lat,lng  ·  !3dlat!4dlng  ·  q=lat,lng  ·  q=place+name  ·  query=place+name
export function parseGmapsUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return { lat: 0, lng: 0, query: '' };

  let m = raw.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), query: '' };

  m = raw.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]), query: '' };

  try {
    const qMatch = raw.match(/[?&](?:q|query)=([^&]+)/);
    if (qMatch) {
      const decoded = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim();
      const coord = decoded.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
      if (coord) return { lat: parseFloat(coord[1]), lng: parseFloat(coord[2]), query: '' };
      return { lat: 0, lng: 0, query: decoded };
    }
  } catch { /* malformed URL — fall through */ }

  return { lat: 0, lng: 0, query: '' };
}
