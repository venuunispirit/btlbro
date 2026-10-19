import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Search, MapPin, Locate, Info, ChevronDown, Download, X,
  Building2, Briefcase, Trees, ShoppingCart, ShoppingBag, GraduationCap,
  Landmark, Clapperboard, Tv, Newspaper, TrainFront, Bus, Signpost,
  Coffee, CalendarCheck, MousePointerClick,
} from "lucide-react";
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

// `icon` is a lucide component reference (not a string) so the chips stay
// crisp and inherit the chip's text colour via currentColor.
const categories = [
  { id: "apartments", label: "Apartments", icon: Building2, overpass: ["apartments", "residential", "dormitory", "house", "apartment"] },
  { id: "corporates", label: "Corporates", icon: Briefcase, overpass: ["office", "company", "corporate", "coworking"] },
  { id: "parks", label: "Parks", icon: Trees, overpass: ["park", "garden", "playground", "recreation_ground"] },
  { id: "supermarkets", label: "Supermarkets", icon: ShoppingCart, overpass: ["supermarket", "grocery", "convenience"] },
  { id: "malls", label: "Malls", icon: ShoppingBag, overpass: ["mall", "department_store", "retail"] },
  { id: "schools", label: "Schools", icon: GraduationCap, overpass: ["school", "kindergarten"] },
  { id: "colleges", label: "Colleges", icon: Landmark, overpass: ["university", "college", "library"] },
  { id: "cinema", label: "Cinema Screens", icon: Clapperboard, overpass: ["cinema", "movie_theatre", "theatre"] },
  { id: "tvradio", label: "TV & Radio Ads", icon: Tv, overpass: ["studio", "radio", "television"] },
  { id: "newspaper", label: "Newspaper Insertions", icon: Newspaper, overpass: ["newsagent", "kiosk", "newspaper"] },
  { id: "metro", label: "Metro Stations", icon: TrainFront, overpass: ["station", "subway", "metro", "tram"] },
  { id: "vehicle", label: "Vehicle Branding", icon: Bus, overpass: ["parking", "bus_station", "fuel"] },
  { id: "hoardings", label: "Hoardings", icon: Signpost, overpass: ["advertising", "billboard", "billboard_advertising"] },
];

