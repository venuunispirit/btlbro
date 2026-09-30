import express from 'express';
import { dbHelpers } from '../db.js';
import { requireStaff } from '../middleware/staffAuth.js';
import { sendTextMessage, verifyWebhook, processInboundMessage, routeInboundMessage, getStatus } from '../services/whatsapp.js';

const router = express.Router();

// GET /api/admin/chat/inbox — list conversations (scoped by assignment)
router.get('/inbox', requireStaff, (req, res) => {
  try {
    let convs = dbHelpers.getConversations();
    const role = req.staff.role;
    const staffId = req.staff.id;

    // Attach lead info to each conversation
    convs = convs.map((c) => {
      const lead = c.lead_id ? dbHelpers.getLeadById(c.lead_id) : null;
      return { ...c, lead };
    });

    // Scope: bd_executive sees only their assigned lead conversations
    if (role === 'bd_executive') {
      convs = convs.filter((c) => c.lead && Number(c.lead.bd_exec_id) === Number(staffId));
    }
    // bdm sees their domain
    if (role === 'bdm') {
      convs = convs.filter((c) => c.lead && (Number(c.lead.bdm_id) === Number(staffId) || !c.lead.bdm_id));
    }
    // ops roles see only linked conversation (read-only, from orders)
    if (role === 'ops_executive' || role === 'ops_manager') {
      convs = convs.filter((c) => {
        if (!c.lead_id) return false;
        const order = (dbHelpers.getOrders() || []).find((o) => o.lead_id === c.lead_id);
        if (!order) return false;
        if (role === 'ops_executive') return Number(order.assigned_to) === Number(staffId);
        return true; // ops_manager sees all
      });
    }

    // Sort by most recent message
    convs.sort((a, b) => new Date(b.last_msg_at || 0) - new Date(a.last_msg_at || 0));

    res.json({ conversations: convs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load conversations', details: error.message });
  }
});

// NOTE ON ROUTE ORDER: the literal paths below are declared BEFORE '/:leadId'
// deliberately. Express matches in registration order and '/:leadId' swallows
// any single segment, so declaring it first captured '/status' and '/webhook' —
// the status check 404'd and Meta's webhook verification never reached its
// handler. Put any new literal route above this line, not below.

// GET /api/admin/chat/webhook — Meta webhook verification (public)
router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  const result = verifyWebhook(mode, token, challenge);
  if (result) {
    res.send(result);
  } else {
    res.sendStatus(403);
  }
});

// GET /api/admin/chat/status — WhatsApp config status
router.get('/status', requireStaff, (req, res) => {
  try {
    res.json(getStatus());
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status', details: error.message });
  }
});

export default router;

