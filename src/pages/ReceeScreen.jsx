import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin, Camera, Locate, Send, CheckCircle2, Lock, AlertTriangle,
  User, Phone, X, Loader, ClipboardList, ArrowLeft, Check, Ban, Clock, Navigation,
  ChevronDown, LogOut,
} from 'lucide-react';
import { getUser, getToken, logout as apiLogout } from '../services/shopClient.js';

// Recee / site-survey screen for the recee team.
//     1. Logs in (unified login) → role 'recee' lands here automatically.
//     2. Shows "My assignments" — requests created by admin/PM and assigned here.
//     3. Geolocation is captured automatically on open (no manual entry).
//     4. Manager name / phone / address + service-availability checklist + photos.
//     5. Submit → attaches to the request (request_id), completes it with a full
//        audit trail (who captured, when, which services are available).
// The recee team never needs to touch a spreadsheet.

const SERVICE_AVAIL = { true: 'available', false: 'not_available', null: 'pending' };

// Must match dbHelpers.isWithinCaptureRadius on the server. The server
// recomputes this from the coordinates it receives, so this copy is only there
// to unlock the camera early — it is never the thing that decides.
const CAPTURE_RADIUS_M = 200;

function distanceMeters(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(aLat)) * Math.cos(toRad(bLat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** distance + the GPS device's own error, versus the radius. */
function geoVerdict(target, coords, accuracy) {
  if (!target || coords == null || coords.lat === '' || coords.lng === '') return null;
  const d = distanceMeters(coords.lat, coords.lng, Number(target.target_lat), Number(target.target_lng));
  const a = Number(accuracy) || 0;
  const radius = Number(target.radius_m) || CAPTURE_RADIUS_M;
  if (a > radius) return { ok: false, distance: d, accuracy: a, radius, reason: 'accuracy' };
  return { ok: d + a <= radius, distance: d, accuracy: a, radius, effective: d + a };
}export default function ReceeScreen({ onNavigate }) {
  const user = getUser();
  const [coords, setCoords] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [prices, setPrices] = useState({});   // service name -> { amount: number, unit: 'hour'|'day'|'month' }
  const [priceUnits, setPriceUnits] = useState({}); // service name -> 'hour'|'day'|'month'
  const [geoStatus, setGeoStatus] = useState('locating'); // locating | ok | denied
  const [form, setForm] = useState({ manager_name: '', manager_phone: '', address: '', notes: '' });
  const [photos, setPhotos] = useState([]);
  const [capturedAt, setCapturedAt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Assignments (requests assigned to me, not yet completed)
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [stats, setStats] = useState({ total: 0, remaining: 0, inProgress: 0, completed: 0 });
  const [activeRequest, setActiveRequest] = useState(null); // request being captured
  const [capturing, setCapturing] = useState(false); // showing the capture screen (ad-hoc included)
  const [serviceState, setServiceState] = useState({}); // name → true | false
  const [menuOpen, setMenuOpen] = useState(false);
  const [listView, setListView] = useState(false); // showing the full recee list (vs latest-3 dashboard)
  const [captureStep, setCaptureStep] = useState(0); // wizard step within the capture screen
  const menuRef = useRef(null);

  const isRecee = user && user.is_team && ['recee', 'recee_manager'].includes(user.role);
  const isAdminTest = user && user.is_team && ['super_admin', 'manager'].includes(user.role);

  useEffect(() => {
    if (!user || !user.is_team) { onNavigate?.('/login'); return; }
    if (!isRecee && !isAdminTest) { onNavigate?.('/dashboard'); return; }
    captureLocation();
    loadAssignments();
    // Poll so an assignment made in the Data tab shows up without a reload;
    // skip while the tab is hidden to save requests.
    const poll = setInterval(() => { if (!document.hidden) loadAssignments(true); }, 25000);
    const onFocus = () => loadAssignments(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(poll); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the profile menu on outside tap or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // `silent` refreshes keep the current list on screen instead of flashing the
  // loading state — used by the focus/poll updates above.
  async function loadAssignments(silent = false) {
    if (!silent) setLoadingAssignments(true);
    try {
      const token = getToken();
      const res = await fetch('/api/recee/surveys', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const all = data.surveys || [];
        const mine = all.filter((s) => s.assigned_to_id && s.assigned_to_id === user.id);
        const unassigned = all.filter((s) => !s.assigned_to_id && s.status !== 'done');
        const remaining = mine
          .filter((s) => s.status !== 'done')
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        setAssignments(remaining);
        setStats({
          total: mine.length,
          remaining: remaining.length,
          inProgress: mine.filter((s) => s.status === 'in_progress').length,
          completed: mine.filter((s) => s.status === 'done').length,
          unassigned: unassigned.length,
        });
      }
    } catch { /* non-fatal — ad-hoc capture still works */ }
    if (!silent) setLoadingAssignments(false);
  }

  function captureLocation() {
    setGeoStatus('locating');
    if (!navigator.geolocation) { setGeoStatus('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(Math.round(pos.coords.accuracy));
        setCapturedAt(new Date().toISOString());
        setGeoStatus('ok');
      },
      () => { setGeoStatus('denied'); setCoords({ lat: '', lng: '' }); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function addPhotoFiles(e) {
    const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'));
    setPhotos((prev) => [...prev, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))].slice(0, 12));
    e.target.value = '';
  }

  function startRequest(req) {
    setCapturing(true);
    setActiveRequest(req);
    setCaptureStep(0);
    setServiceState({});
    setPrices({});
    setPriceUnits({});
    setError('');
    setForm((f) => ({
      ...f,
      address: req.address || '',
      notes: req.notes || f.notes,
    }));
    captureLocation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startAdhoc() {
    setCapturing(true);
    setActiveRequest(null);
    setCaptureStep(0);
    setServiceState({});
    setPrices({});
    setPriceUnits({});
    setError('');
    setForm({ manager_name: '', manager_phone: '', address: '', notes: '' });
    setPhotos([]);
    captureLocation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function stopRequest() {
    setCapturing(false);
    setActiveRequest(null);
    setCaptureStep(0);
    setServiceState({});
    setPriceUnits({});
    setError('');
    setForm({ manager_name: '', manager_phone: '', address: '', notes: '' });
    setPhotos([]);
  }

  // Back from the capture screen: an assignment returns to the full list, an
  // ad-hoc capture returns to the dashboard.
  function goBackFromCapture() {
    const wasRequest = !!activeRequest;
    stopRequest();
    setListView(wasRequest);
  }

  // How far we are from the assigned location, recomputed whenever the fix
  // changes. Null for an ad-hoc capture with no target.
  const verdict = geoVerdict(activeRequest, coords, accuracy);
  // The camera is gated on this so photos can only be taken on site. The server
  // re-checks regardless.
  const onSite = !activeRequest || (verdict ? verdict.ok : false);
  const unanswered = activeRequest
    ? (activeRequest.services || []).map((x) => x.name).filter((n) => {
        const p = prices[n];
        return p === undefined || p === null || p.amount === undefined || p.amount === '';
      })
    : [];

  function setService(name, value) {
    setServiceState((prev) => ({ ...prev, [name]: prev[name] === value ? null : value }));
  }

  function validateStep(step) {
    if (step === 'details') {
      if (!coords || coords.lat === '' || Number.isNaN(parseFloat(coords.lat))) {
        setError('Location not captured yet — enable location access or tap "Recapture".');
        return false;
      }
      if (!isAdhoc) {
        if (!form.manager_name.trim() || !form.manager_phone.trim() || !form.address.trim()) {
          setError('Manager name, phone and address are required.');
          return false;
        }
      }
    }
    if (step === 'photos' && isAdhoc) {
      if (!photos.length) {
        setError('Capture at least one site photo first.');
        return false;
      }
    }
    if (step === 'services' && activeRequest) {
      if (unanswered.length > 0) {
        setError(`Set a price for every service — use 0 for anything not available here. Still to do: ${unanswered.join(', ')}.`);
        return false;
      }
    }
    return true;
  }

  function validateAllStepsUpTo(targetStepIndex) {
    for (let i = 0; i <= targetStepIndex; i++) {
      if (!validateStep(captureSteps[i])) return false;
    }
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!coords || coords.lat === '' || Number.isNaN(parseFloat(coords.lat))) {
      setError('Location not captured yet — enable location access or tap "Recapture".');
      return;
    }
    if (!isAdhoc && (!form.manager_name.trim() || !form.manager_phone.trim() || !form.address.trim())) {
      setError('Manager name, phone and address are required.');
      return;
    }
    if (isAdhoc && !photos.length) {
      setError('Capture at least one site photo first.');
      return;
    }
    if (activeRequest && verdict && !verdict.ok) {
      setError(
        verdict.reason === 'accuracy'
          ? `Your GPS is not accurate enough here (±${verdict.accuracy} m). Move outdoors or use a different spot, then recapture.`
          : `You are ${Math.round(verdict.distance)} m from this location — you need to be within ${verdict.radius} m to capture it.`,
      );
      return;
    }
    if (activeRequest && unanswered.length) {
      setError(`Set a price for every service — use 0 for anything not available here. Still to do: ${unanswered.join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('manager_name', form.manager_name.trim());
      fd.append('manager_phone', form.manager_phone.trim());
      fd.append('address', form.address.trim());
      fd.append('notes', form.notes.trim());
      fd.append('lat', String(coords.lat));
      fd.append('lng', String(coords.lng));
      if (accuracy !== null) fd.append('accuracy', String(accuracy));
      fd.append('captured_at', capturedAt || new Date().toISOString());
      if (activeRequest) {
        fd.append('request_id', String(activeRequest.id));
        // Send availability for every expected service (null = not marked).
        const svc = (activeRequest.services || []).map((s) => ({
          name: s.name,
          available: serviceState[s.name] === true ? true : serviceState[s.name] === false ? false : null,
        }));
        if (svc.length) fd.append('services', JSON.stringify(svc));
        // Per-service price. 0 is a real answer: confirmed not available here.
        const priceList = (activeRequest.services || [])
          .filter((x) => {
            const p = prices[x.name];
            return p && p.amount !== undefined && p.amount !== '';
          })
          .map((x) => {
            const p = prices[x.name];
            return { name: x.name, price: Number(p.amount) || 0, unit: p.unit || 'day' };
          });
        if (priceList.length) fd.append('prices', JSON.stringify(priceList));
      }
      photos.forEach((p) => fd.append('photos', p.file));

      const res = await fetch('/api/recee/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Submission failed (${res.status})`);
      setDone(data.survey);
      loadAssignments();
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm({ keepRequest = false } = {}) {
    setDone(null);
    setForm({ manager_name: '', manager_phone: '', address: '', notes: '' });
    setPhotos([]);
    setCapturedAt(null);
    setServiceState({});
    setPriceUnits({});
    setCaptureStep(0);
    if (!keepRequest) { setActiveRequest(null); setCapturing(false); }
    captureLocation();
    loadAssignments();
  }

  // Not a recee member (and not admin) — should not be here.
  if (!user || !user.is_team) {
    onNavigate?.('/login');
    return null;
  }
  if (!isRecee && !isAdminTest) {
    onNavigate?.('/dashboard');
    return null;
  }

  const roleLabel = (user.role || '').replace(/_/g, ' ');

  // ---- Success state ----
  if (done) {
    const wasRequest = !!activeRequest;
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.okCircle}><CheckCircle2 size={34} /></div>
          <h2 style={styles.title}>{wasRequest ? 'Survey completed' : 'Survey submitted'}</h2>
          <p style={styles.hint}>
            Submission <strong>#{done.id}</strong> {wasRequest ? <>for <strong>{done.title || activeRequest?.title}</strong> is </> : null}now with the admin.
          </p>
          <div style={styles.doneBox}>
            <div style={styles.doneRow}><MapPin size={15} /><span>{Number(done.lat).toFixed(5)}, {Number(done.lng).toFixed(5)}</span></div>
            <div style={styles.doneRow}><User size={15} /><span>{done.manager_name}</span></div>
            <div style={styles.doneRow}><Phone size={15} /><span>{done.manager_phone}</span></div>
            {Array.isArray(done.services) && done.services.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {done.services.map((s, i) => (
                  <span key={i} style={{
                    ...styles.svcTag,
                    background: s.available === true ? '#D1FAE5' : s.available === false ? '#FEE2E2' : '#F3F4F6',
                    color: s.available === true ? '#047857' : s.available === false ? '#B91C1C' : '#6B7280',
                  }}>
                    {s.available === true ? <Check size={11} /> : s.available === false ? <Ban size={11} /> : <Clock size={11} />} {s.name}
                  </span>
                ))}
              </div>
            )}
            {done.photos?.length > 0 && (
              <div style={styles.thumbRow}>
                {done.photos.map((p, i) => (
                  <img key={i} src={p} alt={`photo ${i + 1}`} style={styles.thumb} />
                ))}
              </div>
            )}
          </div>
          <div style={styles.btnRow}>
            <button style={styles.ghostBtn} onClick={() => resetForm()}>
              Back to dashboard
            </button>
            <button style={styles.mainBtn} onClick={async () => { await apiLogout().catch(() => {}); onNavigate?.('/login'); }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Dashboard (home) when not capturing ----
  const showDashboard = !capturing && !activeRequest && !listView;
  const showList = !capturing && !activeRequest && listView;
  const dashboardRecees = assignments.slice(0, 3);

  // Capture wizard step order:
  // - Ad-hoc (no activeRequest): photos → details
  // - Assigned with services: details → services → photos
  // - Assigned without services: details → photos
  const isAdhoc = !activeRequest;
  const hasServices = !!(activeRequest && Array.isArray(activeRequest.services) && activeRequest.services.length > 0);
  const captureSteps = isAdhoc
    ? ['photos', 'details']
    : hasServices
      ? ['details', 'services', 'photos']
      : ['details', 'photos'];
  const stepIndex = Math.min(captureStep, captureSteps.length - 1);
  const currentStep = captureSteps[stepIndex];
  const isLastStep = stepIndex === captureSteps.length - 1;

  function renderReceeCard(a) {
    const lat = Number(a.target_lat);
    const lng = Number(a.target_lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const navQuery = hasCoords ? `${lat},${lng}` : (a.address || a.title || '');
    const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navQuery)}`;
    return (
      <div key={a.id} style={styles.mapCard}>
        <div style={styles.mapPreview}>
          {hasCoords ? (
            <MapPreview lat={lat} lng={lng} />
          ) : (
            <div style={styles.mapPlaceholder}>
              <MapPin size={22} />
              <span style={styles.mapPlaceholderText}>Location preview unavailable</span>
            </div>
          )}
        </div>

        <div style={styles.mapBody}>
          <div style={styles.mapRow1}>
            <div style={styles.mapTitleWrap} title={a.title || 'Location'}>
              <span style={styles.mapBadge}>#{a.id}</span>
              <span style={styles.mapTitle}>{a.title || 'Location'}</span>
            </div>
          </div>

          {a.address && (
            <div style={styles.mapAddress} title={a.address}>
              {a.address}
            </div>
          )}

          {Array.isArray(a.services) && a.services.length > 0 && (
            <div style={styles.mapTags}>
              {a.services.map((s, i) => (
                <span key={i} style={styles.svcTag}>
                  {s.name}
                </span>
              ))}
            </div>
          )}

          <div style={styles.mapDivider} />

          <div style={styles.mapFooter}>
            <div>Requested {new Date(a.created_at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            {a.created_by_name ? <div>by {a.created_by_name}</div> : null}
          </div>

          <div style={styles.mapActions}>
            <a
              href={navUrl}
              target="_blank"
              rel="noreferrer"
              style={styles.navBtn}
            >
              <Navigation size={14} />
              <span>Navigate</span>
            </a>
            <button type="button" onClick={() => startRequest(a)} style={styles.mapCta}>
              <span style={styles.mapCtaText}>Start survey</span>
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
<style>{`
        @keyframes btl-spin { to { transform: rotate(360deg); } }
        .spin { animation: btl-spin 0.8s linear infinite; }
        .recee-header { flex-wrap: nowrap; gap: 10px 12px; }
        .recee-brand { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .recee-userRow { flex-wrap: nowrap; }
        .recee-profilePill:hover { background: rgba(255,255,255,0.16); }
        .recee-menuItem:hover { background: #FAF9F7; }
        .recee-menuItem.recee-menuDanger:hover { background: #FEF2F2; }
        .recee-capHead { display: flex; alignItems: center; justifyContent: space-between; gap: 12px; flexWrap: wrap; marginBottom: 4px; }
        .recee-capHeadText { flex: 1 1 100%; minWidth: 0; }
        .recee-backBtnTop { flexShrink: 0; }
        @media (max-width: 480px) {
          .recee-header { padding: 12px 16px; }
          .recee-userRow { gap: 8px; }
          .recee-profilePill { max-width: 150px; }
          .recee-container { padding: 0 14px !important; }
          .recee-capHead { gap: 8px; }
          .recee-capHeadText { flex: 1 1 auto; minWidth: 120px; }
          .recee-backBtnTop { width: 100%; justifyContent: center; }
        }
      `}</style>
      <div className="recee-header" style={styles.header}>
        <div style={styles.brandRow}>
          <span style={styles.logoMark}>B</span>
          <span className="recee-brand" style={styles.brand}>BTL<span style={{ color: '#F2701D' }}>bro</span></span>
        </div>
        <div className="recee-userRow" style={styles.userRow}>
          <div style={styles.profileWrap} ref={menuRef}>
            <button
              type="button"
              className="recee-profilePill"
              style={styles.profilePill}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={`${user.name} · ${roleLabel}`}
            >
              <span style={styles.avatar}>{(user.name || 'U').trim().charAt(0).toUpperCase()}</span>
              <span style={styles.profileName}>{user.name}</span>
              <span style={{ ...styles.chevron, transform: menuOpen ? 'rotate(180deg)' : 'none' }}>
                <ChevronDown size={15} />
              </span>
            </button>

            {menuOpen && (
              <div style={styles.menu} role="menu">
                <button
                  type="button"
                  className="recee-menuItem"
                  style={styles.menuItem}
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); stopRequest(); setListView(true); }}
                >
                  <ClipboardList size={15} /> Recee list
                </button>
                <button
                  type="button"
                  className="recee-menuItem recee-menuDanger"
                  style={{ ...styles.menuItem, color: '#B91C1C' }}
                  role="menuitem"
                  onClick={async () => { setMenuOpen(false); await apiLogout().catch(() => {}); onNavigate?.('/login'); }}
                >
                  <LogOut size={15} /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="recee-container" style={styles.container}>
        {showDashboard ? (
          <>
            <div style={styles.dashHead}>
              <h2 style={styles.title}>Recee dashboard</h2>
              <button style={styles.dashAdhocBtn} onClick={startAdhoc} title="Capture a site without an assignment">
                <Camera size={20} />
              </button>
            </div>
            <p style={styles.subtitle}>
              Your recee activity at a glance. Tap a remaining recee below to start the capture.
            </p>

            {/* Stat cards */}
            <div style={styles.statGrid}>
              <div style={styles.statCard}>
                <div style={{ ...styles.statIcon, background: '#FFF1E6', color: '#F2701D' }}>
                  <ClipboardList size={18} />
                </div>
                <div style={styles.statNum}>{stats.remaining}</div>
                <div style={styles.statLabel}>Remaining</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statIcon, background: '#FEF3C7', color: '#B45309' }}>
                  <AlertTriangle size={18} />
                </div>
                <div style={styles.statNum}>{stats.unassigned}</div>
                <div style={styles.statLabel}>Unassigned recees</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statIcon, background: '#D1FAE5', color: '#047857' }}>
                  <CheckCircle2 size={18} />
                </div>
                <div style={styles.statNum}>{stats.completed}</div>
                <div style={styles.statLabel}>Completed</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statIcon, background: '#F3F4F6', color: '#4A4A4A' }}>
                  <MapPin size={18} />
                </div>
                <div style={styles.statNum}>{stats.total}</div>
                <div style={styles.statLabel}>Total assigned</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
              <h3 style={styles.sectionTitle}>Remaining recees</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {stats.remaining > 0 && <span style={styles.countTag}>{stats.remaining}</span>}
                {assignments.length > 3 && (
                  <button style={styles.viewAllBtn} onClick={() => setListView(true)}>View all</button>
                )}
              </div>
            </div>

            {loadingAssignments ? (
              <div style={styles.card}><span style={styles.statusRow}><Loader size={16} className="spin" /> Loading assignments…</span></div>
            ) : assignments.length === 0 ? (
              <div style={styles.card}>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <CheckCircle2 size={26} color="#10B981" />
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>All caught up</div>
                  <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
                    No remaining recees. You can still capture a site ad-hoc below — it goes straight to the admin.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {dashboardRecees.map(renderReceeCard)}
              </div>
            )}
          </>
        ) : showList ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <h2 style={styles.title}>All recees</h2>
                <p style={styles.subtitle}>Every recee assigned to you. Tap Start survey to capture on site.</p>
              </div>
              <button style={styles.backBtn} onClick={() => setListView(false)}>
                <ArrowLeft size={13} /> Recee dashboard
              </button>
            </div>

            {loadingAssignments ? (
              <div style={styles.card}><span style={styles.statusRow}><Loader size={16} className="spin" /> Loading assignments…</span></div>
            ) : assignments.length === 0 ? (
              <div style={styles.card}>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <CheckCircle2 size={26} color="#10B981" />
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>All caught up</div>
                  <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
                    No recees assigned to you right now.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {assignments.map(renderReceeCard)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="recee-capHead" style={styles.capHead}>
              <div className="recee-capHeadText" style={styles.capHeadText}>
                <h2 style={styles.title}>Site Survey Capture</h2>
                <p style={styles.stepHint}>
                  Step {stepIndex + 1} of {captureSteps.length} ·
                  {currentStep === 'details' ? 'Manager & site details'
                    : currentStep === 'services' ? 'Services available'
                    : currentStep === 'photos' ? (isAdhoc ? 'Capture site' : 'Site photos')
                    : ''}
                </p>
              </div>
              <button className="recee-backBtnTop" style={styles.backBtn} onClick={goBackFromCapture}>
                <ArrowLeft size={13} /> {activeRequest ? 'All recees' : 'Recee dashboard'}
              </button>
            </div>

            {/* Step progress */}
            <div style={styles.stepBar}>
              {captureSteps.map((s, i) => (
                <div key={s} style={{ ...styles.stepSeg, background: i <= stepIndex ? '#F2701D' : '#E7E2D8' }} />
              ))}
            </div>

            {/* Active assignment banner */}
            {activeRequest && (
              <div style={styles.reqBanner}>
                <div style={styles.reqTop}>
                  <span style={styles.reqBadge}>#{activeRequest.id}</span>
                  <button style={styles.reqX} onClick={stopRequest} title="Stop working on this request" aria-label="Stop working on this request"><X size={16} /></button>
                </div>
                <div style={styles.reqTitle}>{activeRequest.title || 'Assigned location'}</div>
                <div style={styles.reqMeta}>
                  Assigned {activeRequest.assigned_at ? new Date(activeRequest.assigned_at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  {activeRequest.assigned_by_name ? ` · by ${activeRequest.assigned_by_name}` : ''}
                </div>
              </div>
            )}

            {/* Step 1 — manager & site details */}
            {currentStep === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...styles.card, ...styles.locCard }}>
              <div style={styles.cardHead}>
                <span style={styles.cardTitle}><MapPin size={16} /> Location <span style={styles.autoTag}>AUTO</span></span>
                <button style={styles.smallBtn} onClick={captureLocation}>
                  <Locate size={13} /> Recapture
                </button>
              </div>
              <div style={styles.locBody}>
                {geoStatus === 'locating' && (
                  <div style={styles.statusRow}><Loader size={16} className="spin" /> Capturing your location…</div>
                )}
                {geoStatus === 'ok' && coords && (
                  <>
                    {verdict && (
                      <div style={{
                        ...styles.verdict,
                        background: verdict.ok ? '#ECFDF5' : '#FEF2F2',
                        borderColor: verdict.ok ? '#A7F3D0' : '#FECACA',
                        color: verdict.ok ? '#047857' : '#B91C1C',
                      }}>
                        {verdict.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        <span>
                          {verdict.ok
                            ? `On site — ${Math.round(verdict.distance)} m from the target (limit ${verdict.radius} m)`
                            : verdict.reason === 'accuracy'
                              ? `GPS too coarse here (±${verdict.accuracy} m). Step outdoors and recapture.`
                              : `${Math.round(verdict.distance)} m away — you need to be within ${verdict.radius} m`}
                        </span>
                      </div>
                    )}
                    <div style={styles.coordLine}>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</div>
                    <div style={styles.statusOk}>
                      <CheckCircle2 size={14} /> Captured {accuracy !== null ? `(±${accuracy} m)` : ''}
                    </div>
                    <a style={styles.mapLink} href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">
                      Open in Google Maps
                    </a>
                  </>
                )}
                {geoStatus === 'denied' && (
                  <div style={styles.statusErr}>
                    Location access was blocked. Enable it in your browser, then tap "Recapture".
                  </div>
                )}
              </div>
            </div>

            {/* Manager & site form */}
            <form onSubmit={handleSubmit} style={styles.card}>
              <div style={styles.cardHead}><span style={styles.cardTitle}><User size={16} /> Manager & Site details</span></div>

              <label style={styles.fieldLabel}>Manager name {!isAdhoc && '*'}</label>
              <input style={styles.input} value={form.manager_name}
                onChange={(e) => setForm({ ...form, manager_name: e.target.value })} placeholder="e.g. Ramesh Kumar" />

              <label style={styles.fieldLabel}>Manager phone {!isAdhoc && '*'}</label>
              <input style={styles.input} type="tel" value={form.manager_phone}
                onChange={(e) => setForm({ ...form, manager_phone: e.target.value })} placeholder="e.g. 98765 43210" />

              <label style={styles.fieldLabel}>Address {!isAdhoc && '*'}</label>
              <textarea style={{ ...styles.input, minHeight: 64, resize: 'vertical' }} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="House / block / street / landmark — as much detail as possible" />

              <label style={styles.fieldLabel}>Notes (optional)</label>
              <textarea style={{ ...styles.input, minHeight: 48, resize: 'vertical' }} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Access instructions, parking, best time to visit…" />
            </form>
            </div>
            )}

            {/* Step 2 — service availability checklist (assigned requests only) */}
            {currentStep === 'services' && hasServices && (
              <div style={styles.card}>
                <div style={styles.cardHead}>
                  <span style={styles.cardTitle}><CheckCircle2 size={16} /> Services available here</span>
                  <span style={styles.countTag}>
                    {activeRequest.services.length - unanswered.length}/{activeRequest.services.length} priced
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#949494', marginBottom: 8, lineHeight: 1.5 }}>
                  Enter what this location charges per service. Put <strong>0</strong> for anything
                  not available here — that is a real answer, not a blank, and it is what marks
                  the survey finished. Prices land on the location row and the site stops being
                  a Google listing once you submit.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeRequest.services.map((s) => {
                    const priceObj = prices[s.name] || { amount: '', unit: 'day' };
                    const amount = priceObj.amount;
                    const unit = priceObj.unit || 'day';
                    const set = amount !== undefined && amount !== '';
                    const zero = set && Number(amount) === 0;
                    return (
                      <div key={s.name} style={styles.svcRow}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#161616', flex: 1 }}>{s.name}</span>
                        <span style={{ fontSize: 11, color: '#949494' }}>₹</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          placeholder="0"
                          value={amount ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setPrices((p) => ({ ...p, [s.name]: { ...p[s.name], amount: raw } }));
                            setServiceState((st) => ({
                              ...st,
                              [s.name]: raw === '' ? null : Number(raw) > 0,
                            }));
                          }}
                          style={{
                            ...styles.priceInput,
                            borderColor: zero ? '#FCA5A5' : set ? '#10B981' : '#E7E2D8',
                            background: zero ? '#FEF2F2' : set ? '#ECFDF5' : '#fff',
                          }}
                        />
                        <select
                          value={unit}
                          onChange={(e) => {
                            setPrices((p) => ({ ...p, [s.name]: { ...p[s.name], unit: e.target.value } }));
                            setPriceUnits((u) => ({ ...u, [s.name]: e.target.value }));
                          }}
                          style={styles.unitSelect}
                        >
                          <option value="hour">/ hour</option>
                          <option value="day">/ day</option>
                          <option value="month">/ month</option>
                        </select>
                        {zero && <span style={{ fontSize: 10.5, color: '#B91C1C', fontWeight: 600, whiteSpace: 'nowrap' }}>not available</span>}
                      </div>
                    );
                  })}
                </div>
                {unanswered.length > 0 && (
                  <div style={{ ...styles.notice, marginTop: 10 }}>
                    Still to fill in: {unanswered.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — site photos */}
            {currentStep === 'photos' && (
            <div style={styles.card}>
              <div className="recee-photoHead" style={styles.photoHead}>
                <span style={styles.cardTitle}><Camera size={16} /> Site photos <span style={styles.countTag}>{photos.length}/12</span></span>
                <button
                  type="button"
                  className="recee-takeBtn"
                  style={{ ...styles.smallBtn, ...(onSite ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }}
                  disabled={!onSite}
                  onClick={() => onSite && fileRef.current?.click()}
                  title={onSite ? 'Take a photo' : 'Photos unlock when you are within range of the location'}
                >
                  <Camera size={13} /> {photos.length ? 'Add more' : 'Take photo'}
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
                style={{ display: 'none' }} onChange={addPhotoFiles} />
              {!onSite ? (
                <div style={{ ...styles.emptyPhotos, cursor: 'default', background: '#FAF9F7' }}>
                  <Lock size={28} color="#C9C2B4" />
                  <div style={styles.emptyTitle}>Camera locked</div>
                  <div style={styles.emptyText}>
                    {verdict
                      ? `You are ${Math.round(verdict.distance)} m from this location. Get within ${verdict.radius} m and the camera unlocks.`
                      : 'Waiting for your location…'}
                  </div>
                </div>
              ) : photos.length === 0 ? (
                <div style={styles.emptyPhotos} onClick={() => fileRef.current?.click()}>
                  <Camera size={28} />
                  <div style={styles.emptyTitle}>Tap to capture the site</div>
                  <div style={styles.emptyText}>Opens your camera — mixing board, gate, building front…</div>
                </div>
              ) : (
                <div style={styles.thumbRow}>
                  {photos.map((p, i) => (
                    <div key={i} style={styles.thumbWrap}>
                      <img src={p.url} alt={`capture ${i + 1}`} style={styles.thumb} />
                      <button type="button" style={styles.thumbX} onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.wizardNav}>
              {stepIndex > 0 && (
                <button style={styles.navBackBtn} type="button"
                  onClick={() => { setError(''); setCaptureStep(stepIndex - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <ArrowLeft size={14} style={styles.navIcon} /> Back
                </button>
              )}
              {!isLastStep ? (
                <button style={styles.nextBtn} type="button"
                  onClick={() => {
                    setError('');
                    if (validateStep(currentStep)) {
                      setCaptureStep(stepIndex + 1);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}>
                  Next <ArrowLeft size={14} style={{ transform: 'rotate(180deg)' }} />
                </button>
              ) : (
                <button style={styles.submitBtn} type="button" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <span style={styles.submitBtnContent}>
                      <Loader size={18} className="spin" style={styles.navIcon} />
                      <span>Submitting…</span>
                    </span>
                  ) : activeRequest ? (
                    <span style={styles.submitBtnContent}>
                      <Send size={16} style={styles.navIcon} />
                      <span style={styles.btnLabel}>
                        Complete survey #${activeRequest.id}
                      </span>
                    </span>
                  ) : (
                    <span style={styles.submitBtnContent}>
                      <Send size={16} style={styles.navIcon} />
                      <span style={styles.btnLabel}>
                        Submit survey to admin
                      </span>
                    </span>
                  )}
                </button>
              )}
            </div>

            {!activeRequest && (
              <button style={styles.adhocBtn} onClick={stopRequest}>
                <ClipboardList size={14} /> Back to dashboard
              </button>
            )}

            {isAdminTest && (
              <div style={styles.adminHint}>Testing as {roleLabel} — recee role members are routed here on login.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Google Maps preview rendered server-side through /api/places/staticmap so the
// Static Maps API key never reaches the browser. Falls back to a neutral
// placeholder if the image fails to load (bad coords, quota, no key).
function MapPreview({ lat, lng }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <div style={styles.mapPlaceholder}>
        <MapPin size={22} />
        <span style={styles.mapPlaceholderText}>Location preview unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={`/api/places/staticmap?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&zoom=16&size=600x270`}
      alt="Map preview"
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      style={{
        ...styles.mapImg,
        opacity: loaded ? 1 : 0,
      }}
    />
  );
}

const styles = {
  wrap: {
    minHeight: '100vh', background: '#FAF9F7',
    fontFamily: "'Inter', sans-serif", paddingBottom: 80,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: '16px 28px', background: '#161616', color: '#fff',
    position: 'sticky', top: 0, zIndex: 10,
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 1 },
  logoMark: {
    width: 30, height: 30, borderRadius: 8, background: '#fff', color: '#111',
    fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontSize: 15, fontWeight: 700 },
  userRow: { display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexShrink: 0 },
  profileWrap: { position: 'relative' },
  profilePill: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
    padding: '4px 10px 4px 4px', borderRadius: 999, cursor: 'pointer',
    maxWidth: 200, minHeight: 36,
  },
  avatar: {
    width: 28, height: 28, borderRadius: 999, background: '#F2701D', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800, flexShrink: 0,
  },
  profileName: {
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130,
  },
  chevron: { display: 'flex', alignItems: 'center', opacity: 0.8, transition: 'transform 0.15s ease', flexShrink: 0 },
  menu: {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 30,
    background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12,
    boxShadow: '0 10px 28px rgba(22,22,22,0.16)', padding: 6,
    minWidth: 190, display: 'flex', flexDirection: 'column', gap: 2,
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '10px 12px', borderRadius: 8, border: 'none', background: 'transparent',
    color: '#161616', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
    cursor: 'pointer', textAlign: 'left',
  },
  container: { maxWidth: 620, margin: '28px auto 0', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#161616', lineHeight: 1.2 },
  subtitle: { margin: '-8px 0 0', fontSize: 13.5, color: '#656565', lineHeight: 1.5 },
  sectionTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#161616' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
  dashHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 },
  dashAdhocBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 40, borderRadius: 10, border: 'none',
    background: '#FFF1E6', color: '#F2701D', cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(22,22,22,0.08)',
  },
  statCard: {
    background: '#fff', borderRadius: 14, padding: '14px 16px', border: '1px solid #E7E2D8',
    boxShadow: '0 1px 3px rgba(22,22,22,0.04)', display: 'flex', flexDirection: 'column', gap: 4,
  },
  statIcon: {
    width: 34, height: 34, borderRadius: 10, display: 'flex',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  statNum: { fontSize: 26, fontWeight: 800, color: '#161616', lineHeight: 1.1 },
  statLabel: { fontSize: 12, color: '#656565', fontWeight: 600 },
  progTag: {
    fontSize: 10.5, fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF',
    borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
  },
  card: {
    background: '#fff', borderRadius: 14, padding: 18,
    border: '1px solid #E7E2D8', boxShadow: '0 1px 3px rgba(22,22,22,0.04)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  locCard: { background: 'linear-gradient(180deg,#fff 0%,#FBF7F0 100%)' },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 700, color: '#161616' },
  autoTag: {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: '#047857',
    background: '#D1FAE5', borderRadius: 999, padding: '2px 8px',
  },
  countTag: { fontSize: 11, fontWeight: 700, color: '#949494', background: '#FAF9F7', borderRadius: 999, padding: '2px 8px' },
  viewAllBtn: {
    fontSize: 12.5, fontWeight: 700, color: '#F2701D', background: 'transparent',
    border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  },
  smallBtn: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
    color: '#F2701D', background: '#FFF1E6', border: 'none', padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
  },
  photoHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  emptyPhotos: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    padding: '32px 20px', borderRadius: 10, border: '1.5px dashed #E7E2D8',
    color: '#656565', cursor: 'pointer', textAlign: 'center', background: '#FAF9F7',
  },
  emptyTitle: { fontSize: 13, fontWeight: 600, color: '#161616' },
  emptyText: { fontSize: 11.5, color: '#949494', lineHeight: 1.5, maxWidth: 280, margin: 0 },
  coordLine: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: '#161616' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#656565' },
  statusOk: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#047857', fontWeight: 600 },
  statusErr: { fontSize: 13, color: '#B91C1C', background: '#FEE2E2', padding: '10px 12px', borderRadius: 8 },
  mapLink: { fontSize: 12.5, color: '#2563EB', textDecoration: 'none' },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginTop: 4 },
  input: {
    padding: '11px 13px', borderRadius: 10, border: '1.5px solid #E7E2D8',
    fontSize: 14, color: '#161616', outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  emptyPhotos: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '26px 16px', borderRadius: 10, border: '1.5px dashed #E7E2D8',
    color: '#656565', cursor: 'pointer', textAlign: 'center', background: '#FAF9F7',
  },
  thumbRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 96, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid #E7E2D8' },
  thumbX: {
    position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 50,
    background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  error: { padding: '12px 14px', borderRadius: 10, background: '#FEE2E2', color: '#B91C1C', fontSize: 13, border: '1px solid #FECACA' },
  submitBtn: {
    flex: '3 1 0', minWidth: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: 12, border: 'none', background: '#F2701D', color: '#fff',
    fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(242,112,29,0.25)', boxSizing: 'border-box',
    padding: '0 16px',
  },
  nextBtn: {
    flex: '3 1 0', minWidth: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: 12, border: 'none', background: '#F2701D', color: '#fff',
    fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxSizing: 'border-box',
    padding: '0 16px',
  },
  wizardNav: { display: 'flex', alignItems: 'stretch', gap: 10, marginTop: 4 },
  stepHint: { margin: '4px 0 0', fontSize: 12.5, color: '#656565', fontWeight: 600 },
  stepBar: { display: 'flex', gap: 6, marginTop: 0 },
  stepSeg: { height: 4, flex: 1, borderRadius: 999, transition: 'background 0.2s ease' },
  navBackBtn: {
    flex: '2 1 0', minWidth: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 56, borderRadius: 12, border: '1px solid #E7E2D8', background: '#fff',
    fontSize: 14, fontWeight: 600, color: '#161616', cursor: 'pointer', boxSizing: 'border-box',
    padding: '0 16px',
  },
  navIcon: { flexShrink: 0 },
  submitBtnContent: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnLabel: { lineHeight: 1.2, textAlign: 'center', whiteSpace: 'nowrap' },
  capHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 },
  capHeadText: { flex: 1, minWidth: 0 },
  backBtnTop: { flexShrink: 0 },
  adminHint: { textAlign: 'center', fontSize: 12, color: '#B45309', background: '#FEF3C7', padding: '8px 12px', borderRadius: 8 },
  okCircle: { width: 64, height: 64, borderRadius: 50, background: '#D1FAE5', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
  doneBox: { background: '#FAF9F7', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 },
  doneRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#4A4A4A' },
  btnRow: { display: 'flex', gap: 10, marginTop: 22 },
  ghostBtn: { flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  mainBtn: { flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#161616', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  mapCard: {
    background: '#fff',
    borderRadius: 18,
    border: '1px solid #E7E2D8',
    boxShadow: '0 1px 4px rgba(22,22,22,0.04)',
    overflow: 'hidden',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
    cursor: 'default',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  mapPreview: {
    width: '100%',
    aspectRatio: '2.2 / 1',
    background: '#F5F5F5',
    position: 'relative',
    overflow: 'hidden',
  },
  mapImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    transition: 'opacity 0.2s ease',
  },
  mapPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: '#949494',
    // Faint street-grid pattern — reads as "map", never as an actual location.
    backgroundImage:
      'linear-gradient(#E9E9E9 1px, transparent 1px), linear-gradient(90deg, #E9E9E9 1px, transparent 1px), linear-gradient(180deg,#F8F8F8 0%,#F1F1F1 100%)',
    backgroundSize: '34px 34px, 34px 34px, 100% 100%',
    backgroundPosition: 'center center, center center, center center',
  },
  mapPlaceholderText: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 8px',
    background: 'rgba(255,255,255,0.75)',
    borderRadius: 999,
    border: '1px solid #E7E2D8',
  },
  mapBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '14px 16px 16px',
    minWidth: 0,
  },
  mapRow1: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    minWidth: 0,
  },
  mapTitleWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  mapBadge: {
    fontSize: 11,
    fontWeight: 800,
    background: '#FAF9F7',
    border: '1px solid #E7E2D8',
    borderRadius: 999,
    padding: '2px 8px',
    color: '#161616',
    flexShrink: 0,
  },
  mapTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#161616',
    lineHeight: 1.25,
    minWidth: 0,
    wordBreak: 'break-word',
  },
  mapAddress: {
    fontSize: 12.5,
    color: '#656565',
    lineHeight: 1.45,
    marginTop: -4,
    minWidth: 0,
    wordBreak: 'break-word',
  },
  mapTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'flex-start',
  },
  mapDivider: {
    height: 1,
    background: '#F0ECE6',
    width: '100%',
    marginTop: 2,
  },
  mapFooter: {
    fontSize: 11.5,
    color: '#949494',
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  mapActions: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
    minWidth: 0,
  },
  navBtn: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 16px',
    borderRadius: 12,
    border: '1.5px solid #E7E2D8',
    background: '#fff',
    color: '#C2410C',
    fontSize: 13.5,
    fontWeight: 700,
    minHeight: 44,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  mapCta: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '11px 14px',
    borderRadius: 12,
    border: 'none',
    background: '#F2701D',
    color: '#fff',
    fontSize: 13.5,
    fontWeight: 700,
    fontFamily: 'inherit',
    minHeight: 44,
    cursor: 'pointer',
  },
  mapCtaText: { flexShrink: 0 },
  assignCard: {
    background: '#fff',
    borderRadius: 16,
    padding: 16,
    border: '1px solid #E7E2D8',
    boxShadow: '0 1px 3px rgba(22,22,22,0.04)',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'inherit',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  },
  assignGrid: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr auto',
    gap: 12,
    alignItems: 'start',
    minWidth: 0,
  },
  assignIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: '#FFF1E6',
    color: '#F2701D',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  assignBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  assignHeader: {
    minWidth: 0,
  },
  assignTitleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  assignId: {
    fontSize: 11.5,
    fontWeight: 800,
    background: '#FAF9F7',
    border: '1px solid #E7E2D8',
    borderRadius: 6,
    padding: '2px 7px',
    color: '#161616',
    flexShrink: 0,
  },
  assignTitle: {
    fontSize: 14.5,
    fontWeight: 700,
    color: '#161616',
    lineHeight: 1.25,
    minWidth: 0,
    wordBreak: 'break-word',
  },
  assignAddress: {
    fontSize: 12.5,
    color: '#656565',
    lineHeight: 1.45,
    marginTop: -2,
    minWidth: 0,
    wordBreak: 'break-word',
  },
  assignTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'flex-start',
  },
  assignAction: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    flexShrink: 0,
  },
  assignDivider: {
    height: 1,
    background: '#F0ECE6',
    width: '100%',
  },
  assignFooter: {
    fontSize: 11.5,
    color: '#949494',
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  startTag: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    fontWeight: 700,
    color: '#C2410C',
    background: '#FFF1E6',
    padding: '6px 11px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
    height: 32,
    minHeight: 40,
  },
  adhocBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    padding: '12px', borderRadius: 12, border: '1.5px dashed #E7E2D8', background: '#fff',
    fontSize: 13.5, fontWeight: 600, color: '#4A4A4A', cursor: 'pointer',
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
    color: '#4A4A4A', background: '#fff', border: '1px solid #E7E2D8', padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
  },
  reqBanner: {
    display: 'flex', flexDirection: 'column', gap: 6,
    background: 'linear-gradient(135deg,#FFF7ED,#FFF1E6)',
    border: '1.5px solid #F2701D', borderRadius: 14, padding: '16px 18px',
    boxShadow: '0 1px 3px rgba(242,112,29,0.08)',
  },
  reqTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  reqBadge: {
    fontSize: 11.5, fontWeight: 800, background: '#F2701D', color: '#fff',
    borderRadius: 6, padding: '3px 8px', flexShrink: 0,
  },
  reqTitle: { fontSize: 13.5, fontWeight: 700, color: '#161616', lineHeight: 1.4, wordBreak: 'break-word' },
  reqMeta: { fontSize: 11.5, color: '#949494', lineHeight: 1.4, wordBreak: 'break-word' },
  reqX: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#C2410C',
    padding: 4, display: 'flex', flexShrink: 0, width: 28, height: 28,
    alignItems: 'center', justifyContent: 'center', borderRadius: 6,
  },
  svcTag: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
    background: '#FAF9F7', border: '1px solid #E7E2D8', color: '#4A4A4A',
    borderRadius: 999, padding: '4px 8px',
  },
  svcRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
    background: '#FAF9F7', borderRadius: 10, border: '1px solid #F0EDE6', flexWrap: 'wrap',
  },
  priceInput: {
    width: 96, padding: '7px 9px', borderRadius: 8, border: '1px solid #E7E2D8',
    fontSize: 13, fontWeight: 600, color: '#161616', textAlign: 'right', fontFamily: 'inherit',
  },
  unitSelect: {
    padding: '7px 9px', borderRadius: 8, border: '1px solid #E7E2D8',
    fontSize: 12.5, fontWeight: 600, color: '#161616', fontFamily: 'inherit',
    background: '#fff', cursor: 'pointer', minWidth: 100,
  },
  verdict: {
    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 8,
    border: '1px solid', fontSize: 12, fontWeight: 600, marginBottom: 8, lineHeight: 1.4,
  },
  notice: {
    background: '#FEF9E7', border: '1px solid #FDE68A', color: '#B45309',
    borderRadius: 8, padding: '8px 11px', fontSize: 11.5, lineHeight: 1.5,
  },
  svcBtn: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700,
    padding: '6px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', cursor: 'pointer', background: '#fff',
  },
};
