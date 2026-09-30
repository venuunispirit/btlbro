// Google Nearby → catchment tab auto-surface
//
// When the Marketing Tool calls /api/places/nearby, real Google places are
// returned. Places not yet inhouse get queued into the master sheet's actual
// catchment tabs (e.g. "Apartment services") with Source=google and a sighting
// counter suffix in the name (1st = no suffix, 5th = "Name (4)").

import { dbHelpers } from '../db.js';
import { queueGoogleSurface, flushGoogleSoon } from './sheetBackfill.js';

// Reverse of frontend getTypeFromGoogleTypes — map google types to our type key
function getTypeFromGoogleTypes(types) {
  const t = (types || []).join(' ').toLowerCase();
  if (t.includes('apartment')) return 'apartments';
  if (t.includes('cafe') || t.includes('coffee')) return 'cafes';
  if (t.includes('restaurant')) return 'cafes';
  if (t.includes('supermarket') || t.includes('grocery') || t.includes('convenience')) return 'supermarkets';
  if (t.includes('shopping_mall') || t.includes('department_store')) return 'malls';
  if (t.includes('school')) return 'schools';
  if (t.includes('university')) return 'colleges';
  if (t.includes('movie_theater') || t.includes('cinema')) return 'cinema';
  if (t.includes('park')) return 'parks';
  if (t.includes('office') || t.includes('corporate')) return 'corporates';
  if (t.includes('hospital') || t.includes('clinic')) return 'hospitals';
  if (t.includes('convention') || t.includes('banquet') || t.includes('event_venue')) return 'convention_centers';
  return 'others';
}

// Keywords to match a google type against known catchment tab names
const TYPE_KEYWORDS = {
  apartments: ['apartment', 'residential'],
  cafes: ['cafe', 'coffee'],
  corporates: ['corporate', 'office', 'business'],
  supermarkets: ['supermarket', 'grocery', 'store', 'mart'],
  malls: ['mall'],
  schools: ['school'],
  colleges: ['college', 'university'],
  cinema: ['cinema', 'theatre', 'theater', 'movie'],
  parks: ['park', 'garden'],
  hospitals: ['hospital', 'clinic'],
  convention_centers: ['convention', 'banquet', 'event'],
};

// Find a matching catchment tab from the known active tabs.
// Returns the original tab name (e.g. "Apartment services") or null.
function resolveSurfaceTab(typeKey, knownTabs) {
  const keywords = TYPE_KEYWORDS[typeKey];
  if (!keywords) return null;
  for (const tab of knownTabs) {
    const lower = tab.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) return tab;
    }
  }
  return null;
}

// Main entry: call after nearby returns. Fire-and-forget safe (never throws).
export function surfaceNearby(places) {
  try {
    const knownTabs = dbHelpers.getActiveTabNames();
    if (knownTabs.length === 0) return;

    let queued = 0;
    for (const place of places) {
      const typeKey = getTypeFromGoogleTypes(place.types);
      const tab = resolveSurfaceTab(typeKey, knownTabs);
      if (!tab) continue;

      const baseName = (place.name || '').trim();
      if (!baseName) continue;

      // Skip if this place is already inhouse
      if (dbHelpers.isNameInhouse(baseName)) continue;

      // Bump sighting counter
      const key = `${typeKey}|${baseName.toLowerCase()}`;
      const count = dbHelpers.bumpGoogleSeen(key);
      const displayName = count >= 2 ? `${baseName} (${count - 1})` : baseName;

      queueGoogleSurface({ tab, baseName, name: displayName, lat: place.lat, lng: place.lng, place_id: place.place_id });
      queued++;
    }

    if (queued > 0) {
      console.log(`[GoogleSurface] Queued ${queued} place(s) for catchment backfill`);
      flushGoogleSoon();
    }
  } catch (err) {
    console.warn('[GoogleSurface] Error:', err.message);
  }
}
