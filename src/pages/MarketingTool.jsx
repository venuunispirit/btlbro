import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, MapPin, Locate, ChevronDown } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ============================================================
   BTLbro — Marketing Tool
   Location/pincode search + radius selection slider
   ============================================================ */

// Session-only persistence: survives navigation/reload inside the tab and lets
// "Back to Search" from checkout restore the results view. Auto-deleted when the
// tab closes — never persistent data.
function loadSession(key, fallback) {
  try {
    const saved = sessionStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch { return fallback; }
}

const popularLocations = [
  "Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune",
  "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow",
];

const categories = [
  { id: "apartments", label: "Apartments", icon: "🏢", overpass: ["apartments", "residential", "dormitory", "house", "apartment"] },
  { id: "corporates", label: "Corporates", icon: "💼", overpass: ["office", "company", "corporate", "coworking"] },
  { id: "parks", label: "Parks", icon: "🌳", overpass: ["park", "garden", "playground", "recreation_ground"] },
  { id: "supermarkets", label: "Supermarkets", icon: "🛒", overpass: ["supermarket", "grocery", "convenience"] },
  { id: "malls", label: "Malls", icon: "🛍️", overpass: ["mall", "department_store", "retail"] },
  { id: "schools", label: "Schools", icon: "🎓", overpass: ["school", "kindergarten"] },
  { id: "colleges", label: "Colleges", icon: "🏛️", overpass: ["university", "college", "library"] },
  { id: "cinema", label: "Cinema Screens", icon: "🎬", overpass: ["cinema", "movie_theatre", "theatre"] },
  { id: "tvradio", label: "TV & Radio Ads", icon: "📺", overpass: ["studio", "radio", "television"] },
  { id: "newspaper", label: "Newspaper Insertions", icon: "📰", overpass: ["newsagent", "kiosk", "newspaper"] },
  { id: "metro", label: "Metro Stations", icon: "🚇", overpass: ["station", "subway", "metro", "tram"] },
  { id: "vehicle", label: "Vehicle Branding", icon: "🚐", overpass: ["parking", "bus_station", "fuel"] },
  { id: "hoardings", label: "Hoardings", icon: "🪧", overpass: ["advertising", "billboard", "billboard_advertising"] },
];

// Icon + label for a catchment type coming from the Google Sheet tabs
// ("apartment services" → 🏢 Apartments, "cafe" → ☕ Cafes, "metro station" → 🚇 …)
const CATEGORY_META = [
  { match: /apartment/, label: "Apartments", icon: "🏢" },
  { match: /cafe|coffee|restaurant/, label: "Cafes", icon: "☕" },
  { match: /metro|station/, label: "Metro Stations", icon: "🚇" },
  { match: /park|garden/, label: "Parks", icon: "🌳" },
  { match: /mall/, label: "Malls", icon: "🛍️" },
  { match: /school/, label: "Schools", icon: "🎓" },
  { match: /college|university/, label: "Colleges", icon: "🏛️" },
  { match: /cinema|theatre/, label: "Cinema Screens", icon: "🎬" },
  { match: /corporate|office|company/, label: "Corporates", icon: "💼" },
  { match: /supermarket|grocery/, label: "Supermarkets", icon: "🛒" },
  { match: /newspaper/, label: "Newspapers", icon: "📰" },
  { match: /vehicle/, label: "Vehicle Branding", icon: "🚐" },
  { match: /hoarding|ooh|billboard/, label: "Hoardings", icon: "🪧" },
  { match: /tv|radio|studio/, label: "TV & Radio Ads", icon: "📺" },
  { match: /convention|banquet|event|function/, label: "Convention Centers", icon: "🏛️" },
];
function categoryMetaForType(type) {
  const t = (type || '').toLowerCase();
  const meta = CATEGORY_META.find((m) => m.match.test(t));
  if (meta) return meta;
  return { label: t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Locations', icon: '📍' };
}

// Per-catchment map marker: a geometric shape + color so customers can tell
// catchments apart at a glance. Keyed by normalized meta label. Shapes are small
// inline SVGs returned by markerSvg(); on-request (Google) places render the same
// shape but outlined-only (hollow) to signal "not in our network yet".
const CATCHMENT_STYLE = {
  'Apartments':       { shape: 'triangle', color: '#F2701D' },
  'Cafes':            { shape: 'circle',   color: '#7B5E3B' },
  'Restaurants':      { shape: 'circle',   color: '#C2410C' },
  'Parks':            { shape: 'square',   color: '#16A34A' },
  'Malls':            { shape: 'hexagon',  color: '#DB2777' },
  'Supermarkets':     { shape: 'square',   color: '#0D9488' },
  'Schools':          { shape: 'diamond',  color: '#2563EB' },
  'Colleges':         { shape: 'diamond',  color: '#4F46E5' },
  'Cinema Screens':   { shape: 'star',     color: '#DC2626' },
  'Metro Stations':   { shape: 'pentagon', color: '#9333EA' },
  'Corporates':       { shape: 'pentagon', color: '#334155' },
  'TV & Radio Ads':   { shape: 'pentagon', color: '#0891B2' },
  'Hospitals':        { shape: 'cross',    color: '#E11D48' },
  'Convention Centers': { shape: 'hexagon', color: '#D97706' },
  'Hoardings':        { shape: 'star',     color: '#525252' },
  'Vehicle Branding': { shape: 'triangle', color: '#57534E' },
};

// Build the SVG string for a catchment marker shape. `onRequest` renders the
// same shape hollow (outline only) to signal "not in our network yet".
// First arg is the label; second is the fill color (from CATCHMENT_STYLE).
function markerSvg(label, onRequest) {
  const st = CATCHMENT_STYLE[label] || { shape: 'circle', color: '#6B7280' };
  const color = onRequest ? '#B0A89B' : st.color;
  const fill = onRequest ? 'none' : color;
  const stroke = color;
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="2"`;
  const p = (pts) => pts.map(([x, y]) => `${12 + x},${12 + y}`).join(' ');
  let body;
  switch (st.shape) {
    case 'triangle':
      body = `<polygon ${attrs} points="${p([[9,0],[0,-9],[-9,0]])}"/>`;
      break;
    case 'square':
      body = `<rect ${attrs} x="5" y="5" width="14" height="14"/>`;
      break;
    case 'diamond':
      body = `<rect ${attrs} x="6" y="6" width="12" height="12" transform="rotate(45 12 12)"/>`;
      break;
    case 'pentagon':
      body = `<polygon ${attrs} points="${p([[0,-9],[8.5,-2.8],[5.3,7.3],[-5.3,7.3],[-8.5,-2.8]])}"/>`;
      break;
    case 'hexagon':
      body = `<polygon ${attrs} points="${p([[0,-9],[7.8,-4.5],[7.8,4.5],[0,9],[-7.8,4.5],[-7.8,-4.5]])}"/>`;
      break;
    case 'star':
      body = `<polygon ${attrs} points="${p([[0,-9],[1.8,-2.9],[7.8,-2.2],[3.2,1.6],[4.9,7.6],[0,4.5],[-4.9,7.6],[-3.2,1.6],[-7.8,-2.2],[-1.8,-2.9]])}"/>`;
      break;
    case 'cross':
      body = `<rect ${attrs} x="9.6" y="5" width="4.8" height="14"/><rect ${attrs} x="5" y="9.6" width="14" height="4.8"/>`;
      break;
    case 'circle':
    default:
      body = `<circle ${attrs} cx="12" cy="12" r="7"/>`;
  }
  return `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// Return the label(s) that should appear in the map legend, given the visible POIs.
function legendItems(pois) {
  const seen = {};
  pois.forEach((p) => {
    const label = categoryMetaForType(p.type).label;
    if (!seen[label]) seen[label] = { label, hasOnRequest: p.onRequest === true };
    if (p.onRequest === true) seen[label].hasOnRequest = true;
  });
  return Object.values(seen);
}

// Catchment types to ask Google Nearby for (must mirror the `TYPE_TO_GOOGLE`
// keys in server/routes/places.js). These expand the view so the user "sees
// everything around them" even when our sheet has no data for a catchment.
const NEARBY_TYPES = ['apartments', 'corporates', 'cafes', 'supermarkets', 'malls', 'schools', 'colleges', 'cinema', 'parks', 'convention_centers'];

// Map Google's returned place `types` back to our catchment type string.
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

// Format a price as INR (3000 → "₹3,000")
function fmtINR(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

// "cup branding" → "Cup Branding"
function prettyService(svc) {
  return String(svc || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Default center (Bengaluru) */
const DEFAULT_CENTER = [12.9716, 77.5946];

// Friendly singular label per record type group (apartments → "Apartment", cafe → "Cafe")
function getTypeGroupLabel(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('apartment') || t.includes('residential') || t.includes('house')) return 'Apartment';
  if (t.includes('cafe') || t.includes('coffee')) return 'Cafe';
  if (t.includes('restaurant')) return 'Restaurant';
  if (t.includes('school') || t.includes('college') || t.includes('university')) return 'School';
  if (t.includes('hospital') || t.includes('clinic')) return 'Hospital';
  if (t.includes('mall') || t.includes('shop') || t.includes('retail')) return 'Store';
  if (t.includes('office') || t.includes('corporate') || t.includes('company')) return 'Office';
  if (t.includes('park') || t.includes('garden')) return 'Park';
  if (t.includes('hoarding') || t.includes('billboard') || t.includes('ooh')) return 'Hoarding';
  if (t.includes('vehicle')) return 'Vehicle';
  if (t.includes('metro')) return 'Metro';
  if (t.includes('newspaper')) return 'Newspaper';
  if (t.includes('cinema') || t.includes('movie')) return 'Cinema';
  if (t.includes('supermarket') || t.includes('grocery')) return 'Supermarket';
  if (t.includes('tv') || t.includes('radio') || t.includes('studio')) return 'TV & Radio';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Location';
}

// Robust numeric parse — handles 10000, "₹10,000", empty cells (→ 0)
function toNum(v) {
  const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// Normalize a record's services into { "notice board": 3000, … }.
// New multi-tab sheets store a `services` object; older sheets keep the five
// flat promo columns — fold those in so the UI has one consistent shape.
function normalizeServices(d) {
  const services = {};
  if (d.services && typeof d.services === 'object') {
    Object.entries(d.services).forEach(([k, v]) => {
      const key = String(k).toLowerCase().trim();
      if (key) services[key] = toNum(v);
    });
    return services;
  }
  const legacy = {
    'digital promotion': toNum(d.digital_promotion),
    'lift promotion': toNum(d.lift_promotion),
    'stall space': toNum(d.stall_space),
    'digital screen': toNum(d.digital_screen),
    'notice board': toNum(d.notice_board),
  };
  Object.entries(legacy).forEach(([k, v]) => { services[k] = v; });
  return services;
}

// A record matches a chip when:
// 1. Its type is in the chip's rawTypes array (exact, case-insensitive), OR
// 2. The CATEGORY_META regex for the chip's label matches the poi type, OR
// 3. Legacy: Overpass terms / chip id/label substring match
function poiMatchesCategory(poiType, category) {
  if (!category) return false;
  const t = (poiType || '').toLowerCase();
  // 1. Check against all raw type strings that map to this chip
  if (category.rawTypes && category.rawTypes.length > 0) {
    if (category.rawTypes.some((rt) => rt.toLowerCase() === t || t.includes(rt.toLowerCase()) || rt.toLowerCase().includes(t))) {
      return true;
    }
  }
  // 2. CATEGORY_META regex match on the chip's label
  const metaEntry = CATEGORY_META.find((m) => m.label === category.label);
  if (metaEntry && metaEntry.match.test(t)) return true;
  // 3. Legacy fallback
  return (
    (category.overpass || []).some((term) => t === term || t.includes(term)) ||
    t.includes((category.id || '').toLowerCase()) ||
    t.includes(category.label.toLowerCase())
  );
}

export default function MarketingTool() {
  const [query, setQuery] = useState(() => loadSession('mt_query', ''));
  const [searched, setSearched] = useState(() => loadSession('mt_searched', false));
  const [location, setLocation] = useState(() => loadSession('mt_location', null));
  const [coords, setCoords] = useState(() => loadSession('mt_coords', null));
  const [radius, setRadius] = useState(() => loadSession('mt_radius', 10));
  const [pois, setPois] = useState([]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState(() => loadSession('mt_selectedCategories', []));
  const [editingLocation, setEditingLocation] = useState(false);
  const [poiPromotions, setPoiPromotions] = useState(() => loadSession('mt_poiPromotions', {}));
  // Places the user ticked as "wanted" (one checkbox per catchment place)
  const [selectedIds, setSelectedIds] = useState(() => loadSession('mt_selectedIds', []));
  // Per-place service ticks: { [poiId]: { [serviceKey]: true } }. Every priced
  // service starts SELECTED; only explicitly unticked ones are stored.
  const [serviceSelections, setServiceSelections] = useState(() => loadSession('mt_serviceSelections', {}));
  // Sheet records — fetched once, everything else derives from them
  const [rawRecords, setRawRecords] = useState([]);
  // Set when the API server can't be reached (autocomplete/nearby fetches fail).
  // Surfaces a banner instead of failing silently.
  const [apiError, setApiError] = useState(false);
  // Google Places found near the search point that we DON'T have in our sheet —
  // shown visually as "on request" (handled manually), never bookable.
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const resultsInputRef = useRef(null);
  const resultsWrapperRef = useRef(null);
  // True only while the user is hands-on typing in a search field. Used to keep
  // the suggestion dropdown from re-opening right after a suggestion is picked
  // (when query is set programmatically to the full place name).
  const typingRef = useRef(false);
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);

  // Session-only save — so "Back to Search" from checkout restores this view
  useEffect(() => { sessionStorage.setItem('mt_query', JSON.stringify(query)); }, [query]);
  useEffect(() => { sessionStorage.setItem('mt_searched', JSON.stringify(searched)); }, [searched]);
  useEffect(() => { sessionStorage.setItem('mt_location', JSON.stringify(location)); }, [location]);
  useEffect(() => { sessionStorage.setItem('mt_coords', JSON.stringify(coords)); }, [coords]);
  useEffect(() => { sessionStorage.setItem('mt_radius', JSON.stringify(radius)); }, [radius]);
  useEffect(() => { sessionStorage.setItem('mt_selectedCategories', JSON.stringify(selectedCategories)); }, [selectedCategories]);
  useEffect(() => { sessionStorage.setItem('mt_poiPromotions', JSON.stringify(poiPromotions)); }, [poiPromotions]);
  useEffect(() => { sessionStorage.setItem('mt_selectedIds', JSON.stringify(selectedIds)); }, [selectedIds]);
  useEffect(() => { sessionStorage.setItem('mt_serviceSelections', JSON.stringify(serviceSelections)); }, [serviceSelections]);

  // Fetch live suggestions from Google Places (via server proxy) as user types.
  // 6-digit PINs are bypassed (no suggestions needed — they resolve directly).
  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    const isPin = /^[1-9][0-9]{5}$/.test(query.trim());
    if (isPin) { setSuggestions([]); setShowSuggestions(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setApiError(false);
        const names = (data.suggestions || []).map((s) => s.label);
        setSuggestions(names);
        // Only pop the dropdown open for genuine typing — not when query was just
        // set to a picked place name (which would re-open it after selection).
        if (typingRef.current) setShowSuggestions(names.length > 0);
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Server down / API key problem — tell the user instead of failing silently
          setApiError(true);
          setSuggestions([]);
        }
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e) {
      const inside =
        (wrapperRef.current && wrapperRef.current.contains(e.target)) ||
        (resultsWrapperRef.current && resultsWrapperRef.current.contains(e.target));
      if (!inside) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function geocode(place) {
    try {
      const res = await fetch(`/api/places/geocode?input=${encodeURIComponent(place)}`);
      const data = await res.json();
      if (data && data.lat && data.lng) {
        return { lat: data.lat, lng: data.lng };
      }
    } catch {}
    return null;
  }

  async function handleSearch(value) {
    const loc = value || query;
    if (!loc.trim()) return;
    setQuery(loc.trim());
    setLocation(loc.trim());
    setSearched(true);
    setShowSuggestions(false);
    typingRef.current = false;
    // Clear old selections when doing a new search
    setPoiPromotions({});
    sessionStorage.removeItem('btl_checkout_data');
    const c = await geocode(loc.trim());
    if (c) {
      setCoords(c);
      loadNearby(c.lat, c.lng);
    }
  }

  // Fetch real places around the search point (via Google Nearby) so the user
  // "sees everything around them" even for catchments we have no sheet data for.
  async function loadNearby(lat, lng) {
    try {
      const res = await fetch(`/api/places/nearby?lat=${lat}&lng=${lng}&radius=8000&types=${NEARBY_TYPES.join(',')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApiError(false);
      const places = (data.places || []).map((p, i) => ({
        id: `nearby_${i}`,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        type: getTypeFromGoogleTypes(p.types),
        source: 'from google', // external — not in our sheet (yet)
        onRequest: true,       // starts as on-request; becomes selectable once service prices are picked
        distance: getDistanceKm(lat, lng, p.lat, p.lng),
        services: {},
      }));
      setNearbyPlaces(places);
    } catch {
      setApiError(true);
      setNearbyPlaces([]);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleSearch();
  }

  // A POI is "selected" if it's in selectedIds OR if any of its service checkboxes are ticked.
  // Google places (onRequest) ARE selectable — they flow to checkout tagged "from google".
  function isOnRequest(poiId) {
    const poi = pois.find((p) => p.id === poiId);
    return poi ? poi.onRequest === true : false;
  }

  function hasAnyPromotion(poiId) {
    if (selectedIds.includes(poiId)) return true;
    const forPoi = serviceSelections[poiId];
    if (!forPoi) return false;
    return Object.values(forPoi).some((v) => v === true);
  }

  function toggleSelect(poiId) {
    setSelectedIds((prev) => prev.includes(poiId) ? prev.filter((id) => id !== poiId) : [...prev, poiId]);
  }

  // A priced service is NOT ticked unless the user explicitly ticked it
  function isServiceSelected(poiId, svcKey) {
    const forPoi = serviceSelections[poiId];
    return forPoi ? forPoi[svcKey] === true : false;
  }

  function toggleService(poiId, svcKey) {
    setServiceSelections((prev) => {
      const forPoi = { ...(prev[poiId] || {}) };
      forPoi[svcKey] = forPoi[svcKey] === true ? false : true;
      return { ...prev, [poiId]: forPoi };
    });
  }

  // Catchment chips derived from the SHEET TABS (each tab = one catchment), so
  // new tabs appear automatically. Falls back to the static list without data.
  // Types are GROUPED by their normalized label (e.g. "cafe", "Cafe", "cafe services"
  // all become one "Cafes" chip) so clicking one chip shows ALL matching rows.
  const dynamicCategories = useMemo(() => {
    // Sheet types + Google Nearby types, so every catchment visible around the
    // user gets a chip even when our sheet doesn't have that type yet.
    const types = [...new Set([
      ...rawRecords.map((r) => r.type).filter(Boolean),
      ...nearbyPlaces.map((p) => p.type).filter(Boolean),
    ])];
    if (types.length === 0) return categories;
    // Group raw types by normalized label
    const labelMap = {}; // label → { meta, rawTypes[] }
    types.forEach((t) => {
      const meta = categoryMetaForType(t);
      const key = meta.label;
      if (!labelMap[key]) labelMap[key] = { meta, rawTypes: [] };
      labelMap[key].rawTypes.push(t);
    });
    return Object.entries(labelMap).map(([label, { meta, rawTypes }]) => ({
      id: rawTypes[0],        // primary id = first raw type (for sessionStorage compat)
      label: meta.label,
      icon: meta.icon,
      rawTypes,              // ALL raw type strings that map to this chip
    }));
  }, [rawRecords, nearbyPlaces]);

  // NO default catchment — the user picks one explicitly (step-by-step flow).
  // Only prune stale session ids that no longer match any current chip.
  useEffect(() => {
    if (dynamicCategories.length === 0 || selectedCategories.length === 0) return;
    const validIds = new Set(dynamicCategories.map((c) => c.id));
    const stillValid = selectedCategories.filter((id) => validIds.has(id));
    if (stillValid.length !== selectedCategories.length) {
      setSelectedCategories(stillValid);
    }
  }, [dynamicCategories]);

  // After the user picks a catchment, bring the results list into view so the
  // flow reads top-to-bottom: search → radius → catchments → list.
  const resultsRef = useRef(null);
  useEffect(() => {
    if (selectedCategories.length > 0 && searched) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedCategories, searched]);

  // Service columns for the table — union of services from ONLY the currently
  // selected catchment types. This means Cafes show cafe services, Apartments
  // show apartment services, etc. Recomputed whenever selection changes.
  const serviceColumns = useMemo(() => {
    const cols = [];
    const seen = new Set();
    // Build a set of matching poi ids for selected categories
    const matchingTypes = new Set();
    pois.forEach((poi) => {
      const matches = selectedCategories.some((catId) => {
        const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
        return poiMatchesCategory(poi.type, category);
      });
      if (matches) matchingTypes.add(poi.type);
    });
    // Collect service columns only from records of the matching types
    rawRecords.forEach((r) => {
      if (!matchingTypes.has(r.type)) return;
      Object.keys(r.services || {}).forEach((k) => {
        const key = String(k).toLowerCase().trim();
        if (key && !seen.has(key)) { seen.add(key); cols.push(key); }
      });
    });
    // Fallback: if nothing matched, show all columns
    if (cols.length === 0) {
      rawRecords.forEach((r) => {
        Object.keys(r.services || {}).forEach((k) => {
          const key = String(k).toLowerCase().trim();
          if (key && !seen.has(key)) { seen.add(key); cols.push(key); }
        });
      });
    }
    return cols;
  }, [rawRecords, selectedCategories, pois, dynamicCategories]);

  // Get category label from POI type
  function getCategoryLabel(poiType) {
    const found = categories.find(c => poiMatchesCategory(poiType, c));
    return found ? found.label : poiType;
  }

  function downloadExcel(data) {
    if (!data.length) return;
    const headers = ["Name", "Type", "Distance (km)", "Latitude", "Longitude"];
    const rows = data.map((p) => {
      const dist = p.sheetDistance > 0 ? p.sheetDistance : (coords ? getDistanceKm(coords.lat, coords.lng, p.lat, p.lng).toFixed(2) : '-');
      return [p.name || p.fullName, p.type, dist, p.lat.toFixed(6), p.lng.toFixed(6)];
    });
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `locations_${location || "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleDetectLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocation(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
        setSearched(true);
        loadNearby(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        handleSearch("Bengaluru");
      }
    );
  }

  function handleReset() {
    ['mt_query', 'mt_searched', 'mt_location', 'mt_coords', 'mt_radius', 'mt_selectedCategories', 'mt_poiPromotions', 'mt_selectedIds', 'mt_serviceSelections'].forEach((k) => sessionStorage.removeItem(k));
    setSearched(false);
    setLocation(null);
    setCoords(null);
    setQuery("");
    setRadius(10);
    setPois([]);
    setNearbyPlaces([]);
    setSelectedCategories([]);
    setSelectedIds([]);
    setServiceSelections({});
    setShowSuggestions(false);
    typingRef.current = false;
    if (leafletMap.current) {
      leafletMap.current.remove();
      leafletMap.current = null;
      markersRef.current = [];
    }
  }

  // Haversine distance formula
  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ---- Location data ----
  // (rawRecords state is declared with the other hooks at the top)

  useEffect(() => {
    let cancelled = false;
    setLoadingPois(true);

    async function loadLocations() {
      try {
        // Fetch Drive records from the API
        const filesRes = await fetch('/api/admin/google-drive/files');
        const filesData = await filesRes.json();
        const all = [];

        for (const file of (filesData.files || [])) {
          if (file.records_count > 0) {
            try {
              const dataRes = await fetch(`/api/admin/google-drive/data/${file.id}?limit=1000`);
              const dataResult = await dataRes.json();
              for (const record of (dataResult.records || [])) {
                const d = record.data || record;
                // Skip junk rows from the sheet (empty name / stray rows) — they have no
                // name and no prices, so they only pollute the list
                if (!String(d.name ?? '').trim()) continue;
                // Skip rows the sync deactivated (removed from the sheet)
                if (d.is_active === false) continue;
                all.push({
                  id: record.id,
                  name: d.name || `Record ${record.id}`,
                  fullName: d.name || `Record ${record.id}`,
                  // Pin code from the sheet's "Pin Code" column (when the sheet has one)
                  pinCode: String(d.pin_code ?? d.pincode ?? d.pin ?? '').replace(/\s+/g, ''),
                  // Distance straight from the sheet's Distance column (km) —
                  // 0 when the sheet has no Distance column (computed per search instead)
                  sheetDistance: toNum(d.distance_km),
                  type: (d.type || file.file_type || 'other').toLowerCase(),
                  slNo: String(d.sl_no ?? '').trim(),
                  lat: parseFloat(d.lat) || 0,
                  lng: parseFloat(d.lng) || 0,
                  // Dynamic catchment services from the sheet tab: { "notice board": 3000, … }
                  services: normalizeServices(d),
                  // Legacy flat promo fields (older single-tab sheets)
                  digital_promotion: toNum(d.digital_promotion),
                  lift_promotion: toNum(d.lift_promotion),
                  stall_space: toNum(d.stall_space),
                  digital_screen: toNum(d.digital_screen),
                  notice_board: toNum(d.notice_board),
                });
              }
            } catch (e) { /* skip file */ }
          }
        }

        if (!cancelled) setRawRecords(all);
      } catch (err) {
        // API not available — show empty
        if (!cancelled) setRawRecords([]);
      }
    }

    loadLocations();
    return () => { cancelled = true; };
  }, []);

  // Derive the visible POI list for the current search:
  // 1) The searched pincode/location gives a nominal point (coords).
  // 2) Every catchment place's distance is computed from that point.
  // 3) Places are SORTED by distance — the closest catchment comes first.
  // 4) Records with real coordinates respect the coverage radius slider;
  //    un-located records (geocode failed) are scattered near the center so
  //    the map stays useful, and always appear last in the table.
  useEffect(() => {
    // Nothing searched yet (initial mount / after reset) → empty list
    if (!location && !coords) {
      setPois([]);
      setLoadingPois(false);
      return;
    }

    // The same sheet can be synced into multiple files — dedupe by type+name (latest wins)
    const unique = new Map();
    rawRecords.forEach((r) => {
      const lat = r.lat, lng = r.lng;
      const hasCoords = lat !== 0 || lng !== 0;
      if (!hasCoords) return;
      let dist = 0;
      if (coords) {
        dist = getDistanceKm(coords.lat, coords.lng, lat, lng);
        if (dist > radius) return;
      }
      const key = `${r.type}|${r.fullName.toLowerCase().trim()}`;
      unique.set(key, { ...r, lat, lng, distance: dist, hasRealCoords: true });
    });
    const deduped = [...unique.values()];

    // Add Google Nearby places (not in our sheet) within the search radius so
    // the user sees EVERYTHING around them. Tagged onRequest → shown visually,
    // never bookable. Skip any place already covered by our sheet data (name match).
    const knownNames = new Set(deduped.map((p) => p.fullName.toLowerCase().trim()));
    const merged = [...deduped];
    nearbyPlaces.forEach((np) => {
      if (np.distance > radius) return;
      if (knownNames.has(np.name.toLowerCase().trim())) return;
      merged.push(np);
    });

    // Shortest distance first
    merged.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return String(a.name).localeCompare(String(b.name));
    });

    setPois(merged);
    setLoadingPois(false);
  }, [rawRecords, coords, radius, location, nearbyPlaces]);

  // Initialize and update vanilla Leaflet map
  useEffect(() => {
    if (!coords || !mapRef.current) return;

    // Create map if it doesn't exist
    if (!leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        center: [coords.lat, coords.lng],
        zoom: radius <= 5 ? 13 : radius <= 15 ? 11 : 9,
        scrollWheelZoom: false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(leafletMap.current);
    }

    const map = leafletMap.current;
    map.setView([coords.lat, coords.lng], radius <= 5 ? 13 : radius <= 15 ? 11 : 9, { animate: true });

    // Clear old markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    // Center marker
    const centerIcon = L.divIcon({
      className: "mt-marker",
      html: '<div class="mt-marker-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const centerMarker = L.marker([coords.lat, coords.lng], { icon: centerIcon }).addTo(map);
    centerMarker.bindPopup(`<div class="mt-poi-popup"><strong>${location || "Location"}</strong><span>center</span></div>`);
    markersRef.current.push(centerMarker);

    // Radius circle
    const circle = L.circle([coords.lat, coords.lng], {
      radius: radius * 1000,
      color: "#F2701D",
      fillColor: "#F2701D",
      fillOpacity: 0.1,
      weight: 2,
    }).addTo(map);
    markersRef.current.push(circle);

    // Show all POIs (from our sheet + Google Nearby) unless the user has picked
    // specific catchment chips — then only those.
    const filteredPois = selectedCategories.length === 0
      ? pois
      : pois.filter((poi) => {
          return selectedCategories.some((catId) => {
            const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
            return poiMatchesCategory(poi.type, category);
          });
        });

    // POI markers — one geometric shape per catchment, hollow for on-request
    filteredPois.forEach((poi) => {
      const onRequest = poi.onRequest === true;
      const svg = markerSvg(categoryMetaForType(poi.type).label, onRequest);
      const poiIcon = L.divIcon({
        className: "mt-poi-marker",
        html: '<div class="mt-poi-shape"' + (onRequest ? ' style="opacity:.85"' : '') + ' title="' + (poi.name || '') + '">' + svg + '</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const poiMarker = L.marker([poi.lat, poi.lng], { icon: poiIcon }).addTo(map);
      poiMarker.bindPopup(
        '<div class="mt-poi-popup"><strong>' + (poi.name || poi.fullName) + '</strong><span>' + poi.type + (onRequest ? ' · On Request' : '') + '</span></div>'
      );
      markersRef.current.push(poiMarker);
    });

    // Fit bounds to show all filtered POIs if any
    if (filteredPois.length > 0) {
      const bounds = L.latLngBounds([[coords.lat, coords.lng]]);
      filteredPois.forEach((p) => bounds.extend([p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [coords, radius, pois, location, selectedCategories, dynamicCategories]);

  return (
    <>
      <style>{CSS}</style>
      <section className="mt-section">
        <div className="mt-container">
          {/* API server unreachable — autocomplete/nearby can't work */}
          {apiError && (
            <div className="mt-api-error">
              ⚠ Can't reach the BTLbro API (localhost:3001). Autocomplete and live map data are off — start the server (`cd server && npm run dev`) and refresh.
            </div>
          )}
          {/* Header */}
          <div className="mt-header">
            <span className="mt-badge">Marketing Tool</span>
            <h1 className="mt-title">
              Find your <span className="mt-accent">target zone</span>
            </h1>
            <p className="mt-subtitle">
              Search any pin code or location to discover activation opportunities
              within your chosen radius.
            </p>
          </div>

          {/* Search card */}
          <div className="mt-card">
            {!searched ? (
              /* ---- Search state ---- */
              <div className="mt-search">
                <div className="mt-input-wrap" ref={wrapperRef} style={{width:'100%', display:'block'}}>
                  <div className="mt-input-row">
                    <Search size={18} className="mt-input-icon" color="#949494" />
                    <input
                      ref={inputRef}
                      type="text"
                      className="mt-input"
                      placeholder="Search pin code, city, or location..."
                      value={query}
                      autoFocus
                      onChange={(e) => { typingRef.current = true; setQuery(e.target.value); }}
                      onKeyDown={handleKeyDown}
                      onFocus={() => typingRef.current && query.length > 0 && suggestions.length > 0 && setShowSuggestions(true)}
                    />
                    {query && (
                      <button className="mt-input-clear" onClick={handleReset} title="Clear search">
                        ✕
                      </button>
                    )}
                    <button className="mt-input-detect-btn" onClick={handleDetectLocation}>
                      <Locate size={14} />
                    </button>
                    <button className="mt-input-search-btn" onClick={() => handleSearch()}>
                      Search Location
                    </button>
                  </div>

                  {showSuggestions && (
                    <div className="mt-suggestions">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          className="mt-suggestion"
                          onClick={() => { setQuery(s); handleSearch(s); }}
                        >
                          <MapPin size={14} color="#F2701D" />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>





              </div>
            ) : (
              /* ---- Results state ---- */
              <div className="mt-results">
                <div className="mt-results-top">
                  <div className="mt-input-wrap" ref={resultsWrapperRef} style={{width:'100%', display:'block'}}>
                    <div className="mt-input-row">
                      <Search size={18} className="mt-input-icon" color="#949494" />
                      <input
                        ref={resultsInputRef}
                        type="text"
                        className="mt-input"
                        placeholder="Search pin code, city, or location..."
                        value={editingLocation ? query : (location || '')}
                        onChange={(e) => { typingRef.current = true; setEditingLocation(true); setQuery(e.target.value); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            typingRef.current = false;
                            const val = query.trim();
                            if (val) { setEditingLocation(false); handleSearch(val); }
                          }
                        }}
                        onFocus={() => {
                          // Show the typed text while editing; do NOT re-seed from
                          // `location` — that re-fills cleared text (2-click-delete bug)
                          setEditingLocation(true);
                          if (typingRef.current && query.length >= 2) setShowSuggestions(true);
                        }}
                      />
                      {(query || location) && (
                        <button className="mt-input-clear" onClick={handleReset} title="Clear search">✕</button>
                      )}
                      <button className="mt-input-detect-btn" onClick={handleDetectLocation}><Locate size={14} /></button>
                      <button className="mt-input-search-btn" onClick={() => {
                        typingRef.current = false;
                        const val = query.trim();
                        if (val) { setEditingLocation(false); handleSearch(val); }
                      }}>Search Location</button>
                    </div>

                    {showSuggestions && (
                      <div className="mt-suggestions">
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            className="mt-suggestion"
                            onClick={() => { typingRef.current = false; setEditingLocation(false); setQuery(s); handleSearch(s); }}
                          >
                            <MapPin size={14} color="#F2701D" />
                            {s}
                          </button>
                        ))}
                      </div>
                    )}

                  </div>
                
                </div>

                {/* Radius slider */}
                <div className="mt-radius-section">
                  <div className="mt-radius-header">
                    <label className="mt-radius-label">Coverage Radius</label>
                    <span className="mt-radius-value">{radius} km</span>
                  </div>
                  <div className="mt-slider-wrap">
                    <span className="mt-slider-min">1 km</span>
                    <input
                      type="range"
                      className="mt-slider"
                      min={1}
                      max={10}
                      step={1}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      style={{ '--val': radius }}
                    />
                    <span className="mt-slider-max">10 km</span>
                  </div>
                  <div className="mt-radius-presets">
                    {[2, 5, 10].map((r) => (
                      <button
                        key={r}
                        className={`mt-preset ${radius === r ? "mt-preset-active" : ""}`}
                        onClick={() => setRadius(r)}
                      >
                        {r} km
                      </button>
                    ))}
                  </div>


                </div>

                {/* Map visualization */}
                {coords && (
                  <div className="mt-map-wrap">
                    {loadingPois && (
                      <div className="mt-map-loading">
                        <div className="mt-map-spinner" /> Loading landmarks...
                      </div>
                    )}
                    <div ref={mapRef} className="mt-map" />
                    {legendItems(pois).length > 0 && (
                      <div className="mt-legend">
                        {legendItems(pois).map((it) => (
                          <div key={it.label} className="mt-legend-item">
                            <span
                              className="mt-legend-swatch"
                              dangerouslySetInnerHTML={{ __html: markerSvg(it.label, it.hasOnRequest) }}
                            />
                            <span className="mt-legend-label">{it.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Catchment picker — "Target" label on its own row (row 1),
                    big tappable cards on row 2. Nothing pre-selected. */}
                <div className="mt-categories">
                  <div className="mt-categories-head">
                    <span className="mt-popular-label">Target</span>
                    <span className="mt-categories-hint">
                      {selectedCategories.length === 0
                        ? "— pick a catchment to see locations on the map"
                        : "— tap again to clear"}
                    </span>
                  </div>
                  <div className="mt-cats-list">
                    {dynamicCategories.map((cat) => (
                      <button
                        key={cat.id}
                        className={`mt-cat-chip ${selectedCategories.includes(cat.id) ? "mt-cat-active" : ""}`}
                        onClick={() => {
                          const isActive = selectedCategories.includes(cat.id) && selectedCategories.length === 1;
                          if (isActive) {
                            setSelectedCategories([]);
                            setSelectedIds([]);
                            return;
                          }
                          // Switch to this chip — keep existing selections intact
                          setSelectedCategories([cat.id]);
                          setSelectedIds([]);
                        }}
                      >
                        <span className="mt-cat-icon">{cat.icon}</span>
                        <span className="mt-cat-label">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </div>



                {/* Step prompt + results list — scrolled into view on catchment pick */}
                <div ref={resultsRef}>
                  {selectedCategories.length === 0 && (
                    <div className="mt-step-note">
                      👆 Select a catchment above to see matching locations on the map and in the list.
                    </div>
                  )}
                </div>

                {/* Empty state — nothing in the sheet yet */}
                {searched && !loadingPois && pois.length === 0 && (
                  <div className="mt-empty-note">
                    No catchment locations found yet. Add places to the Google Sheet
                    (one tab per catchment) and sync from the Admin Panel.
                  </div>
                )}

                {/* POI Table with checkboxes */}
                {pois.length > 0 && selectedCategories.length > 0 && (() => {
                  const filtered = pois.filter((poi) => {
                    return selectedCategories.some((catId) => {
                      const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
                      return poiMatchesCategory(poi.type, category);
                    });
                  });
                  if (filtered.length === 0) return null;
                  // Count selections across ALL pois (not just current chip) so
                  // apartment + cafe selections both show in the total
                  const selectedPoisList = pois.filter((p) => hasAnyPromotion(p.id));
                  const selectedCount = selectedPoisList.length;
                  return (
                    <div className="mt-poi-table">
                      <div className="mt-poi-table-header">
                        <span className="mt-poi-table-title">Locations Found ({filtered.length}){selectedCount > 0 ? ` • ${selectedCount} selected` : ''}</span>
                        <div className="mt-poi-table-actions">
                          <button className="mt-excel-btn" onClick={() => downloadExcel(selectedCount > 0 ? selectedPoisList : filtered)}>
                            📥 Download Excel
                          </button>

                        </div>
                      </div>
                      <div className="mt-poi-table-scroll">
                        <table className="mt-poi-table-el">
                          <thead>
                            <tr>
                              <th className="mt-th-sl">#</th>
                              <th className="mt-th-name">Name</th>
                              <th className="mt-th-type">Catchment</th>
                              <th className="mt-th-dist">Distance</th>
                              {serviceColumns.map((svc) => (
                                <th key={svc} className="mt-th-promo" title={prettyService(svc)}>{prettyService(svc)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((poi, idx) => {
                              const isSelected = hasAnyPromotion(poi.id);
                              const onRequest = poi.onRequest === true;
                              const isGoogle = poi.source === 'from google';
                              return (
                              <tr
                                key={poi.id}
                                className={isSelected ? 'mt-tr-active mt-tr-clickable' : 'mt-tr-clickable'}
                                onClick={(e) => {
                                  if (e.target.type === 'checkbox') return;
                                  toggleSelect(poi.id);
                                }}
                              >
                                <td className="mt-td-sl">
                                  <span className="mt-row-check">{idx + 1}</span>
                                </td>
                                <td className="mt-td-name" title={poi.name}>
                                  {poi.name}
                                  {isGoogle && <span className="mt-src-badge mt-src-google">From Google</span>}
                                  {onRequest && <span className="mt-onrequest-badge">On Request</span>}
                                </td>
                                <td><span className="mt-td-type">{getCategoryLabel(poi.type)}</span></td>
                                <td className="mt-td-dist">
                                  {poi.sheetDistance > 0
                                    ? `${poi.sheetDistance} km`
                                    : coords
                                      ? `${poi.distance.toFixed(2)} km`
                                      : '-'}
                                </td>
                                {serviceColumns.map((svc) => {
                                  const price = (poi.services && poi.services[svc]) || 0;
                                  const picked = isServiceSelected(poi.id, svc);
                                  return (
                                    <td key={svc} className="mt-td-promo">
                                      {onRequest ? (
                                        // Google place, no sheet price yet — selectable as
                                        // "from google"; the agency prices it from the backfilled sheet row
                                        <label className="mt-svc-pick" title="Not priced yet — request handled manually">
                                          <input
                                            type="checkbox"
                                            className="mt-svc-checkbox"
                                            checked={picked}
                                            onChange={() => toggleService(poi.id, svc)}
                                          />
                                        </label>
                                      ) : price > 0 ? (
                                        <label className="mt-svc-pick" title={`${prettyService(svc)}: ${fmtINR(price)} / month`}>
                                          <input
                                            type="checkbox"
                                            className="mt-svc-checkbox"
                                            checked={picked}
                                            onChange={() => {
                                              toggleService(poi.id, svc);
                                            }}
                                          />
                                        </label>
                                      ) : (
                                        <span className="mt-svc-none" title={`${prettyService(svc)}: price not set`}>-</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );})}
                          </tbody>
                        </table>
                      </div>
                    {selectedCount > 0 && (
                      <div className="mt-table-cta-row">
                        <a href="/customize" className="mt-customize-btn">
                          Customize Campaign
                        </a>
                        <a href={`/checkout?count=${selectedCount}&categories=${[...new Set(selectedPoisList.map(p => getCategoryLabel(p.type)))].join(',')}`} className="mt-continue-btn" onClick={() => {
                          const selectedData = selectedPoisList.map(p => ({
                            ...p,
                            promotions: {},
                            // Per-service ticks from the table — checkout starts
                            // with exactly what the user picked here
                            serviceSelections: serviceSelections[p.id] || null,
                            // 'inhouse' (sheet row) or 'from google' (Nearby place) —
                            // carried through checkout into the order + sheet backfill
                            source: p.source === 'from google' ? 'from google' : 'inhouse',
                            selected: true,
                          }));
                          sessionStorage.setItem('btl_checkout_data', JSON.stringify(selectedData));
                          sessionStorage.setItem('btl_checkout_pincode', query || location || '');
                        }}>
                          Continue with {selectedCount} location{selectedCount > 1 ? "s" : ""}
                        </a>
                      </div>
                    )}
                    </div>
                  );
                })()}


              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

const CSS = `
.mt-section {
  width: 100%;
  background: #FFFFFF;
  padding: 48px 40px 64px;
}
.mt-step-note {
  margin-top: 18px;
  padding: 14px 18px;
  border: 1px dashed #E7E2D8;
  border-radius: 10px;
  background: #FAF9F7;
  font-size: 13.5px;
  color: #656565;
  font-family: 'Inter', sans-serif;
}
.mt-api-error {
  max-width: 1024px;
  margin: 0 auto 18px;
  padding: 10px 16px;
  border: 1px solid #F2C94C;
  background: #FFF8E6;
  color: #8A6D1A;
  border-radius: 10px;
  font-size: 13.5px;
  font-family: 'Inter', sans-serif;
  line-height: 1.5;
}
@media (max-width: 640px) { .mt-section { padding: 36px 18px 48px; } }

.mt-container {
  max-width: 1024px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Header ---- */
.mt-header { text-align: center; margin-bottom: 24px; }
.mt-badge {
  display: inline-block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #F2701D;
  background: rgba(242,112,29,0.08);
  padding: 6px 14px;
  border-radius: 20px;
  margin-bottom: 10px;
}
.mt-title {
  font-family: 'Manrope', sans-serif;
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #161616;
  line-height: 1.15;
  margin: 0;
}
@media (max-width: 640px) { .mt-title { font-size: 28px; } }
.mt-accent { color: #F2701D; }
.mt-header .mt-subtitle {
  font-size: 16px;
  color: #656565;
  margin-top: 8px;
  line-height: 1.6;
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
  text-align: center;
}

/* ---- Card ---- */
.mt-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  width: 100%;
  display: block;
  text-align: left;
}
@media (max-width: 640px) { .mt-card { padding: 0; } }

/* ---- Search ---- */
.mt-search { display: flex; flex-direction: column; gap: 20px; width: 100%; text-align: left; }

.mt-input-wrap { position: relative; width: 100%; z-index: 200; }
.mt-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1.5px solid #E7E2D8;
  border-radius: 999px;
  padding: 6px 6px 6px 22px;
  background: #FAF9F7;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  width: 100%;
  box-sizing: border-box;
}
.mt-input-row:focus-within {
  border-color: #F2701D;
  box-shadow: 0 0 0 3px rgba(242,112,29,0.1);
  background: #fff;
}
.mt-input-icon { flex-shrink: 0; }
.mt-input {
  flex: 1;
  border: none;
  background: none;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  color: #161616;
  outline: none;
}
.mt-input::placeholder { color: #B8AFA6; }
.mt-card .mt-input-clear {
  width: 24px; height: 24px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #949494;
  background: #E7E2D8;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.mt-card .mt-input-clear:hover { background: #D0C8BC; }

/* ---- Search button inside input row ---- */
.mt-input-row .mt-input-search-btn {
  flex-shrink: 0;
  padding: 12px 26px;
  background: #F2701D !important;
  color: #fff !important;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  border: none !important;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease;
  white-space: nowrap;
  position: relative;
  z-index: 1;
}
.mt-input-row .mt-input-search-btn:hover { background: #D8620F !important; }

/* ---- Show Map button ---- */


/* ---- Detect button inside input row ---- */
.mt-input-row .mt-input-detect-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #E7E2D8;
  color: #656565;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mt-input-row .mt-input-detect-btn:hover { background: #D0C8BC; color: #161616; }

/* ---- Suggestions ---- */
.mt-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  background: #fff;
  border: 1px solid #E7E2D8;
  border-radius: 14px;
  padding: 4px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.08);
  z-index: 10;
}
.mt-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  color: #161616;
  border-radius: 6px;
  text-align: left;
  transition: background 0.12s ease;
}
.mt-suggestion:hover { background: #FBF3EA; }

/* ---- Actions ---- */
.mt-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.mt-card .mt-btn-primary,
.mt-search .mt-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 24px;
  background: #F2701D;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14.5px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mt-card .mt-btn-primary:hover,
.mt-search .mt-btn-primary:hover { background: #D8620F; }
.mt-card .mt-btn-ghost,
.mt-search .mt-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 13px 20px;
  background: none;
  border: 1.5px solid #D8D2C6;
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: #161616;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.mt-card .mt-btn-ghost:hover,
.mt-search .mt-btn-ghost:hover { border-color: #161616; }

/* ---- Popular chips ---- */
.mt-popular {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mt-popular-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #949494;
}
.mt-card .mt-chip,
.mt-search .mt-chip {
  padding: 6px 14px;
  border: 1px solid #E7E2D8;
  border-radius: 20px;
  font-size: 12.5px;
  font-weight: 500;
  color: #656565;
  background: none;
  transition: all 0.15s ease;
}
.mt-card .mt-chip:hover,
.mt-search .mt-chip:hover { border-color: #F2701D; color: #F2701D; }

/* ---- Categories ---- */
.mt-categories {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Inter', sans-serif;
}
.mt-categories-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.mt-categories-hint {
  font-size: 12.5px;
  color: #949494;
}
.mt-cats-list {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.mt-cat-label {
  font-size: 13px;
  font-weight: 600;
  color: #4A4A4A;
  text-align: center;
  line-height: 1.2;
}
.mt-cat-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 12px;
  border: 1.5px solid #E7E2D8;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  color: #4A4A4A;
  background: #FFFFFF;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  width: 132px;
  min-height: 132px;
}
.mt-cat-chip:hover {
  border-color: #F2701D;
  color: #F2701D;
  box-shadow: 0 4px 14px rgba(242,112,29,0.15);
  transform: translateY(-2px);
}
.mt-cat-icon {
  font-size: 40px;
  line-height: 1;
}
@media (max-width: 640px) {
  .mt-cat-chip { width: calc(50% - 7px); min-height: 110px; }
  .mt-cat-icon { font-size: 32px; }
}
.mt-cat-active {
  background: #F2701D;
  color: #fff;
  border-color: #F2701D;
  box-shadow: 0 4px 16px rgba(242,112,29,0.35);
  transform: translateY(-2px);
}
.mt-cat-active:hover {
  background: #D8620F;
  border-color: #D8620F;
  color: #fff;
}
.mt-empty-note {
  padding: 14px 18px;
  border: 1px dashed #E7E2D8;
  border-radius: 12px;
  font-size: 13px;
  color: #949494;
  background: #FAF8F4;
  text-align: center;
}
.mt-empty-note strong { color: #4A4A4A; }

/* ---- Results ---- */
.mt-results { display: flex; flex-direction: column; gap: 32px; }

.mt-results-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.mt-location-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #161616;
}
.mt-location-editable {
  cursor: pointer;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1.5px solid transparent;
  transition: all 0.15s ease;
  gap: 10px;
}
.mt-location-editable:hover {
  border-color: #F2701D;
  background: #FFF4EC;
}
.mt-edit-hint {
  font-size: 14px;
  color: #F2701D;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.mt-location-editable:hover .mt-edit-hint {
  opacity: 1;
}
.mt-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 2px solid #F2701D;
  border-radius: 10px;
  padding: 6px 6px 6px 14px;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(242,112,29,0.1);
}
.mt-edit-input {
  flex: 1;
  border: none;
  background: none;
  font-family: 'Manrope', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #161616;
  outline: none;
  min-width: 120px;
}
.mt-edit-clear {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #949494;
  background: #E7E2D8;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mt-edit-clear:hover { background: #D0C8BC; }
.mt-edit-go {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F2701D;
  color: #fff;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mt-edit-go:hover { background: #D8620F; }

/* ---- Radius slider ---- */
.mt-radius-section { display: flex; flex-direction: column; gap: 14px; }
.mt-radius-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mt-radius-label {
  font-weight: 700;
  font-size: 15px;
  color: #161616;
}
.mt-radius-value {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 22px;
  font-weight: 600;
  color: #F2701D;
}

.mt-slider-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
}
.mt-slider-min, .mt-slider-max {
  font-size: 12px;
  color: #949494;
  white-space: nowrap;
}
.mt-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, #F2701D 0%, #F2701D calc(((var(--val, 5) - 1) / 9) * 100%), #E7E2D8 calc(((var(--val, 5) - 1) / 9) * 100%), #E7E2D8 100%);
  outline: none;
}
.mt-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #F2701D;
  border: 3px solid #fff;
  box-shadow: 0 2px 8px rgba(242,112,29,0.35);
  cursor: pointer;
}
.mt-slider::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #F2701D;
  border: 3px solid #fff;
  box-shadow: 0 2px 8px rgba(242,112,29,0.35);
  cursor: pointer;
}

.mt-radius-presets {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.mt-card .mt-preset {
  padding: 7px 16px;
  border: 1px solid #E7E2D8;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #656565;
  background: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mt-card .mt-preset:hover { border-color: #F2701D; color: #F2701D; }
.mt-card .mt-preset-active {
  background: #F2701D;
  border-color: #F2701D;
  color: #fff;
}

/* ---- POI Table ---- */
.mt-poi-table {
  border: 1px solid #E7E2D8;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.mt-poi-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: #FAF9F7;
  border-bottom: 1px solid #E7E2D8;
}
.mt-poi-table-title {
  font-weight: 700;
  font-size: 14px;
  color: #161616;
}
.mt-poi-table-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mt-excel-btn {
  padding: 7px 14px;
  background: #F2701D;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mt-excel-btn:hover { background: #D8620F; }

/* ---- Continue button ---- */
.mt-table-cta-row {
  display: flex;
  gap: 12px;
  padding: 16px 18px;
  border-top: 1px solid #E7E2D8;
  background: #FAF9F7;
  border-radius: 0 0 12px 12px;
  flex-wrap: wrap;
}
.mt-continue-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 14px 24px;
  background: #F2701D;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14.5px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
  transition: background 0.15s ease;
}
.mt-continue-btn:hover { background: #D8620F; }
.mt-customize-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 14px 24px;
  background: #fff;
  color: #161616;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14.5px;
  border: 1.5px solid #D8D2C6;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
  transition: border-color 0.15s ease;
}
.mt-customize-btn:hover { border-color: #161616; }
.mt-poi-table-scroll {
  max-height: 280px;
  overflow-y: auto;
}
.mt-poi-table-el {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mt-poi-table-el thead {
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 1;
}
.mt-poi-table-el th {
  text-align: left;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #949494;
  border-bottom: 1px solid #E7E2D8;
}
.mt-poi-table-el td {
  padding: 10px 14px;
  border-bottom: 1px solid #F0EDE8;
  color: #4A4A4A;
}
.mt-poi-table-el tr:last-child td { border-bottom: none; }
.mt-poi-table-el tr:hover { background: #FBF8F4; }
.mt-poi-table-el .mt-tr-active { background: #FFF4EC; }

.mt-td-name { font-weight: 500; color: #161616; }
.mt-td-type {
  display: inline-block;
  padding: 3px 10px;
  background: #F5F0EA;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: #656565;
  text-transform: capitalize;
}
.mt-th-dist {
  text-align: right !important;
}
.mt-td-dist {
  text-align: right;
  font-weight: 500;
  color: #161616;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12.5px;
}
.mt-th-promo {
  text-align: center !important;
  font-size: 10px !important;
  min-width: 80px;
  white-space: nowrap;
}
.mt-td-promo {
  text-align: center;
}
.mt-td-promo input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  border: 2px solid #D8D2C6;
  border-radius: 6px;
  background: #fff;
  position: relative;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.mt-td-promo input[type="checkbox"]:checked {
  background: #F2701D;
  border-color: #F2701D;
}
.mt-td-promo input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  display: block;
  top: 3px;
  left: 6px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg);
}
.mt-td-promo input[type="checkbox"]:hover {
  border-color: #F2701D;
}

.mt-tr-clickable {
  cursor: pointer;
}
.mt-tr-clickable:hover { background: #FBF8F4; }
.mt-tr-active.mt-tr-clickable:hover { background: #FFE8D6; }

/* Google Places row we don't have in our network — shown as info, not bookable */
.mt-tr-onrequest { background: #F7F7F5; opacity: 0.85; cursor: default; }
.mt-tr-onrequest:hover { background: #F0EFEC; }
.mt-src-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  vertical-align: middle;
}
.mt-src-google { background: #FEF3C7; color: #B45309; }
.mt-src-inhouse { background: #DCFCE7; color: #15803D; }
.mt-onrequest-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #E7E2D8;
  color: #656565;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  vertical-align: middle;
}

/* Row number / checkmark indicator */
.mt-row-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid #D8D2C6;
  font-size: 11px;
  font-weight: 700;
  color: #949494;
  background: #fff;
  font-family: 'IBM Plex Mono', monospace;
  transition: all 0.15s ease;
}
.mt-row-check-on {
  background: #F2701D;
  border-color: #F2701D;
  color: #fff;
  font-size: 13px;
}

/* ---- Select column + service tick marks ---- */
.mt-th-select { text-align: center !important; width: 52px; }
.mt-td-select { text-align: center; }
.mt-th-sl { width: 36px; }
.mt-td-sl {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  color: #949494;
}
.mt-select-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  border: 2px solid #D8D2C6;
  border-radius: 6px;
  background: #fff;
  position: relative;
  cursor: pointer;
  transition: all 0.15s ease;
  vertical-align: middle;
}
.mt-select-checkbox:checked {
  background: #F2701D;
  border-color: #F2701D;
}
.mt-select-checkbox:checked::after {
  content: '';
  position: absolute;
  display: block;
  top: 3px;
  left: 6px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg);
}
.mt-select-checkbox:hover { border-color: #F2701D; }
/* Selectable service cell: checkbox (pre-selected) + price */
.mt-svc-pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.mt-svc-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid #D8D2C6;
  border-radius: 6px;
  background: #fff;
  position: relative;
  cursor: pointer;
  transition: all 0.15s ease;
  margin: 0;
  flex-shrink: 0;
}
.mt-svc-checkbox:checked {
  background: #F2701D;
  border-color: #F2701D;
}
.mt-svc-checkbox:checked::after {
  content: '';
  position: absolute;
  display: block;
  top: 2px;
  left: 5px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg);
}
.mt-svc-checkbox:hover { border-color: #F2701D; }
.mt-svc-price {
  font-size: 10.5px;
  font-weight: 600;
  color: #161616;
  white-space: nowrap;
  font-family: 'IBM Plex Mono', monospace;
}
.mt-svc-none {
  color: #949494;
  font-size: 13px;
  font-weight: 600;
}

/* ---- Coverage summary ---- */
.mt-coverage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  background: #FAF9F7;
  border: 1px solid #E7E2D8;
  border-radius: 12px;
  padding: 24px 20px;
}
@media (max-width: 560px) { .mt-coverage { flex-direction: column; gap: 20px; } }
.mt-coverage-item { flex: 1; text-align: center; }
.mt-coverage-num {
  font-family: 'Manrope', sans-serif;
  font-weight: 800;
  font-size: 20px;
  color: #161616;
}
.mt-coverage-label {
  font-size: 12px;
  color: #949494;
  margin-top: 4px;
}
.mt-coverage-divider {
  width: 1px;
  height: 40px;
  background: #E7E2D8;
  flex-shrink: 0;
}
@media (max-width: 560px) { .mt-coverage-divider { width: 40px; height: 1px; } }

/* ---- CTA ---- */
.mt-cta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}
.mt-card .mt-cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 26px;
  background: #F2701D;
  color: #fff;
  font-weight: 600;
  font-size: 14.5px;
  border-radius: 8px;
  transition: background 0.15s ease;
}
.mt-card .mt-cta-btn:hover { background: #D8620F; }
.mt-card .mt-cta-secondary {
  padding: 14px 20px;
  background: none;
  border: 1.5px solid #D8D2C6;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #161616;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.mt-card .mt-cta-secondary:hover { border-color: #161616; }

/* ---- Map ---- */
.mt-map-wrap {
  border: 1px solid #E7E2D8;
  border-radius: 12px;
  overflow: hidden;
  height: 360px;
  position: relative;
}
.mt-map-loading {
  position: absolute; top: 10px; left: 10px; z-index: 1000;
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.92);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px; font-weight: 600; color: #656565;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.mt-map-spinner {
  width: 14px; height: 14px;
  border: 2px solid #E7E2D8;
  border-top-color: #F2701D;
  border-radius: 50%;
  animation: mtSpin 0.6s linear infinite;
}
@keyframes mtSpin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .mt-map-wrap { height: 260px; } }
.mt-map { width: 100%; height: 100%; }
.mt-marker-dot {
  width: 16px; height: 16px;
  background: #F2701D;
  border: 3px solid #fff;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(242,112,29,0.4);
}

/* ---- POI markers ---- */
.mt-poi-marker { background: transparent; border: none; }
.mt-poi-shape {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: rgba(255,255,255,0.9);
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}
.mt-poi-shape svg { display: block; }

/* ---- Map legend ---- */
.mt-legend {
  position: absolute; right: 10px; bottom: 10px; z-index: 1000;
  display: flex; flex-direction: column; gap: 4px;
  background: rgba(255,255,255,0.94);
  border: 1px solid #E7E2D8;
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 180px; overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  font-family: 'Inter', sans-serif;
}
.mt-legend-item { display: flex; align-items: center; gap: 8px; }
.mt-legend-swatch { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; }
.mt-legend-swatch svg { display: block; }
.mt-legend-label { font-size: 11px; font-weight: 600; color: #3A3A3A; white-space: nowrap; }

.mt-poi-popup {
  display: flex; flex-direction: column; gap: 2px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
}
.mt-poi-popup strong { font-size: 13px; }
.mt-poi-popup span { color: #949494; text-transform: capitalize; }



/* Leaflet popup override */
.leaflet-popup-content-wrapper {
  border-radius: 8px !important;
  font-family: 'Inter', sans-serif !important;
}
.leaflet-popup-content { margin: 8px 12px !important; }
`;
