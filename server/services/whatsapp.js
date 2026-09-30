// WhatsApp Business API bridge (Meta Cloud API)
//
// Sends outbound messages from the company token number to customers.
// Receives inbound messages via webhook and routes them to conversations.
//
// Requires: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN in .env or settings.

import db, { dbHelpers } from '../db.js';
import { normalisePhone, findLeadByPhone } from './callRouter.js';

function getConfig() {
  const settings = dbHelpers.getSettings();
  return {
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || settings.whatsapp?.phone_number_id || '',
    access_token: process.env.WHATSAPP_ACCESS_TOKEN || settings.whatsapp?.access_token || '',
    api_version: 'v21.0',
  };
}

// Send a text message via WhatsApp
export async function sendTextMessage(to, text) {
  const config = getConfig();
  if (!config.phone_number_id || !config.access_token) {
    throw new Error('WhatsApp not configured');
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.api_version}/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9]/g, ''),
        type: 'text',
        text: { body: text },
      }),
    }
  );

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message || 'WhatsApp send failed');
  }
  return result;
}

// Verify Meta webhook (GET request)
export function verifyWebhook(mode, token, challenge) {
  const settings = dbHelpers.getSettings();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || settings.whatsapp?.verify_token || 'btlbro_verify';
  if (mode === 'subscribe' && token === verifyToken) {
    return challenge;
  }
  return null;
}

// Process inbound webhook payload (POST from Meta)
export function processInboundMessage(payload) {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.length) return null;

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    return {
      from: message.from,
      text: message.text?.body || '',
      type: message.type || 'text',
      message_id: message.id,
      timestamp: message.timestamp,
      customer_name: contact?.profile?.name || '',
    };
  } catch {
    return null;
  }
}

// Route inbound message to the right conversation
export function routeInboundMessage(inbound) {
  if (!inbound || !inbound.from) return null;

  // Meta hands us the sender in full international form ("919876500001"), while
  // a lead or a conversation we created earlier may hold "9876500001", "+91
  // 98765 00001" or "09876500001". getConversationByPhone is an exact string
  // compare, so matching on the raw value silently opened a duplicate thread
  // for a customer we already had. Everything downstream keys off the
  // normalised 10-digit form.
  const phone = normalisePhone(inbound.from) || String(inbound.from);

  // Find or create conversation by phone
  let conv = dbHelpers.getConversationByPhone(phone);
  if (!conv) {
    conv = dbHelpers.addConversation({
      customer_phone: phone,
      customer_name: inbound.customer_name || '',
      lead_id: null,
      messages: [],
    });
  }

  // Link to the lead this number belongs to. Without this the message lands in
  // the thread but never appears on the lead timeline, so whoever owns the
  // relationship has no way of seeing the customer replied. Reuse the same
  // matcher the call router uses so voice and WhatsApp agree on who this is.
  if (!conv.lead_id) {
    const lead = findLeadByPhone(phone);
    if (lead) {
      conv.lead_id = lead.id;
      if (!conv.customer_name && lead.contactName) conv.customer_name = lead.contactName;
      db.write();
    }
  }

  // Add message
  const msg = dbHelpers.addMessageToConversation(conv.id, {
    direction: 'in',
    text: inbound.text,
    type: inbound.type,
    message_id: inbound.message_id,
    status: 'received',
  });

  // Log activity on linked lead
  if (conv.lead_id) {
    dbHelpers.addLeadActivity(conv.lead_id, {
      type: 'chat',
      description: `WhatsApp message received: "${inbound.text.substring(0, 50)}${inbound.text.length > 50 ? '...' : ''}"`,
      actor: 'customer',
    });
  }

  return { conversation: conv, message: msg };
}

// Get WhatsApp status (is configured?)
export function getStatus() {
  const config = getConfig();
  const settings = dbHelpers.getSettings();
  return {
    enabled: !!(config.phone_number_id && config.access_token),
    phone_number_id: config.phone_number_id ? '***' + config.phone_number_id.slice(-4) : '',
    // Shown in the Chat tab so staff can see what number they are sending as.
    // The number itself is not editable here — it is owned by Meta, set when the
    // number was registered on the WhatsApp Business Account.
    business_name: settings.whatsapp?.business_name || 'BTLbro',
    display_number: settings.whatsapp?.display_number || '',
    // The one thing that cannot be added later by pasting a token: without a
    // public URL Meta cannot deliver replies, so the Chat tab stays one-way.
    webhook_url: process.env.WHATSAPP_WEBHOOK_URL || settings.whatsapp?.webhook_url || '',
  };
}