// Icon + label for a catchment type coming from the Google Sheet tabs
// ("apartment services" -> Apartments, "cafe" -> Cafes, "metro station" -> …)
const CATEGORY_META = [
  { match: /apartment/, label: "Apartments", icon: Building2 },
  { match: /cafe|coffee|restaurant/, label: "Cafes", icon: Coffee },
  { match: /metro|station/, label: "Metro Stations", icon: TrainFront },
  { match: /park|garden/, label: "Parks", icon: Trees },
  { match: /mall/, label: "Malls", icon: ShoppingBag },
  { match: /school/, label: "Schools", icon: GraduationCap },
  { match: /college|university/, label: "Colleges", icon: Landmark },
  { match: /cinema|theatre/, label: "Cinema Screens", icon: Clapperboard },
  { match: /corporate|office|company/, label: "Corporates", icon: Briefcase },
  { match: /supermarket|grocery/, label: "Supermarkets", icon: ShoppingCart },
  { match: /newspaper/, label: "Newspapers", icon: Newspaper },
  { match: /vehicle/, label: "Vehicle Branding", icon: Bus },
  { match: /hoarding|ooh|billboard/, label: "Hoardings", icon: Signpost },
  { match: /tv|radio|studio/, label: "TV & Radio Ads", icon: Tv },
  { match: /convention|banquet|event|function/, label: "Convention Centers", icon: CalendarCheck },
];
function categoryMetaForType(type) {
  const t = (type || '').toLowerCase();
  const meta = CATEGORY_META.find((m) => m.match.test(t));
  if (meta) return meta;
  return { label: t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Locations', icon: MapPin };
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

// Build the SVG string for a catchment marker shape. All places render the
// same — Google-sourced ones simply get priced/backfilled from the sheet later.
function markerSvg(label) {
  const st = CATCHMENT_STYLE[label] || { shape: 'circle', color: '#6B7280' };
  const color = st.color;
  const fill = color;
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
    if (!seen[label]) seen[label] = { label };
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

// Leaflet popups are built as raw HTML strings, so any value that came from the
// sheet or Google ("Ravi & Sons <Premium>") has to be escaped or it injects
// broken markup into the popup. Applied to every interpolated name/type/price.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// Strip counter suffix " (N)" from a name for display and dedup
function stripCounter(name) {
  return String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim();
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

// The mobile card list is paginated because a search can return hundreds of
// places. Desktop scrolls a full table in its own container, so it is unaffected.
const MOBILE_PAGE_SIZE = 5;

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
  // Map legend starts collapsed so it never covers the catchment area
  const [legendOpen, setLegendOpen] = useState(false);
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
  // Markers keyed by POI id. A Leaflet popup is real DOM outside React, so it
  // never re-renders on its own — this lets us rewrite the OPEN popup's content
  // when the user ticks something, keeping the map and the table in step.
  const poiMarkersRef = useRef(new Map());
  // Latest selection state + toggles, read by the popup's click handlers. The
  // popup HTML is built once per marker, so its handlers cannot close over React
  // state directly; they read through this ref at click time instead.
  const popupApiRef = useRef({ selectedIds: [], serviceSelections: {} });

  // A place picked on the map must become visible in the list below. The mobile
  // list is paginated, so a pick can land past the rendered page; these three
  // refs let the reveal effect find the row, open it and scroll to it.
  const revealPoiRef = useRef(null);   // poi id last touched from the map
  const filteredRef = useRef([]);      // the list's `filtered`, refreshed each render
  const cardRefs = useRef(new Map());  // poi id -> card element
  const pendingScrollRef = useRef(null); // poi id to scroll to once it is rendered

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

  // The center place keeps a stable id across searches, so a selection made for
  // one searched location must not silently carry its service ticks onto the
  // next one. Called whenever the search point changes.
  function clearCenterSelection() {
    setSelectedIds((prev) => (prev.includes('searched_center') ? prev.filter((id) => id !== 'searched_center') : prev));
    setServiceSelections((prev) => {
      if (!prev.searched_center) return prev;
      const { searched_center, ...rest } = prev;
      return rest;
    });
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
    clearCenterSelection();
    sessionStorage.removeItem('btl_checkout_data');
    const c = await geocode(loc.trim());
    if (c) {
      setCoords(c);
      loadNearby(c.lat, c.lng);
      try {
        await fetch('/api/places/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: loc.trim(),
            lat: c.lat,
            lng: c.lng,
            type: 'your_location',
            source: 'from google',
          }),
        });
      } catch (e) {
        // ignore tracking errors
      }
    }
  }

  // Fetch real places around the search point (via Google Nearby) so the user
  // "sees everything around them" even for catchments we have no sheet data for.
  async function loadNearby(lat, lng) {
    try {
      const res = await fetch(`/api/places/nearby?lat=${lat}&lng=${lng}&radius=${radius * 1000}&types=${NEARBY_TYPES.join(',')}`);
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

  // Mobile list is an accordion of the SAME rows the desktop table shows, so
  // `expandedPois` only tracks which cards are open — it never holds selection.
  // Kept as a Set so every card can be open independently.
  const [expandedPois, setExpandedPois] = useState(() => new Set());

  // How many of the mobile cards are rendered. Starts at MOBILE_PAGE_SIZE and
  // grows one page per tap on "Show more".
  const [visibleCount, setVisibleCount] = useState(MOBILE_PAGE_SIZE);

  // A new search or catchment is a different result set, so collapse back to the
  // first page instead of leaving the user scrolled past their old page length.
  useEffect(() => {
    setVisibleCount(MOBILE_PAGE_SIZE);
  }, [location, selectedCategories]);

  function showMorePois() {
    setVisibleCount((prev) => prev + MOBILE_PAGE_SIZE);
  }

  function togglePoiCard(poiId) {
    setExpandedPois((prev) => {
      const next = new Set(prev);
      if (next.has(poiId)) next.delete(poiId);
      else next.add(poiId);
      return next;
    });
  }

  // Phones get the services list as a bottom-sheet overlay instead of a Leaflet
  // popup. The map is only ~260px tall on mobile and the services list is taller
  // than the space above a marker, so Leaflet pushed the popup above the map's
  // top edge, where `.mt-map-wrap`'s overflow:hidden clipped it away.
  const [isMobileMap, setIsMobileMap] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
  );
  const [mapPopupPoiId, setMapPopupPoiId] = useState(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => setIsMobileMap(e.matches);
    setIsMobileMap(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  // Refreshed every render so the popup's DOM handlers always see current state.
  popupApiRef.current = { selectedIds, serviceSelections, toggleSelect, toggleService };

  // Popup body for a POI marker: the place, its catchment, how far away it is and
  // every service that catchment sells — each tickable. It reads and writes the
  // SAME selection state as the table below, so a tick here shows up there (and
  // the row there lights up) without any syncing of its own.
  function poiPopupHtml(poi) {
    const distance = poi.sheetDistance > 0
      ? `${poi.sheetDistance} km`
      : coords && Number.isFinite(poi.distance) ? `${poi.distance.toFixed(2)} km` : '';

    // A sheet place lists the services it actually sells (priced > 0). A Google
    // "on request" place has no rates of its own, so it borrows the services its
    // catchment type sells rather than the current chip selection.
    const keys = columnsForPoi(poi);

    const serviceRows = keys.map((key) => {
      const picked = isServiceSelected(poi.id, key);
      const price = (poi.services && poi.services[key]) || 0;
      const priceText = price > 0 ? fmtINR(price) : 'On request';
      return (
        '<label class="mt-popup-svc' + (picked ? ' is-picked' : '') + '">' +
          '<input type="checkbox" data-mt-popup-svc="' + escapeHtml(key) + '"' + (picked ? ' checked' : '') + ' />' +
          '<span class="mt-popup-svc-name">' + escapeHtml(prettyService(key)) + '</span>' +
          '<span class="mt-popup-svc-price">' + escapeHtml(priceText) + '</span>' +
        '</label>'
      );
    }).join('');

    const anyPicked = hasAnyPromotion(poi.id);

    return (
      '<div class="mt-poi-popup" data-mt-popup-id="' + escapeHtml(poi.id) + '">' +
        '<div class="mt-popup-head">' +
          '<strong>' + escapeHtml(poi.name || poi.fullName) + '</strong>' +
          '<span class="mt-popup-meta">' + escapeHtml(getCategoryLabel(poi.type)) +
            (distance ? ' · ' + escapeHtml(distance) : '') +
            (poi.onRequest ? ' · on request' : '') +
          '</span>' +
        '</div>' +
        (keys.length
          ? '<div class="mt-popup-svcs">' +
              '<div class="mt-popup-svcs-title">Services here</div>' +
              serviceRows +
            '</div>'
          : '<div class="mt-popup-empty">No services published for this catchment yet.</div>') +
        // Both controls live in the same fixed-height slot and cross-fade, so the
        // card keeps one size no matter what is selected.
        '<div class="mt-popup-foot">' +
          '<button type="button" class="mt-popup-pick' + (anyPicked ? ' is-hidden' : '') + '" ' +
            'data-mt-popup-pick="1"' + (anyPicked ? ' tabindex="-1" aria-hidden="true"' : '') + '>Select this place</button>' +
          '<div class="mt-popup-hint' + (anyPicked ? '' : ' is-hidden') + '">Selected — uncheck a service, or remove it from the list.</div>' +
        '</div>' +
      '</div>'
    );
  }

  // The searched location itself, offered as a selectable place too. It has no
  // sheet row or catchment of its own, so it borrows the services the current
  // catchment selection shows (or every service when none is picked) — exactly
  // like a Google "on request" place.
  const centerPoi = useMemo(() => {
    if (!coords || !location) return null;
    return {
      id: 'searched_center',
      name: location,
      fullName: location,
      type: 'your_location',
      lat: coords.lat,
      lng: coords.lng,
      distance: 0,
      hasRealCoords: true,
      sheetDistance: 0,
      services: {},
      onRequest: true, // selectable with no sheet price, like a Nearby place
      isCenter: true,
    };
  }, [coords, location]);

  // Legend rows shown on the map overlay — memoized so the toggle button and
  // the list never disagree about which markers are currently on screen. The
  // searched center is skipped: it renders as the center dot, not a shape.
  const legend = useMemo(() => legendItems(pois.filter((p) => !p.isCenter)), [pois]);

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
    // Does a type belong to any selected catchment chip?
    const typeMatchesSelection = (type) =>
      selectedCategories.some((catId) => {
        const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
        return poiMatchesCategory(type, category);
      });
    // With no chip ticked the map shows EVERY place, so the list must offer every
    // service too — otherwise a service ticked on a pin would have no checkbox to
    // land in and the selection would still be invisible in the listing.
    if (selectedCategories.length === 0) {
      rawRecords.forEach((r) => {
        Object.keys(r.services || {}).forEach((k) => {
          const key = String(k).toLowerCase().trim();
          if (key && !seen.has(key)) { seen.add(key); cols.push(key); }
        });
      });
      return cols;
    }
    // Matching types from visible POIs AND from the sheet — so a catchment with
    // no sheet rows within the radius still shows its OWN services only, and
    // never leaks columns from another catchment (e.g. cafe services in Apartments).
    const matchingTypes = new Set([
      ...pois.filter((p) => typeMatchesSelection(p.type)).map((p) => p.type),
      ...rawRecords.filter((r) => typeMatchesSelection(r.type)).map((r) => r.type),
    ]);
    // Collect service columns only from records of the matching types
    rawRecords.forEach((r) => {
      if (!matchingTypes.has(r.type)) return;
      Object.keys(r.services || {}).forEach((k) => {
        const key = String(k).toLowerCase().trim();
        if (key && !seen.has(key)) { seen.add(key); cols.push(key); }
      });
    });
    return cols;
  }, [rawRecords, selectedCategories, pois, dynamicCategories]);

  // Service columns keyed by catchment TYPE, independent of which chips happen
  // to be ticked. An "on request" Google place has no prices of its own, so the
  // only sensible way to show its services is to borrow the ones its catchment
  // sells. Relying on `serviceColumns` for that meant a place showed "no
  // services published" whenever no category chip was selected — technically
  // true of the selection, but wrong about the place.
  const serviceColumnsByType = useMemo(() => {
    const map = new Map();
    rawRecords.forEach((r) => {
      const t = String(r.type || '').toLowerCase().trim();
      if (!t) return;
      if (!map.has(t)) map.set(t, new Set());
      Object.keys(r.services || {}).forEach((k) => {
        const key = String(k).toLowerCase().trim();
        if (key) map.get(t).add(key);
      });
    });
    const out = new Map();
    map.forEach((set, t) => out.set(t, [...set]));
    return out;
  }, [rawRecords]);

  // Every service column for this place: its own priced ones, else the ones its
  // catchment type sells. Falls back through type -> category -> global selection
  // so a place always shows whatever the sheet knows about it.
  function columnsForPoi(poi) {
    const priced = Object.keys(poi.services || {}).filter((k) => (poi.services[k] || 0) > 0);
    if (priced.length) return priced;

    const byType = serviceColumnsByType.get(String(poi.type || '').toLowerCase().trim());
    if (byType && byType.length) return byType;

    if (serviceColumns.length) return serviceColumns;

    // Last resort: any service at all, so the popup is never empty-handed.
    const all = [];
    rawRecords.forEach((r) => {
      Object.keys(r.services || {}).forEach((k) => {
        const key = String(k).toLowerCase().trim();
        if (key && !all.includes(key)) all.push(key);
      });
    });
    return all;
  }

  // Get category label from POI type
  function getCategoryLabel(poiType) {
    if (poiType === 'your_location') return 'Your location';
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
        clearCenterSelection();
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
                const isGoogle = (d.source || '').toLowerCase() === 'google';
                all.push({
                  id: record.id,
                  name: isGoogle ? stripCounter(d.name) : (d.name || `Record ${record.id}`),
                  fullName: isGoogle ? stripCounter(d.name) : (d.name || `Record ${record.id}`),
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
                  // Source tagging: google-sourced rows render as all-services-available
                  source: isGoogle ? 'from google' : 'inhouse',
                  onRequest: isGoogle,
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
    // the user sees EVERYTHING around them. Tagged onRequest → selectable with
    // no sheet price (flows to checkout tagged "from google"). Skip any place
    // already covered by our sheet data (name match).
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

    // Offer the searched location itself as a selectable place — unless the
    // sheet already lists a place with the same name (then it is already here
    // and selectable on its own).
    const centerName = String(location || '').toLowerCase().trim();
    const alreadyListed = merged.some((p) => String(p.name || '').toLowerCase().trim() === centerName);
    const withCenter = centerPoi && !alreadyListed ? [centerPoi, ...merged] : merged;

    setPois(withCenter);
    setLoadingPois(false);
  }, [rawRecords, coords, radius, location, nearbyPlaces, centerPoi]);

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
    poiMarkersRef.current.clear();

    // Center marker
    const centerIcon = L.divIcon({
      className: "mt-marker",
      html: '<div class="mt-marker-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const centerMarker = L.marker([coords.lat, coords.lng], { icon: centerIcon }).addTo(map);
    if (centerPoi) {
      // The searched place is selectable like any other: same popup on desktop,
      // same bottom-sheet on phones, registered so its ticks stay in sync.
      if (isMobileMap) {
        centerMarker.on("click", () => setMapPopupPoiId(centerPoi.id));
      } else {
        centerMarker.bindPopup(poiPopupHtml(centerPoi));
      }
      poiMarkersRef.current.set(centerPoi.id, centerMarker);
    } else {
      centerMarker.bindPopup(`<div class="mt-poi-popup"><strong>${location || "Location"}</strong><span>center</span></div>`);
    }
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
          if (poi.isCenter) return true; // the searched place always shows
          return selectedCategories.some((catId) => {
            const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
            return poiMatchesCategory(poi.type, category);
          });
        });

    // POI markers — one geometric shape per catchment. Every place renders the
    // same; source (inhouse / from google) is tracked in the sheet, not the UI.
    filteredPois.forEach((poi) => {
      if (poi.isCenter) return; // already drawn as the center dot above
      const svg = markerSvg(categoryMetaForType(poi.type).label);
      const poiIcon = L.divIcon({
        className: "mt-poi-marker",
        html: '<div class="mt-poi-shape" title="' + (poi.name || '') + '">' + svg + '</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const poiMarker = L.marker([poi.lat, poi.lng], { icon: poiIcon }).addTo(map);
      if (isMobileMap) {
        // No Leaflet popup on phones — the bottom sheet renders this instead.
        poiMarker.on("click", () => setMapPopupPoiId(poi.id));
      } else {
        poiMarker.bindPopup(poiPopupHtml(poi));
      }
      poiMarkersRef.current.set(poi.id, poiMarker);
      markersRef.current.push(poiMarker);
    });

    // Fit bounds to show all filtered POIs if any
    if (filteredPois.length > 0) {
      const bounds = L.latLngBounds([[coords.lat, coords.lng]]);
      filteredPois.forEach((p) => bounds.extend([p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [coords, radius, pois, location, selectedCategories, dynamicCategories, isMobileMap, centerPoi]);

  // Popup interactions. The popup lives in Leaflet's own DOM layer, so React
  // cannot attach handlers to it — one delegated listener on the document picks
  // up clicks on the service checkboxes and the select button, and routes them
  // into the same state the table writes to.
  useEffect(() => {
    function handlePopupClick(e) {
      const svcInput = e.target.closest('[data-mt-popup-svc]');
      const pickBtn = e.target.closest('[data-mt-popup-pick]');
      const popup = e.target.closest('[data-mt-popup-id]');
      if (!popup) return;
      const poiId = popup.getAttribute('data-mt-popup-id');

      if (svcInput) {
        e.stopPropagation();
        revealPoiRef.current = poiId;
        popupApiRef.current.toggleService(poiId, svcInput.getAttribute('data-mt-popup-svc'));
        return;
      }
      if (pickBtn) {
        e.stopPropagation();
        revealPoiRef.current = poiId;
        // The button only renders while the place is unselected, so this is a
        // straight add. Deselecting happens from the service checkboxes (which
        // drop the place once nothing is ticked) or the list below.
        popupApiRef.current.toggleSelect(poiId);
      }
    }
    document.addEventListener('click', handlePopupClick);
    return () => document.removeEventListener('click', handlePopupClick);
  }, []);

  // Re-render the OPEN popup after a selection change. React has already
  // updated the table below; this keeps the map in step (ticks shown, button
  // flips to "Remove"). Only the open popup is touched, so closed markers keep
  // their content and the map is not rebuilt while the user reads it.
  useEffect(() => {
    poiMarkersRef.current.forEach((marker, poiId) => {
      if (!marker.isPopupOpen || !marker.isPopupOpen()) return;
      const poi = pois.find((p) => String(p.id) === String(poiId));
      if (poi) marker.setPopupContent(poiPopupHtml(poi));
    });
  }, [selectedIds, serviceSelections, pois]);

  // Reveal a place that was just picked on the map. The mobile list only renders
  // the first `visibleCount` cards, so without this a pick on pin #9 would update
  // the header count while its card stayed on a page the user never sees — which
  // reads as "the map selection is not reflected below". Grow the page to include
  // it, open the card and scroll it into view. `filtered` is rebuilt every render,
  // so it is read through a ref instead of being an effect dependency.
  useEffect(() => {
    const touched = revealPoiRef.current;
    if (!touched || !isMobileMap) return;
    const list = filteredRef.current;
    const idx = list.findIndex((p) => String(p.id) === String(touched));
    if (idx === -1) return;
    revealPoiRef.current = null;
    const rawId = list[idx].id;
    setVisibleCount((prev) => (idx < prev ? prev : Math.ceil((idx + 1) / MOBILE_PAGE_SIZE) * MOBILE_PAGE_SIZE));
    setExpandedPois((prev) => (prev.has(rawId) ? prev : new Set(prev).add(rawId)));
    // The card may not exist yet — growing the page renders it on this pass. The
    // scroll is therefore deferred to the effect below, which retries per render.
    pendingScrollRef.current = String(rawId);
  }, [selectedIds, serviceSelections, isMobileMap]);

  // Scroll the revealed card into view once React has actually mounted it.
  useEffect(() => {
    const key = pendingScrollRef.current;
    if (!key) return;
    const el = cardRefs.current.get(key);
    if (!el) return; // still not rendered — try again after the next render
    pendingScrollRef.current = null;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [visibleCount, expandedPois]);

  const mapPopup = mapPopupPoiId != null
    ? pois.find((p) => String(p.id) === String(mapPopupPoiId))
    : null;

  // Escape closes the mobile sheet, matching the desktop popup's Escape.
  useEffect(() => {
    if (!mapPopup) return;
    const onKey = (e) => { if (e.key === "Escape") setMapPopupPoiId(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mapPopup]);

  // True once the user has picked anything on the map. The location list is
  // normally gated behind a catchment chip, but a pin can be ticked without one,
  // and that selection has to be shown rather than silently held in state.
  const hasAnySelection = pois.some((p) => hasAnyPromotion(p.id));

  return (
    <>
      <style>{CSS}</style>
      <section className="mt-section">
        <div className="mt-container">
          {/* API server unreachable — autocomplete/nearby can't work */}
          {apiError && (
            <div className="mt-api-error">
              ⚠ Can't reach the BTLbro API (localhost:8081). Autocomplete and live map data are off — start the server (`cd server && npm run dev`) and refresh.
            </div>
          )}
          {/* Header */}
          <div className="mt-header">
            <span className="mt-badge">Neighbourhood Marketing Tool</span>
            <h1 className="mt-title">
              Find your <span className="mt-accent">marketing zone</span>
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
                    <div className="mt-input-bar">
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
                    </div>
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
                      <div className="mt-input-bar">
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
                      </div>
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
                    {/* Presets share the slider's row instead of stacking
                        under it, so the whole radius control is one line. */}
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
                    {legend.length > 0 && (
                      <div className="mt-legend-wrap">
                        {/* Mobile-only round toggle. Desktop never renders it —
                            the panel is always visible there. */}
                        <button
                          type="button"
                          className="mt-legend-info"
                          onClick={() => setLegendOpen((v) => !v)}
                          aria-expanded={legendOpen}
                          aria-label={legendOpen ? 'Hide map legend' : 'Show map legend'}
                          title="Legend"
                        >
                          <Info size={17} />
                        </button>
                        <div className={`mt-legend${legendOpen ? ' mt-legend-open' : ''}`}>
                          {legend.map((it) => (
                            <div key={it.label} className="mt-legend-item">
                              <span
                                className="mt-legend-swatch"
                                dangerouslySetInnerHTML={{ __html: markerSvg(it.label) }}
                              />
                              <span className="mt-legend-label">{it.label}</span>
                            </div>
                          ))}
                        </div>
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
                    {dynamicCategories.map((cat) => {
                      const Icon = cat.icon || MapPin;
                      // How many of THIS catchment are currently selected. Shown as
                      // a corner badge on the button, so each catchment card carries
                      // its own number rather than one total floating above them.
                      const catSelected = pois.reduce((n, p) => {
                        if (!hasAnyPromotion(p.id)) return n;
                        const category = dynamicCategories.find((c) => c.id === cat.id) || categories.find((c) => c.id === cat.id);
                        return poiMatchesCategory(p.type, category) ? n + 1 : n;
                      }, 0);
                      return (
                        <button
                          key={cat.id}
                          className={`mt-cat-chip ${selectedCategories.includes(cat.id) ? "mt-cat-active" : ""}${catSelected > 0 ? " mt-cat-has-selected" : ""}`}
                          aria-label={catSelected > 0 ? `${cat.label}, ${catSelected} selected` : undefined}
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
                          <span className="mt-cat-icon" aria-hidden="true"><Icon /></span>
                          <span className="mt-cat-label">{cat.label}</span>
                          {catSelected > 0 && (
                            <span className="mt-cat-badge" aria-hidden="true">{catSelected}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>



                {/* Step prompt + results list — scrolled into view on catchment pick */}
                <div ref={resultsRef}>
                  {selectedCategories.length === 0 && (
                    <div className="mt-step-note">
                      <MousePointerClick size={16} aria-hidden="true" />
                      Select a catchment above to see matching locations on the map and in the list.
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

                {/* POI Table with checkboxes. Rendered when a catchment is picked OR
                    when the user has already selected something on the map — with no
                    chip the map still lists every place and allows ticks, so hiding
                    the listing here would strand those selections with nowhere to show. */}
                {pois.length > 0 && (selectedCategories.length > 0 || hasAnySelection) && (() => {
                  // No chip selected = show every place, matching what the map shows.
                  const filtered = selectedCategories.length === 0
                    ? pois
                    : pois.filter((poi) => {
                        if (poi.isCenter) return true; // the searched place always shows
                        return selectedCategories.some((catId) => {
                          const category = dynamicCategories.find((c) => c.id === catId) || categories.find((c) => c.id === catId);
                          return poiMatchesCategory(poi.type, category);
                        });
                      });
                  if (filtered.length === 0) return null;
                  // Anything the user has picked floats to the top of the listing,
                  // overriding the distance/alphabetical order, so a place chosen on
                  // the map is always the first thing seen in the list. Sorting a copy
                  // keeps `pois` (and therefore the marker order) untouched, and the
                  // sort is stable so each group keeps its original order.
                  const ordered = hasAnySelection
                    ? [...filtered].sort((a, b) => (hasAnyPromotion(a.id) ? 0 : 1) - (hasAnyPromotion(b.id) ? 0 : 1))
                    : filtered;
                  // Expose the rendered list to the reveal effect (see revealPoiRef).
                  filteredRef.current = ordered;
                  // Count selections across ALL pois (not just current chip) so
                  // apartment + cafe selections both show in the total
                  const selectedPoisList = pois.filter((p) => hasAnyPromotion(p.id));
                  const selectedCount = selectedPoisList.length;
                  // Checkout handoff is built once and reused by both layouts so
                  // the mobile accordion can never drift from the desktop table.
                  const checkoutHref = `/checkout?count=${selectedCount}&categories=${[...new Set(selectedPoisList.map(p => getCategoryLabel(p.type)))].join(',')}`;
                  const writeCheckoutSession = () => {
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
                  };
                  return (
                    <div className="mt-poi-table">
                      {/* Desktop keeps the original table verbatim — it is only
                          wrapped so the breakpoint can swap it for the cards
                          below. Deliberately left un-indented to keep the
                          desktop markup byte-identical to before. */}
                      <div className="desktop-locations">
                      <div className="mt-poi-table-header">
                        <span className="mt-poi-table-title">Locations Found ({filtered.length}){selectedCount > 0 ? ` • ${selectedCount} selected` : ''}</span>
                        <div className="mt-poi-table-actions">
                          <button className="mt-excel-btn" onClick={() => downloadExcel(selectedCount > 0 ? selectedPoisList : ordered)}>
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
                            {ordered.map((poi, idx) => {
                              const isSelected = hasAnyPromotion(poi.id);
                              const onRequest = poi.onRequest === true;
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
                                        // Google place, no sheet price yet — selectable; the
                                        // source is tracked in the sheet, never shown to the user
                                        <label className="mt-svc-pick" title="Select service">
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
                        <a href={checkoutHref} className="mt-continue-btn" onClick={writeCheckoutSession}>
                          Continue with {selectedCount} location{selectedCount > 1 ? "s" : ""}
                        </a>
                      </div>
                    )}
                      </div>
                      <div className="mobile-locations">
                        <div className="locations-header">
                          <div className="locations-header-text">
                            <span className="locations-header-title">Locations Found ({filtered.length})</span>
                            {selectedCount > 0 && <span className="locations-header-sub">{selectedCount} selected</span>}
                          </div>
                          <button className="mt-excel-btn locations-excel-btn" onClick={() => downloadExcel(selectedCount > 0 ? selectedPoisList : ordered)}>
                            <Download size={15} />
                            <span>Download Excel</span>
                          </button>
                        </div>
                        <div className="locations-list">
                          {ordered.slice(0, visibleCount).map((poi, idx) => {
                            const isSelected = hasAnyPromotion(poi.id);
                            const open = expandedPois.has(poi.id);
                            const distText = poi.sheetDistance > 0
                              ? `${poi.sheetDistance} km`
                              : coords
                                ? `${poi.distance.toFixed(2)} km`
                                : '-';
                            return (
                              <div
                                key={poi.id}
                                ref={(el) => {
                                  if (el) cardRefs.current.set(String(poi.id), el);
                                  else cardRefs.current.delete(String(poi.id));
                                }}
                                className={`location-card${isSelected ? ' location-card-selected' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="location-card-header"
                                  aria-expanded={open}
                                  onClick={() => togglePoiCard(poi.id)}
                                >
                                  <span className="location-card-index">{idx + 1}</span>
                                  <span className="location-card-head">
                                    <span className="location-card-name">{poi.name}</span>
                                    <span className="location-card-meta">
                                      <span className="location-card-catchment">{getCategoryLabel(poi.type)}</span>
                                      <span className="location-card-dist">{distText}</span>
                                    </span>
                                  </span>
                                  <ChevronDown size={16} className={`location-card-chevron${open ? ' is-open' : ''}`} />
                                </button>
                                <div className={`location-card-body${open ? ' is-open' : ''}`}>
                                  <div className="location-card-options">
                                    {serviceColumns.map((svc) => {
                                      const price = (poi.services && poi.services[svc]) || 0;
                                      const picked = isServiceSelected(poi.id, svc);
                                      // onRequest rows stay selectable (they flow to
                                      // checkout tagged "from google") but show no price
                                      return (
                                        <label key={svc} className="location-option">
                                          <span className="location-option-text">
                                            {prettyService(svc)}
                                            {price > 0 && <span className="location-option-price">{fmtINR(price)} / month</span>}
                                          </span>
                                          {price > 0 || poi.onRequest === true ? (
                                            <input
                                              type="checkbox"
                                              className="mt-svc-checkbox"
                                              checked={picked}
                                              onChange={() => toggleService(poi.id, svc)}
                                            />
                                          ) : (
                                            <span className="mt-svc-none">-</span>
                                          )}
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {visibleCount < filtered.length && (
                          <div className="locations-more-wrap">
                            <button
                              type="button"
                              className="locations-more-btn"
                              onClick={showMorePois}
                            >
                              <span className="locations-more-label">
                                Show {Math.min(MOBILE_PAGE_SIZE, filtered.length - visibleCount)} more
                              </span>
                              <span className="locations-more-sub">
                                {filtered.length - visibleCount} of {filtered.length} remaining
                              </span>
                            </button>
                          </div>
                        )}
                        {selectedCount > 0 && (
                          <div className="locations-actions">
                            <a href="/customize" className="mt-customize-btn locations-action-btn">
                              Customize Campaign
                            </a>
                            <a href={checkoutHref} className="mt-continue-btn locations-action-btn" onClick={writeCheckoutSession}>
                              Continue with {selectedCount} location{selectedCount > 1 ? "s" : ""}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}


              </div>
            )}
          </div>
        </div>
      </section>

      {/* Mobile-only services dialog, centred over the map. Reuses poiPopupHtml
          and the delegated document click handler, so the tick logic is
          identical to the desktop popup — only the placement changes. */}
      {mapPopupPoiId != null && mapPopup && (
        <div
          className="mt-dialog-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setMapPopupPoiId(null); }}
        >
          <div
            className="mt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${mapPopup.name} — services`}
          >
            <button
              type="button"
              className="mt-dialog-close"
              aria-label="Close services"
              onClick={() => setMapPopupPoiId(null)}
            >
              <X size={16} />
            </button>
            {/* Separate node: React forbids children alongside
                dangerouslySetInnerHTML on one element. */}
            <div dangerouslySetInnerHTML={{ __html: poiPopupHtml(mapPopup) }} />
          </div>
        </div>
      )}
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
  display: flex; align-items: center; gap: 8px;
}
.mt-step-note svg { flex-shrink: 0; color: #F2701D; }
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
/* width:100% plus padding on a content-box section makes the section wider
   than the viewport, so the whole page scrolls sideways on phones. Mobile only —
   desktop keeps its original content-box sizing and layout. */
@media (max-width: 768px) { .mt-section { box-sizing: border-box; } }

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
/* Desktop: one unbroken line. The 560px cap was forcing this ~92-character
   sentence onto two lines even with room to spare. The cap comes off and the
   text is kept on one line; the nowrap guard is what stops a mid-size window
   from wrapping rather than overflowing. */
@media (min-width: 641px) {
  .mt-header .mt-subtitle {
    max-width: none;
    white-space: nowrap;
  }
}
/* Mobile: the sentence is ~92 characters, so it needs room to wrap onto two
   lines without the 560px desktop cap forcing a third. */
@media (max-width: 640px) {
  .mt-header .mt-subtitle {
    font-size: 14.5px;
    line-height: 1.55;
    max-width: 38ch;
  }
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
/* The row is only a layout container. The visible pill lives on .mt-input-bar
   so the search button can sit OUTSIDE it on narrow screens without the border
   and background stretching across the whole group. */
.mt-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}
.mt-input-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  border: 1.5px solid #E7E2D8;
  border-radius: 999px;
  padding: 6px 6px 6px 22px;
  background: #FAF9F7;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.mt-input-bar:focus-within {
  border-color: #F2701D;
  box-shadow: 0 0 0 3px rgba(242,112,29,0.1);
  background: #fff;
}
.mt-input-icon { flex-shrink: 0; }
.mt-input {
  flex: 1;
  /* Flex items default to min-width:auto, so the input refuses to shrink below
     its intrinsic size and pushes the buttons out of the row instead. */
  min-width: 0;
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

/* ---- Narrow phones ----
 * icon + input + clear + locate + a 162px "Search Location" button is ~500px of
 * fixed content, which cannot fit one phone row. The button drops OUT of the
 * pill and onto its own full-width line beneath it. */
@media (max-width: 560px) {
  .mt-input-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .mt-input-bar {
    border-radius: 14px;
    padding: 8px 10px 8px 16px;
  }
  .mt-input-row .mt-input-search-btn {
    width: 100%;
    padding: 12px 18px;
  }
}

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

/* ---- Categories ----
   NOTE: every rule that styles the chip BUTTON is prefixed with .mt-card on
   purpose. Landing.jsx ships a blunt reset --
   .btlbro-root button { background: none; border: none; ... }
   -- which is specificity (0,1,1) and therefore BEATS a bare .mt-cat-active
   (0,1,0). Unprefixed, a selected chip lost its orange background and border
   while keeping color:#fff -- a white icon and label on a white chip.
   Prefixing gives (0,2,0) and matches how .mt-preset / .mt-btn-primary are
   already written in this file. Do not drop the prefix.
   (No backticks in this comment: this block lives inside a JS template
   literal, so a stray backtick would terminate the CSS string.) */
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
/* Per-catchment count, pinned to the top-right corner of its own button so the
   number sits on the card it describes. The chip is position:relative for this. */
.mt-card .mt-cat-chip { position: relative; }
.mt-card .mt-cat-chip.mt-cat-has-selected {
  border-color: #F2701D;
}
.mt-cat-badge {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F2701D;
  color: #fff;
  border: 2px solid #fff;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(242,112,29,0.35);
}
.mt-cats-list {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.mt-cat-label {
  font-size: 13px;
  font-weight: 600;
  /* No colour here on purpose — it must inherit from .mt-cat-chip so the label
     tracks the same hover/active colour as the icon. Setting it explicitly
     left the label dark grey on the orange active chip. */
  text-align: center;
  line-height: 1.2;
}
.mt-card .mt-cat-chip {
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
.mt-card .mt-cat-chip:hover {
  border-color: #F2701D;
  color: #F2701D;
  box-shadow: 0 4px 14px rgba(242,112,29,0.15);
  transform: translateY(-2px);
}
/* Lucide renders an <svg>, so the box (not font-size) drives the size.
   currentColor makes the stroke follow the chip's hover/active colour. */
.mt-cat-icon {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px;
  color: currentColor;
}
.mt-cat-icon svg { width: 100%; height: 100%; stroke-width: 1.75; }
@media (max-width: 640px) {
  .mt-cats-list { gap: 8px; }
  .mt-card .mt-cat-chip {
    width: calc(33.333% - 8px);
    min-height: 78px;
    padding: 10px 8px;
    gap: 6px;
    border-radius: 12px;
  }
  .mt-cat-label { font-size: 11px; }
  .mt-cat-icon { width: 26px; height: 26px; }
  .mt-cat-badge { top: -6px; right: -6px; min-width: 20px; height: 20px; font-size: 11px; }
}

/* Very narrow phones (320–374) — keep exactly 3 per row, tighter. */
@media (max-width: 374px) {
  .mt-card .mt-cat-chip {
    width: calc(33.333% - 8px);
    min-height: 72px;
    padding: 8px 6px;
  }
  .mt-cat-icon { width: 24px; height: 24px; }
  .mt-cat-label { font-size: 10px; }
}
.mt-card .mt-cat-active {
  background: #F2701D;
  color: #fff;
  border-color: #F2701D;
  box-shadow: 0 4px 16px rgba(242,112,29,0.35);
  transform: translateY(-2px);
}
.mt-card .mt-cat-active:hover {
  background: #D8620F;
  border-color: #D8620F;
  color: #fff;
}
/* A 1.75px white stroke on orange washes out, and worse at the 26px mobile
   size — thicken it so the glyph stays readable when a chip is selected. */
.mt-card .mt-cat-active .mt-cat-icon svg { stroke-width: 2.25; }
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
/* ---- Mobile: map first, then radius, then the catchment filter ----
   Flexbox order on .mt-results reorders these without duplicating the
   slider input or the Leaflet map (both hold state / a ref). The base
   order:4 parks every later sibling (results table, empty state) below
   the filter; the four rules after it win on source order at equal
   specificity. Desktop keeps the DOM order: slider, map, filter. */
@media (max-width: 768px) {
  .mt-results > * { order: 4; }
  .mt-results-top { order: 0; }
  .mt-map-wrap { order: 1; }
  .mt-radius-section { order: 2; }
  .mt-categories { order: 3; }

  /* Centre the catchment filter under the map. */
  .mt-categories { align-items: center; text-align: center; }
  .mt-categories-head { justify-content: center; flex-wrap: wrap; }
  .mt-cats-list { justify-content: center; }

  /* Drop the 2/5/10 km presets onto their own full-width row and centre
     them. They sit inline with the track on desktop (see the desktop rule
     above), which leaves them shoved to the right on a phone. */
  .mt-slider-wrap { flex-wrap: wrap; justify-content: center; }
  .mt-slider-wrap .mt-radius-presets {
    flex: 0 0 100%;
    justify-content: center;
    margin-left: 0;
  }
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
/* Keep the slider and its presets on one row, but allow the group to drop to
   its own line rather than crushing the track on a narrow card. */
.mt-slider-wrap .mt-radius-presets {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  margin-left: 2px;
}
@media (max-width: 420px) {
  .mt-slider-wrap {
    flex-wrap: wrap;
  }
  .mt-slider-wrap .mt-radius-presets {
    margin-left: 0;
  }
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
/* Scoped under .mt-card on purpose: the landing page reset
   .btlbro-root button { background:none; border:none } outranks a bare class,
   which left this button white text on a transparent background. */
.mt-card .mt-excel-btn {
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
.mt-card .mt-excel-btn:hover { background: #D8620F; }

/* ---- Locations list: desktop table vs mobile accordion ----
   Both renderers read the same filtered rows and write the same
   selectedIds / serviceSelections, so the breakpoint only swaps which one is
   visible. Nothing here is allowed to restyle the desktop table. */
.desktop-locations { display: block; }
.mobile-locations { display: none; }

@media (max-width: 768px) {
  /* The shell only exists to frame the desktop table, so drop its chrome and
     let each accordion card supply its own border. */
  .mt-poi-table {
    border: none;
    background: none;
    border-radius: 0;
    overflow: visible;
  }
  .desktop-locations { display: none; }
  .mobile-locations {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }
  /* Nothing in here ships a global border-box reset, so state it locally —
     without it the full-width buttons overflow by their own padding. */
  .mobile-locations, .mobile-locations * { box-sizing: border-box; }

  .locations-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .locations-header-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .locations-header-title { font-weight: 700; font-size: 14px; color: #161616; }
  .locations-header-sub { font-size: 12px; color: #949494; }
  /* Scoped so the landing page button reset cannot strip the orange fill. */
  .mobile-locations .locations-excel-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 14px;
    min-height: 44px;
    background: #F2701D;
    color: #fff;
  }

  .locations-list { display: flex; flex-direction: column; gap: 10px; }

  /* "Show more" paging. Two classes so it outranks the landing page's
     .btlbro-root button reset, which strips background/border off buttons. */
  .mobile-locations .locations-more-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 100%;
    min-height: 52px;
    margin-top: 10px;
    background: #FAF9F7;
    border: 1.5px dashed #D8D2C6;
    border-radius: 12px;
    font-family: 'Inter', system-ui, sans-serif;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .mobile-locations .locations-more-btn:active { background: #F3EEE8; }
  .mobile-locations .locations-more-btn:hover { border-color: #F2701D; }
  .locations-more-label { font-size: 14px; font-weight: 700; color: #161616; }
  .locations-more-sub { font-size: 12px; font-weight: 500; color: #949494; }
  .locations-more-label, .locations-more-sub { pointer-events: none; }
  /* Nudge the new page into view so the user does not have to scroll manually. */
  .locations-more-wrap { scroll-margin-top: 12px; }
  .location-card {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid #E8E1D8;
    border-radius: 14px;
    background: #fff;
    overflow: hidden;
  }
  .location-card-selected { border-color: #F2701D; }

  /* The header is the only toggle target. Option checkboxes live outside it, so
     ticking a service can never collapse the card it belongs to. */
  .location-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 14px 16px;
    text-align: left;
    background: #fff;
    border: none;
    cursor: pointer;
  }
  .location-card-header:focus-visible { outline: 2px solid #F2701D; outline-offset: -2px; }
  .location-card-index {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #DDD3C8;
    color: #4A4A4A;
    font-size: 13px;
    font-weight: 700;
  }
  .location-card-selected .location-card-index { border-color: #F2701D; color: #F2701D; }
  .location-card-head { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  .location-card-name { font-size: 14px; font-weight: 600; color: #161616; line-height: 1.25; overflow-wrap: anywhere; }
  .location-card-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
  .location-card-catchment {
    font-size: 12px;
    color: #4A4A4A;
    background: #F3EEE8;
    border-radius: 8px;
    padding: 4px 10px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .location-card-dist { font-size: 13px; color: #444; white-space: nowrap; flex-shrink: 0; }
  .location-card-chevron { flex-shrink: 0; color: #949494; transition: transform 0.2s ease; }
  .location-card-chevron.is-open { transform: rotate(180deg); }

  /* Collapsing animates to the content's natural height (no max-height
     guesswork). visibility flips after the collapse so hidden checkboxes drop
     out of the tab order. */
  .location-card-body {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows 0.25s ease, opacity 0.25s ease, visibility 0s linear 0.25s;
  }
  .location-card-body.is-open {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    transition: grid-template-rows 0.25s ease, opacity 0.25s ease, visibility 0s;
  }
  .location-card-options { overflow: hidden; min-height: 0; padding: 0 16px; }
  /* Divider only while expanded, otherwise a 1px line shows on a collapsed card. */
  .location-card-body.is-open .location-card-options {
    border-top: 1px solid #EEE7DF;
    padding: 4px 16px 10px;
  }

  .location-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    padding: 4px 0;
    border-bottom: 1px solid #F0ECE7;
    cursor: pointer;
  }
  .location-option:last-child { border-bottom: none; }
  .location-option-text { display: flex; flex-direction: column; gap: 2px; font-size: 14px; color: #161616; min-width: 0; }
  .location-option-price { font-size: 12px; color: #949494; }
  .mobile-locations .location-option .mt-svc-checkbox {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  /* Stack full width on phones instead of the desktop side-by-side row. */
  .locations-actions { display: flex; flex-direction: column; gap: 10px; }
  .mobile-locations .locations-action-btn { width: 100%; min-height: 52px; flex: none; }
}

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
/* Two classes on purpose: Landing.jsx ships ".btlbro-root a { color: inherit }",
   which is (0,2,0) and beats a bare .mt-continue-btn (0,1,0) — so the orange pill
   was rendering the inherited dark text. Same reason the chip rules above carry
   the .mt-card prefix. */
.mt-card .mt-continue-btn {
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
.mt-card .mt-continue-btn:hover { background: #D8620F; }
/* Prefixed for the same reason as .mt-continue-btn — Landing's
   ".btlbro-root a { color: inherit }" (0,2,0) beats a bare class (0,1,0). */
.mt-card .mt-customize-btn {
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
.mt-card .mt-customize-btn:hover { border-color: #161616; }
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

/* Google Places row we don't have in our network — renders like any other row */
.mt-tr-onrequest { background: #F7F7F5; opacity: 0.85; cursor: default; }
.mt-tr-onrequest:hover { background: #F0EFEC; }

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

/* ---- Map legend ----
   Wrapper is the anchor (bottom-right). The round "i" toggle is mobile-only;
   the panel itself is unchanged and always visible on desktop. */
.mt-legend-wrap {
  position: absolute; right: 10px; bottom: 10px; z-index: 1000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  font-family: 'Inter', sans-serif;
  max-width: calc(100% - 20px);
}
.mt-legend {
  display: flex; flex-direction: column; gap: 4px;
  background: rgba(255,255,255,0.94);
  border: 1px solid #E7E2D8;
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 180px; overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
/* Desktop: no toggle button, legend always on. */
.mt-legend-info { display: none; }

@media (max-width: 768px) {
  .mt-legend { display: none; }
  .mt-legend.mt-legend-open { display: flex; }
  .mt-legend-info {
    display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; flex-shrink: 0;
    border-radius: 50%;
    background: #F2701D; color: #fff;
    border: none; padding: 0; cursor: pointer;
    font-family: inherit;
    box-shadow: 0 3px 12px rgba(242,112,29,.42);
    transition: background .15s ease, transform .15s ease;
  }
  .mt-legend-info:hover { background: #D8620F; transform: scale(1.06); }
  .mt-legend-info:active { transform: scale(.96); }
  .mt-legend-info:focus-visible { outline: 3px solid #F2701D; outline-offset: 3px; }
  /* Labels are nowrap, so cap the panel and ellipsize rather than let a long
     catchment name push past the map edge. */
  .mt-legend { max-width: 100%; }
  .mt-legend-item { min-width: 0; }
  .mt-legend-label { overflow: hidden; text-overflow: ellipsis; }
}

.mt-legend-item { display: flex; align-items: center; gap: 8px; }
.mt-legend-swatch { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; }
.mt-legend-swatch svg { display: block; }
.mt-legend-label { font-size: 11px; font-weight: 600; color: #3A3A3A; white-space: nowrap; }

/* The popup is content-sized by Leaflet, so anything that changes the text —
 * ticking a service bolds its name, and the footer swaps a button for a hint —
 * resizes the card and the map jumps. Fixed width + a fixed-height footer slot
 * keeps the card the same size through every selection state. */
.mt-poi-popup {
  display: flex; flex-direction: column; gap: 2px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  width: 232px;
}
.mt-poi-popup strong { font-size: 13px; }
.mt-poi-popup span { color: #949494; text-transform: capitalize; }

/* Popup: place + services + select button */
.mt-popup-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.mt-popup-meta { font-size: 11px; color: #949494; text-transform: capitalize; }
.mt-popup-svcs {
  display: flex; flex-direction: column; gap: 4px;
  border-top: 1px solid #E7E2D8; border-bottom: 1px solid #E7E2D8;
  padding: 6px 0; margin-bottom: 8px;
}
.mt-popup-svcs-title { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #949494; }
.mt-popup-svc {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #4A4A4A; cursor: pointer;
  padding: 3px 5px; margin: 0 -5px; border-radius: 6px;
}
.mt-popup-svc:hover { background: #FAF9F7; }
.mt-popup-svc input { accent-color: #F2701D; margin: 0; cursor: pointer; }
/* tabular numerals so the price column keeps its width as values change */
.mt-popup-svc-price { font-variant-numeric: tabular-nums; }
.mt-popup-svc-name {
  flex: 1; text-transform: none; color: #4A4A4A;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mt-popup-svc-price { font-size: 11px; color: #949494; text-transform: none; }
/* Ticked state is carried by colour only. Bolding here would change the text
   width and reflow the row, which is what resized the card. */
.mt-popup-svc.is-picked .mt-popup-svc-name { color: #161616; font-weight: 400; }
.mt-popup-empty { font-size: 11px; color: #949494; padding: 4px 0 8px; }

/* Fixed-height footer: the select button and the selected hint occupy the same
   slot and swap via opacity, so the card never changes height. */
.mt-popup-foot {
  position: relative;
  min-height: 31px;
  margin-top: 8px;
}
.mt-popup-pick, .mt-popup-hint {
  position: absolute;
  inset: 0;
  width: 100%;
  transition: opacity 0.15s ease;
}
.mt-popup-hint {
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #10B981; text-align: center; line-height: 1.3;
  pointer-events: none;
}
.mt-popup-foot .mt-popup-pick {
  border: 1px solid #F2701D; background: #F2701D; color: #fff;
  font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600;
  padding: 7px 10px; border-radius: 8px; cursor: pointer;
}
.mt-popup-pick:hover { filter: brightness(.96); }
.mt-popup-pick.is-hidden, .mt-popup-hint.is-hidden { opacity: 0; pointer-events: none; }
/* Hidden state must not eat clicks meant for the control underneath. */
.mt-popup-pick.is-hidden { pointer-events: none; }





/* ---- Mobile services dialog ----
   On phones the services list is a centred dialog over the map instead of a
   marker-anchored popup. The popup was taller than the space above a marker in
   a 260px-tall map, so Leaflet pushed it past the top edge where the wrapper's
   overflow:hidden cut it off. */
.mt-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(22, 22, 22, 0.45);
  display: none;
  /* Dead centre of the viewport, not pinned to the bottom edge. */
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.mt-dialog {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  background: #fff;
  border-radius: 16px;
  padding: 18px 16px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  animation: mt-dialog-in 0.2s ease;
}
@keyframes mt-dialog-in {
  from { transform: scale(0.96); opacity: 0; }
  to { transform: none; opacity: 1; }
}
/* Reserve room for the close button so a long place name cannot run under it. */
.mt-dialog .mt-popup-head { padding-right: 34px; }
.mt-dialog .mt-poi-popup { width: 100%; }
/* Two classes so it outranks the landing page's .btlbro-root button reset,
   which would otherwise strip the background off this button. */
.mt-dialog .mt-dialog-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #FAF9F7;
  border: 1px solid #E7E2D8;
  color: #4A4A4A;
  cursor: pointer;
}
.mt-dialog .mt-dialog-close:hover { background: #F3EEE8; }

@media (max-width: 768px) {
  .mt-dialog-backdrop { display: flex; }
}

/* Leaflet popup override */
.leaflet-popup-content-wrapper {
  border-radius: 8px !important;
  font-family: 'Inter', sans-serif !important;
}
.leaflet-popup-content { margin: 8px 12px !important; }
`;
