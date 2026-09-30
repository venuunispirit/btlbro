import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin, Camera, Locate, Send, CheckCircle2, Lock, AlertTriangle,
  User, Phone, X, Loader, ClipboardList, ArrowLeft, Check, Ban, Clock,
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
  const [prices, setPrices] = useState({});   // service name -> number (0 = not offered)
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
  const [activeRequest, setActiveRequest] = useState(null); // request being captured
  const [serviceState, setServiceState] = useState({}); // name → true | false

  const isRecee = user && user.is_team && ['recee', 'recee_manager'].includes(user.role);
  const isAdminTest = user && user.is_team && ['super_admin', 'manager'].includes(user.role);

  useEffect(() => {
    if (!user || !user.is_team) { onNavigate?.('/login'); return; }
    if (!isRecee && !isAdminTest) { onNavigate?.('/dashboard'); return; }
    captureLocation();
    loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAssignments() {
    setLoadingAssignments(true);
    try {
      const token = getToken();
      const res = await fetch('/api/recee/surveys', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const all = data.surveys || [];
        const mine = all.filter(
          (s) => s.status !== 'done' && s.assigned_to_id && s.assigned_to_id === user.id,
        );
        setAssignments(mine);
      }
    } catch { /* non-fatal — ad-hoc capture still works */ }
    setLoadingAssignments(false);
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
    setActiveRequest(req);
    setServiceState({});
    setPrices({});
    setError('');
    setForm((f) => ({
      ...f,
      address: req.address || '',
      notes: req.notes || f.notes,
    }));
    captureLocation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function stopRequest() {
    setActiveRequest(null);
    setServiceState({});
    setError('');
    setForm({ manager_name: '', manager_phone: '', address: '', notes: '' });
    setPhotos([]);
  }

  // How far we are from the assigned location, recomputed whenever the fix
  // changes. Null for an ad-hoc capture with no target.
  const verdict = geoVerdict(activeRequest, coords, accuracy);
  // The camera is gated on this so photos can only be taken on site. The server
  // re-checks regardless.
  const onSite = !activeRequest || (verdict ? verdict.ok : false);
  const unanswered = activeRequest
    ? (activeRequest.services || []).map((x) => x.name).filter((n) => prices[n] === undefined || prices[n] === '')
    : [];

  function setService(name, value) {
    setServiceState((prev) => ({ ...prev, [name]: prev[name] === value ? null : value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!coords || coords.lat === '' || Number.isNaN(parseFloat(coords.lat))) {
      setError('Location not captured yet — enable location access or tap "Recapture".');
      return;
    }
    if (!form.manager_name.trim() || !form.manager_phone.trim() || !form.address.trim()) {
      setError('Manager name, phone and address are required.');
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
          .filter((x) => prices[x.name] !== undefined && prices[x.name] !== '')
          .map((x) => ({ name: x.name, price: Number(prices[x.name]) || 0 }));
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
    if (!keepRequest) setActiveRequest(null);
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
              {assignments.length > 0 || loadingAssignments ? 'Back to my assignments' : 'Capture another site'}
            </button>
            <button style={styles.mainBtn} onClick={async () => { await apiLogout().catch(() => {}); onNavigate?.('/login'); }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Assignments list (when not capturing) ----
  const showAssignments = !activeRequest && (assignments.length > 0 || (loadingAssignments && !isAdminTest));

  return (
    <div style={styles.wrap}>
      <style>{`@keyframes btl-spin { to { transform: rotate(360deg); } } .spin { animation: btl-spin 0.8s linear infinite; }`}</style>
      <div style={styles.header}>
        <div style={styles.brandRow}>
          <span style={styles.logoMark}>B</span>
          <span style={styles.brand}>BTL<span style={{ color: '#F2701D' }}>bro</span> · Site Survey</span>
        </div>
        <div style={styles.userRow}>
          <span style={styles.userChip}>
            <Lock size={12} /> {user.name} · {roleLabel}
          </span>
          <button style={styles.signout} onClick={async () => { await apiLogout().catch(() => {}); onNavigate?.('/login'); }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={styles.container}>
        {showAssignments ? (
          <>
            <h2 style={styles.title}>My assignments</h2>
            <p style={styles.subtitle}>
              Requests assigned to you by the admin / recee manager. Tap one to start the capture.
            </p>

            {loadingAssignments ? (
              <div style={styles.card}><span style={styles.statusRow}><Loader size={16} className="spin" /> Loading assignments…</span></div>
            ) : assignments.length === 0 ? (
              <div style={styles.card}>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <ClipboardList size={26} color="#949494" />
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>No pending assignments</div>
                  <div style={{ fontSize: 12.5, color: '#949494', marginTop: 4 }}>
                    You can still capture a site ad-hoc below — it goes straight to the admin.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {assignments.map((a) => (
                  <button key={a.id} onClick={() => startRequest(a)} style={styles.assignCard}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left' }}>
                      <div style={styles.assignIcon}><MapPin size={18} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={styles.assignId}>#{a.id}</span>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#161616' }}>{a.title || 'Location'}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#656565', marginTop: 3, lineHeight: 1.45 }}>{a.address}</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                          {Array.isArray(a.services) && a.services.map((s, i) => (
                            <span key={i} style={styles.svcTag}>{s.name}</span>
                          ))}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#949494', marginTop: 8 }}>
                          Requested {new Date(a.created_at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {a.created_by_name ? ` · by ${a.created_by_name}` : ''}
                        </div>
                      </div>
                      <span style={styles.startTag}>Start <Send size={12} /></span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button style={styles.adhocBtn} onClick={() => { stopRequest(); }}>
              <Camera size={14} /> Capture a site without an assignment
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <h2 style={styles.title}>Site Survey Capture</h2>
                <p style={styles.subtitle}>Your location is captured automatically — add the manager's details, service availability and photos.</p>
              </div>
              {activeRequest && (
                <button style={styles.backBtn} onClick={stopRequest}>
                  <ArrowLeft size={13} /> All assignments
                </button>
              )}
            </div>

            {/* Active assignment banner */}
            {activeRequest && (
              <div style={styles.reqBanner}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={styles.reqBadge}>#{activeRequest.id}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{activeRequest.title || 'Assigned location'}</div>
                    <div style={{ fontSize: 12.5, color: '#949494', marginTop: 2 }}>
                      Assigned {activeRequest.assigned_at ? new Date(activeRequest.assigned_at).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      {activeRequest.assigned_by_name ? ` · by ${activeRequest.assigned_by_name}` : ''}
                    </div>
                  </div>
                </div>
                <button style={styles.reqX} onClick={stopRequest} title="Stop working on this request"><X size={15} /></button>
              </div>
            )}

            {/* Location card */}
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

              <label style={styles.fieldLabel}>Manager name *</label>
              <input style={styles.input} value={form.manager_name}
                onChange={(e) => setForm({ ...form, manager_name: e.target.value })} placeholder="e.g. Ramesh Kumar" />

              <label style={styles.fieldLabel}>Manager phone *</label>
              <input style={styles.input} type="tel" value={form.manager_phone}
                onChange={(e) => setForm({ ...form, manager_phone: e.target.value })} placeholder="e.g. 98765 43210" />

              <label style={styles.fieldLabel}>Address *</label>
              <textarea style={{ ...styles.input, minHeight: 64, resize: 'vertical' }} value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="House / block / street / landmark — as much detail as possible" />

              <label style={styles.fieldLabel}>Notes (optional)</label>
              <textarea style={{ ...styles.input, minHeight: 48, resize: 'vertical' }} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Access instructions, parking, best time to visit…" />
            </form>

            {/* Service availability checklist — only for assigned requests */}
            {activeRequest && Array.isArray(activeRequest.services) && activeRequest.services.length > 0 && (
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
                    const v = prices[s.name];
                    const set = v !== undefined && v !== '';
                    const zero = set && Number(v) === 0;
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
                          value={v ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setPrices((p) => ({ ...p, [s.name]: raw }));
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

            {/* Photos card */}
            <div style={styles.card}>
              <div style={styles.cardHead}>
                <span style={styles.cardTitle}><Camera size={16} /> Site photos <span style={styles.countTag}>{photos.length}/12</span></span>
                <button
                  type="button"
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
                  <Lock size={26} color="#C9C2B4" />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Camera locked</div>
                  <div style={{ fontSize: 11.5, color: '#949494', lineHeight: 1.5, maxWidth: 320, margin: '4px auto 0' }}>
                    {verdict
                      ? `You are ${Math.round(verdict.distance)} m from this location. Get within ${verdict.radius} m and the camera unlocks.`
                      : 'Waiting for your location…'}
                  </div>
                </div>
              ) : photos.length === 0 ? (
                <div style={styles.emptyPhotos} onClick={() => fileRef.current?.click()}>
                  <Camera size={26} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Tap to capture the site</div>
                  <div style={{ fontSize: 11.5, color: '#949494' }}>Opens your camera — mixing board, gate, building front…</div>
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

            {error && <div style={styles.error}>{error}</div>}

            <button style={styles.submitBtn} type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size={18} className="spin" /> : <Send size={17} />}
              {submitting
                ? 'Submitting…'
                : activeRequest
                  ? `Complete survey #${activeRequest.id}`
                  : 'Submit survey to admin'}
            </button>

            {!activeRequest && assignments.length > 0 && (
              <button style={styles.adhocBtn} onClick={() => onNavigate?.('/recee')}>
                <ClipboardList size={14} /> Back to my assignments
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

const styles = {
  wrap: {
    minHeight: '100vh', background: '#FAF9F7',
    fontFamily: "'Inter', sans-serif", paddingBottom: 80,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 28px', background: '#161616', color: '#fff',
    position: 'sticky', top: 0, zIndex: 10,
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: {
    width: 30, height: 30, borderRadius: 8, background: '#fff', color: '#111',
    fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontSize: 15, fontWeight: 700 },
  userRow: { display: 'flex', alignItems: 'center', gap: 12 },
  userChip: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
    background: 'rgba(255,255,255,0.08)', padding: '6px 12px', borderRadius: 999,
    textTransform: 'capitalize',
  },
  signout: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff', fontSize: 12.5, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
  },
  container: { maxWidth: 620, margin: '28px auto 0', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { margin: 0, fontSize: 24, fontWeight: 800, color: '#161616' },
  subtitle: { margin: '-8px 0 0', fontSize: 13.5, color: '#656565', lineHeight: 1.5 },
  card: {
    background: '#fff', borderRadius: 14, padding: 22,
    border: '1px solid #E7E2D8', boxShadow: '0 1px 3px rgba(22,22,22,0.04)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  locCard: { background: 'linear-gradient(180deg,#fff 0%,#FBF7F0 100%)' },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 700, color: '#161616' },
  autoTag: {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: '#047857',
    background: '#D1FAE5', borderRadius: 999, padding: '2px 8px',
  },
  countTag: { fontSize: 11, fontWeight: 700, color: '#949494', background: '#FAF9F7', borderRadius: 999, padding: '2px 8px' },
  smallBtn: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
    color: '#F2701D', background: '#FFF1E6', border: 'none', padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
  },
  locBody: { display: 'flex', flexDirection: 'column', gap: 8 },
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
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '15px', borderRadius: 12, border: 'none', background: '#F2701D', color: '#fff',
    fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 24px rgba(242,112,29,0.3)',
  },
  adminHint: { textAlign: 'center', fontSize: 12, color: '#B45309', background: '#FEF3C7', padding: '8px 12px', borderRadius: 8 },
  okCircle: { width: 64, height: 64, borderRadius: 50, background: '#D1FAE5', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
  doneBox: { background: '#FAF9F7', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 },
  doneRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#4A4A4A' },
  btnRow: { display: 'flex', gap: 10, marginTop: 22 },
  ghostBtn: { flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #E7E2D8', background: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  mainBtn: { flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#161616', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  // assignments
  assignCard: {
    background: '#fff', borderRadius: 14, padding: 16, border: '1px solid #E7E2D8',
    boxShadow: '0 1px 3px rgba(22,22,22,0.04)', cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
  },
  assignIcon: {
    width: 40, height: 40, borderRadius: 10, background: '#FFF1E6', color: '#F2701D',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  assignId: {
    fontSize: 11.5, fontWeight: 800, background: '#FAF9F7', border: '1px solid #E7E2D8',
    borderRadius: 6, padding: '2px 7px', color: '#161616',
  },
  startTag: {
    display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#C2410C',
    background: '#FFF1E6', padding: '6px 11px', borderRadius: 999, whiteSpace: 'nowrap', alignSelf: 'flex-start',
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
    display: 'flex', alignItems: 'flex-start', gap: 10, background: 'linear-gradient(135deg,#FFF7ED,#FFF1E6)',
    border: '1.5px solid #F2701D', borderRadius: 14, padding: '14px 16px',
  },
  reqBadge: {
    fontSize: 11.5, fontWeight: 800, background: '#F2701D', color: '#fff',
    borderRadius: 6, padding: '3px 8px', flexShrink: 0,
  },
  reqX: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#C2410C', padding: 2, display: 'flex', flexShrink: 0,
  },
  svcTag: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
    background: '#FAF9F7', border: '1px solid #E7E2D8', color: '#4A4A4A',
    borderRadius: 999, padding: '3px 9px',
  },
  svcRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
    background: '#FAF9F7', borderRadius: 10, border: '1px solid #F0EDE6', flexWrap: 'wrap',
  },
  priceInput: {
    width: 96, padding: '7px 9px', borderRadius: 8, border: '1px solid #E7E2D8',
    fontSize: 13, fontWeight: 600, color: '#161616', textAlign: 'right', fontFamily: 'inherit',
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
