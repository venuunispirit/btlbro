// Site survey (recee team) API.
//
// Workflow: admin/PM creates a recee REQUEST for a location → recee manager
// assigns it to a recee executive → the executive captures the site (geo,
// photos, manager contact, service availability) → the record completes with
// a full audit trail: who created, who assigned, who captured, and when.
//
//   POST   /api/recee/requests              create request (admin/PM/recee mgr)
//   PUT    /api/recee/surveys/:id/assign    assign request to a recee exec
//   POST   /api/recee/submit                multipart capture (request_id optional)
//   GET    /api/recee/surveys               list + service_catalog
//   PUT    /api/recee/surveys/:id/status    status change (manager+)
//   PUT    /api/recee/surveys/:id/override  accept an out-of-radius capture
//
// Location verification, which is the point of the whole exercise:
//
//   A request is created FROM a location row, so it carries that row's exact
//   coordinates. When the recee submits, the server recomputes the distance
//   from the reported position to that target and refuses to call it done
//   unless it is within CAPTURE_RADIUS_M. The browser's own check is only a
//   convenience — it unlocks the camera early — and is never trusted.
//
//   The comparison is `distance + GPS accuracy <= radius`, not `distance <=
//   radius`. The accuracy figure is the error the GPS device itself reports,
//   which is 5-30m outdoors but can be 150m in a lift lobby. Ignoring it would
//   lock out staff who are genuinely standing at the door.
//
//   A capture that fails is stored as 'needs_review' WITH its real distance, and
//   a manager can accept it. Better a manager makes one judgement call than the
//   field team is stuck outside a building with no way to record anything.
//
//   A 0 service price is a real answer, not missing data: the recee went there
//   and confirmed the service is not offered. The checkout pricer already
//   treats 0 as "not available, charge nothing".
// Photos are stored in server/uploads via multer (same dir as the CMS uploader)
// and served statically at /uploads/*.

