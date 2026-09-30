// Build a human-openable Google Maps link for a location row.
//
// Priority:
//   1. place_id (from the Places API) → exact place page
//   2. place name → Maps search for that name (same format inhouse rows use)
//   3. coordinates → last-resort dot on the map
export function buildGmapLink({ name, lat, lng, place_id } = {}) {
  const pid = String(place_id || '').trim();
  if (pid) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(pid)}`;
  const n = String(name || '').trim();
  if (n) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n)}`;
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
  return '';
}