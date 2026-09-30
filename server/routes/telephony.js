import express from 'express';
import { requireStaff } from '../middleware/staffAuth.js';
import {
  clickToCall, handleInboundWebhook, handleNoAnswerWebhook,
  handleStatusCallback, getStatus, routingHealth,
} from '../services/telephony.js';
import { resolveRoute } from '../services/callRouter.js';

const router = express.Router();

// POST /api/telephony/call — click-to-call
router.post('/call', requireStaff, async (req, res) => {
  try {
    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });
    const result = await clickToCall(lead_id, req.staff.id);
    res.json({ success: true, call_sid: result.sid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telephony/inbound — Twilio webhook (public, no auth)
router.post('/inbound', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const twiml = handleInboundWebhook(req.body);
    res.type('text/xml').send(twiml);
  } catch {
    res.type('text/xml').send('<Response><Say>Service unavailable</Say></Response>');
  }
});

// POST /api/telephony/status — Twilio status callback (public)
router.post('/status', express.urlencoded({ extended: false }), (req, res) => {
  try {
    handleStatusCallback(req.body);
    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

// The no-answer hook. Twilio fires this on the <Dial> when nobody picked up;
// it is the only place a missed call can be recorded, because by then the
// inbound webhook has already returned its TwiML.
router.post('/no-answer', express.urlencoded({ extended: false }), (req, res) => {
  try {
    handleNoAnswerWebhook(req.body);
    res.type('text/xml').send('<Response/>');
  } catch {
    res.type('text/xml').send('<Response/>');
  }
});

// Who would ring for this number — a dry run of the routing, so an admin can
// check the rule without placing a real call.
router.post('/preview', requireStaff, (req, res) => {
  try {
    const { lead, targets, reason } = resolveRoute(req.body?.from);
    res.json({
      reason,
      lead: lead ? { id: lead.id, name: lead.contactName || lead.business_name || `Lead #${lead.id}` } : null,
      ring_order: targets.map((t, i) => ({ order: i + 1, name: t.name, role: t.role, number: t.number, via: t.via })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telephony/connect-caller — provider action once someone answers
router.post('/connect-caller', express.urlencoded({ extended: false }), (req, res) => {
  try {
    res.type('text/xml').send('<Response><Say>Connecting you. Please hold.</Say></Response>');
  } catch {
    res.type('text/xml').send('<Response><Say>Connection failed</Say></Response>');
  }
});

// GET /api/telephony/status-info — get telephony config status
router.get('/status-info', requireStaff, (req, res) => {
  try {
    // The old shape was {enabled, provider, from_number}, which could not tell
    // an admin *why* nothing was routing. The health report says what is
    // missing and who has no number.
    res.json({ ...getStatus(), ...routingHealth() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