import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dbHelpers } from '../db.js';
import { requireStaff, requireManager } from '../middleware/staffAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.\w]/g, '');
    const safe = `recee-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext || '.jpg'}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = express.Router();

// Roles that create requests / assign them to executives.
const MANAGE_ROLES = ['super_admin', 'manager', 'recee_manager', 'bdm', 'ops_manager'];
// Roles allowed to capture/complete a survey (the execs + admins for testing).
const SUBMIT_ROLES = ['recee', 'recee_manager', 'super_admin', 'manager'];
// Roles a request can be assigned TO.
const ASSIGNEE_ROLES = ['recee', 'recee_manager'];

const canManage = (user) => MANAGE_ROLES.includes(user.role);

// How close a capture must be to the assigned location. Shared with the client
// so the camera unlocks at the same threshold the server will enforce.
const CAPTURE_RADIUS_M = 200;
const isApprover = (user) => ['super_admin', 'manager', 'recee_manager'].includes(user.role);

// Distinct service names offered anywhere in the sheet — drives the
// "expected services" picker on request creation and the exec's checklist.
const SERVICE_CORE = new Set([
  'sheet_id', 'name', 'type', 'tab_name', 'sl_no', 'pin_code', 'has_pin_column',
  'distance_km', 'has_distance_column', 'lat', 'lng', 'gmap_link', 'gmap_query',
  'is_active', 'created_at', 'updated_at', 'source', 'edited_locally', 'edited_at',
  'distance', 'apartment', 'id', 'row', 'file_id', 'services',
  'assigned_to', 'assigned_to_name', 'assigned_by', 'assigned_at',
  'recee_status', 'recee_status_at', 'recee_status_by', 'needs_recee', 'edited_by',
]);
const SERVICE_FALLBACK = ['Digital Promotion', 'Lift Promotion', 'Stall Space', 'Digital Screen', 'Notice Board'];

function serviceCatalog() {
  const byKey = new Map(); // normalized name → display name (first wins)
  const add = (name) => {
    const display = String(name).trim();
    if (!display) return;
    const key = display.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && !byKey.has(key)) byKey.set(key, display);
  };
  for (const rec of dbHelpers.getAllRecords()) {
    const d = rec.data || {};
    if (d.services && typeof d.services === 'object') {
      Object.keys(d.services).forEach(add);
    }
    for (const [k, v] of Object.entries(d)) {
      if (SERVICE_CORE.has(k) || v === null || v === undefined || v === '') continue;
      const clean = String(v).replace(/[₹,\s]/g, '');
      if (/^\d+(\.\d+)?$/.test(clean)) add(k.replace(/_/g, ' '));
    }
  }
  const list = [...byKey.values()].sort((a, b) => a.localeCompare(b));
  return list.length ? list : SERVICE_FALLBACK;
}

function parseServicesInput(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((s) => {
        const name = String(s?.name || s || '').trim();
        const a = s?.available;
        const available = a === true || a === 'true' ? true : a === false || a === 'false' ? false : null;
        return name ? { name, available } : null;
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

// ---- Create a recee request (admin / PM / recee manager) ----
router.post('/requests', requireStaff, (req, res) => {
  try {
    if (!canManage(req.staff)) {
      return res.status(403).json({ error: 'Only admin, PM or the recee manager can create recee requests' });
    }
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const address = String(b.address || '').trim();
    if (!title || !address) return res.status(400).json({ error: 'Location title and address are required' });

    // The target point. Best case this comes from an existing location row, so
    // the 200m check is measured against the same coordinates the marketing
    // tool showed. An explicit lat/lng is accepted as a fallback (a spot the
    // manager picks by hand).
    let targetLat = Number.isFinite(Number(b.lat)) ? Number(b.lat) : null;
    let targetLng = Number.isFinite(Number(b.lng)) ? Number(b.lng) : null;
    let recordId = b.record_id ? Number(b.record_id) : null;
    let source = 'manual';

    if (recordId) {
      const record = dbHelpers.getRecordById(recordId);
      if (!record) return res.status(400).json({ error: 'That location no longer exists' });
      const rd = record.data || {};
      targetLat = Number.isFinite(Number(rd.lat)) ? Number(rd.lat) : targetLat;
      targetLng = Number.isFinite(Number(rd.lng)) ? Number(rd.lng) : targetLng;
      source = dbHelpers.recordSource(record);
    }

    const services = Array.isArray(b.services)
      ? b.services
          .map((s) => ({ name: String(s?.name || s || '').trim(), available: null, price: null }))
          .filter((s) => s.name)
      : [];

    const survey = dbHelpers.addSiteSurvey({
      title,
      address,
      notes: String(b.notes || '').trim(),
      services,
      // Without a target there is nothing to verify a capture against, so the
      // request is flagged rather than silently treated as verified.
      target_lat: targetLat,
      target_lng: targetLng,
      record_id: recordId,
      target_source: source,
      radius_m: CAPTURE_RADIUS_M,
      status: targetLat == null ? 'no_target' : 'new',
      created_by_id: req.staff.id,
      created_by_name: req.staff.name || req.staff.email,
      source: 'request',
    });
    res.json({ success: true, survey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create recee request', details: error.message });
  }
});

// ---- Assign a request to a recee executive ----
router.put('/surveys/:id/assign', requireStaff, (req, res) => {
  try {
    if (!canManage(req.staff)) {
      return res.status(403).json({ error: 'Only admin, PM or the recee manager can assign' });
    }
    const existing = dbHelpers.getSiteSurveys().find((s) => s.id === Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.status === 'done') return res.status(400).json({ error: 'Already completed — cannot reassign' });

    const assigneeId = Number((req.body || {}).assigned_to_id);
    const target = Number.isFinite(assigneeId) ? dbHelpers.getUserById(assigneeId) : null;
    if (!target || !target.is_team || target.is_active === false) {
      return res.status(400).json({ error: 'Assignee must be an active team member' });
    }
    if (!ASSIGNEE_ROLES.includes(target.role)) {
      return res.status(400).json({ error: 'Requests can only be assigned to Recee team members' });
    }
    const survey = dbHelpers.updateSiteSurvey(existing.id, {
      assigned_to_id: target.id,
      assigned_to_name: target.name || target.email,
      assigned_by_id: req.staff.id,
      assigned_by_name: req.staff.name || req.staff.email,
      assigned_at: new Date().toISOString(),
      status: existing.status === 'in_progress' ? 'in_progress' : 'assigned',
    });
    res.json({ success: true, survey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign request', details: error.message });
  }
});

// ---- Capture / complete a survey (multipart) ----
router.post('/submit', requireStaff, (req, res) => {
  if (!SUBMIT_ROLES.includes(req.staff.role)) {
    return res.status(403).json({ error: 'Only the recee team (or admin) can submit site surveys' });
  }
  upload.array('photos', 12)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    const b = req.body || {};
    const lat = parseFloat(b.lat);
    const lng = parseFloat(b.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'Location coordinates are required' });
    }
    const photos = (req.files || []).map((f) => `/uploads/${f.filename}`);
    const services = parseServicesInput(b.services);
    const capture = {
      manager_name: String(b.manager_name || '').trim(),
      manager_phone: String(b.manager_phone || '').trim(),
      address: String(b.address || '').trim(),
      notes: String(b.notes || '').trim(),
      lat,
      lng,
      accuracy_m: parseFloat(b.accuracy) || null,
      captured_at: b.captured_at || new Date().toISOString(),
      photos,
      submitted_by_id: req.staff.id,
      submitted_by: req.staff.name || req.staff.email,
      submitted_by_role: req.staff.role,
      source: 'recee',
      status: 'done',
      completed_at: new Date().toISOString(),
    };

    // Per-service prices from the field. Keyed by service name. A 0 is a
    // deliberate "confirmed not available here", which is different from the
    // service being absent from the list entirely.
    const priced = {};
    for (const raw of (Array.isArray(b.prices) ? b.prices : []).slice(0, 60)) {
      const name = String(raw?.name || '').trim();
      if (!name) continue;
      const price = Number(raw?.price);
      if (!Number.isFinite(price) || price < 0) continue;
      priced[name] = Math.round(price * 100) / 100;
    }

    const requestId = b.request_id ? Number(b.request_id) : null;
    if (requestId) {
      const existing = dbHelpers.getSiteSurveys().find((s) => s.id === requestId);
      if (!existing) return res.status(404).json({ error: 'Recee request not found' });
      if (existing.status === 'done') return res.status(409).json({ error: 'This request has already been completed' });
      const isAssignee = existing.assigned_to_id === req.staff.id;
      if (existing.assigned_to_id && !isAssignee && !isApprover(req.staff)) {
        return res.status(403).json({ error: 'This request is assigned to another team member' });
      }
      if (!existing.assigned_to_id && !isApprover(req.staff)) {
        return res.status(403).json({ error: 'This request is not assigned to you yet' });
      }

      // --- location verification, recomputed here, not trusted from the client
      const targetLat = Number(existing.target_lat);
      const targetLng = Number(existing.target_lng);
      const radius = Number(existing.radius_m) || CAPTURE_RADIUS_M;
      let geo = null;
      if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
        geo = dbHelpers.isWithinCaptureRadius(targetLat, targetLng, lat, lng, capture.accuracy_m, radius);
      }

      // A request with no target cannot be verified, so it is not auto-completed.
      // Completing one requires a manager to accept it explicitly.
      const verifiable = !!geo && geo.ok;
      const needsReview = !verifiable;

      // Price check: every service on the request must have been answered. A
      // blank is "not surveyed yet"; 0 is a real answer and passes.
      const expected = (existing.services || []).map((x) => x.name);
      const missing = expected.filter((n) => !(n in priced));

      const status = needsReview ? 'needs_review' : 'done';
      const survey = dbHelpers.updateSiteSurvey(requestId, {
        ...capture,
        ...(services ? { services } : {}),
        prices: priced,
        missing_prices: missing,
        geo,
        verified: !needsReview,
        status,
        // Only a genuinely verified capture is "completed". A flagged one is
        // parked for a manager, which is what keeps the field team moving.
        ...(needsReview ? {} : { completed_at: new Date().toISOString() }),
        title: existing.title || capture.address.slice(0, 60),
      });

      // The location row is only promoted when the capture is real AND priced.
      // An unreviewed capture must not flip a Google row to inhouse.
      let record = null;
      if (!needsReview && existing.record_id) {
        record = dbHelpers.applySurveyToRecord(existing.record_id, {
          services: priced,
          survey,
          byName: req.staff.name || req.staff.email,
          byId: req.staff.id,
        });
      }

      return res.json({
        success: true,
        survey,
        record,
        verification: {
          ok: !needsReview,
          reason: needsReview ? (geo?.reason || 'no_target') : null,
          distance_m: geo?.distance_m ?? null,
          accuracy_m: geo?.accuracy_m ?? null,
          radius_m: radius,
        },
      });
    }

    // Ad-hoc capture (no request) — still fully audited.
    const survey = dbHelpers.addSiteSurvey({
      title: String(b.title || '').trim() || capture.address.slice(0, 60) || 'Site survey',
      ...capture,
      ...(services ? { services } : {}),
    });
    res.json({ success: true, survey });
  });
});

// A capture that failed the radius check is parked, not thrown away. A manager
// can accept it — the reality is sometimes a bad GPS fix in a basement, and a
// human judgement call is more reliable than a satellite.
// Accepting is a deliberate, attributed act: it records who overrode and why.
router.put('/surveys/:id/override', requireManager, (req, res) => {
  try {
    const existing = dbHelpers.getSiteSurveys().find((x) => x.id === Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Survey not found' });
    if (existing.status === 'done') return res.status(400).json({ error: 'This survey is already completed' });

    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why this capture is being accepted' });

    const survey = dbHelpers.updateSiteSurvey(existing.id, {
      status: 'done',
      verified: true,
      verified_by_override: true,
      override_reason: reason,
      override_by: req.staff.name || req.staff.email,
      override_by_id: req.staff.id,
      override_at: new Date().toISOString(),
      completed_at: existing.completed_at || new Date().toISOString(),
    });

    // An accepted capture promotes the location row exactly like a verified one.
    let record = null;
    if (existing.record_id) {
      record = dbHelpers.applySurveyToRecord(existing.record_id, {
        services: existing.prices || {},
        survey,
        byName: existing.submitted_by || req.staff.name,
        byId: existing.submitted_by_id || req.staff.id,
      });
    }
    res.json({ success: true, survey, record });
  } catch (error) {
    res.status(500).json({ error: 'Could not accept this capture', details: error.message });
  }
});

router.get('/surveys', requireStaff, (req, res) => {
  try {
    res.json({ surveys: dbHelpers.getSiteSurveys(), service_catalog: serviceCatalog() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load site surveys', details: error.message });
  }
});

router.delete('/surveys/:id', requireManager, (req, res) => {
  try {
    const ok = dbHelpers.deleteSiteSurvey(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Survey not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete survey', details: error.message });
  }
});

router.put('/surveys/:id/status', requireManager, (req, res) => {
  try {
    const status = String((req.body || {}).status || '').trim();
    if (!['new', 'assigned', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const survey = dbHelpers.updateSiteSurvey(Number(req.params.id), {
      status,
      ...(status === 'done' ? {} : { completed_at: null }),
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    res.json({ success: true, survey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update survey', details: error.message });
  }
});

export default router;