// GET /api/admin/chat/:leadId — get conversation for a lead
router.get('/:leadId', requireStaff, (req, res) => {
  try {
    const lead = dbHelpers.getLeadById(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    let conv = dbHelpers.getConversationByLeadId(req.params.leadId);
    if (!conv) {
      // Create empty conversation
      conv = dbHelpers.addConversation({
        lead_id: Number(req.params.leadId),
        customer_phone: lead.phone || '',
        customer_name: lead.contactName || '',
        messages: [],
      });
    }

    res.json({ conversation: conv });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load conversation', details: error.message });
  }
});

/**
 * Deliver one message and record what actually happened to it.
 *
 * The original version of this route wrote the message to our database, fired
 * the WhatsApp call without awaiting it, and immediately returned
 * { success: true }. With no credentials configured — which is exactly the
 * state we are in — that meant the thread quietly filled with outbound
 * messages that were never delivered, and the person typing saw no error at
 * all. It is the worst kind of bug: it looks like the feature works.
 *
 * So delivery happens before the response, and a failure is a failure.
 */
async function deliver(conv, { to, text, staff }) {
  // addMessageToConversation returns the conversation, not the message, so the
  // new row is the last one on it.
  const updated = dbHelpers.addMessageToConversation(conv.id, {
    direction: 'out',
    text,
    sender_id: staff.id,
    sender_name: staff.name || staff.email,
    status: 'pending',
  });
  const msg = updated?.messages?.slice(-1)[0] || null;

  try {
    const result = await sendTextMessage(to, text);
    if (msg) {
      dbHelpers.updateMessageStatus(conv.id, msg.id, {
        status: 'sent',
        provider_message_id: result?.messages?.[0]?.id || '',
        sent_at: new Date().toISOString(),
        error: '',
      });
    }
    return { ok: true, msg, provider: result };
  } catch (err) {
    if (msg) {
      dbHelpers.updateMessageStatus(conv.id, msg.id, {
        status: 'failed',
        error: err.message,
      });
    }
    return { ok: false, msg, error: err.message };
  }
}

/** Refuse to send while WhatsApp has no credentials, instead of failing silently. */
function whatsappGuard(res) {
  const status = getStatus();
  if (status.enabled) return true;
  res.status(503).json({
    error: 'WhatsApp is not connected yet',
    code: 'whatsapp_not_configured',
    details: 'Add a Meta phone_number_id and access token in Settings, then reload. Until then messages cannot be delivered.',
  });
  return false;
}

// POST /api/admin/chat/:leadId/send — send message (restricted on assignment)
router.post('/:leadId/send', requireStaff, async (req, res) => {
  try {
    const lead = dbHelpers.getLeadById(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Assignment check: bd_exec can only chat with their assigned leads
    const role = req.staff.role;
    if (role === 'bd_executive' && Number(lead.bd_exec_id) !== Number(req.staff.id)) {
      return res.status(403).json({ error: 'You can only chat with leads assigned to you' });
    }

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });
    if (!whatsappGuard(res)) return;

    // A lead with no phone cannot be messaged on WhatsApp, and saying so is
    // better than accepting the text and dropping it.
    const phone = String(lead.phone || '').replace(/\D/g, '');
    if (!phone) {
      return res.status(400).json({ error: 'This lead has no phone number', code: 'no_phone' });
    }

    // Find or create conversation
    let conv = dbHelpers.getConversationByLeadId(req.params.leadId);
    if (!conv) {
      conv = dbHelpers.addConversation({
        lead_id: Number(req.params.leadId),
        customer_phone: lead.phone || '',
        customer_name: lead.contactName || '',
        messages: [],
      });
    }

    const out = await deliver(conv, { to: phone, text: text.trim(), staff: req.staff });

    if (!out.ok) {
      console.warn('[Chat] WhatsApp send failed:', out.error);
      return res.status(502).json({
        error: 'WhatsApp rejected this message',
        code: 'whatsapp_send_failed',
        details: out.error,
      });
    }

    // Only logged as sent once it actually was.
    dbHelpers.addLeadActivity(req.params.leadId, {
      type: 'chat',
      description: `Message sent: "${text.trim().substring(0, 50)}${text.trim().length > 50 ? '...' : ''}"`,
      actor: req.staff.name || req.staff.email,
    });

    res.json({ success: true, message: out.msg });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// POST /api/admin/chat/conversation/:id/send — reply to a conversation that has
// no lead behind it.
//
// The inbox is full of threads from customers who messaged us before we ever
// had a lead for them, and the lead-scoped route above cannot reach those: it
// looks the phone up on the lead. The conversation already carries the number,
// so replying needs nothing else.
router.post('/conversation/:id/send', requireStaff, async (req, res) => {
  try {
    const conv = (dbHelpers.getConversations() || []).find((c) => c.id === Number(req.params.id));
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // If it IS linked to a lead, the assignment rules still apply — otherwise
    // this route would be a way around them.
    if (conv.lead_id) {
      const lead = dbHelpers.getLeadById(conv.lead_id);
      if (req.staff.role === 'bd_executive' && lead && Number(lead.bd_exec_id) !== Number(req.staff.id)) {
        return res.status(403).json({ error: 'You can only chat with leads assigned to you' });
      }
    }

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });
    if (!whatsappGuard(res)) return;

    const phone = String(conv.customer_phone || '').replace(/\D/g, '');
    if (!phone) {
      return res.status(400).json({ error: 'This conversation has no phone number', code: 'no_phone' });
    }

    const out = await deliver(conv, { to: phone, text: text.trim(), staff: req.staff });
    if (!out.ok) {
      console.warn('[Chat] WhatsApp send failed:', out.error);
      return res.status(502).json({
        error: 'WhatsApp rejected this message',
        code: 'whatsapp_send_failed',
        details: out.error,
      });
    }

    if (conv.lead_id) {
      dbHelpers.addLeadActivity(conv.lead_id, {
        type: 'chat',
        description: `Message sent: "${text.trim().substring(0, 50)}${text.trim().length > 50 ? '...' : ''}"`,
        actor: req.staff.name || req.staff.email,
      });
    }

    res.json({ success: true, message: out.msg });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// POST /api/admin/chat/webhook — Meta WhatsApp webhook (public, no auth)
router.post('/webhook', express.json(), (req, res) => {
  try {
    const inbound = processInboundMessage(req.body);
    if (inbound) {
      routeInboundMessage(inbound);
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(200); // Always 200 for webhooks
  }
});
