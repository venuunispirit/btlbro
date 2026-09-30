import React, { useState, useEffect, useRef } from 'react';
import { Send, Phone, MessageSquare, ChevronLeft, RefreshCw, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { getStaffUser, api as adminApi } from '../api.js';
import { useGlobalSearch } from '../useGlobalSearch.js';
import { useFeedback } from '../components/Feedback.jsx';
import { c, ui, radius, font } from '../theme.js';
import { TEMPLATES, buildMessage } from '../whatsapp.js';

export default function ChatTab({ target }) {
  const { toast, notify } = useFeedback();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  // Whether Meta has actually accepted our credentials. Until it has, the send
  // button is dead — see ConnectionBanner.
  const [wa, setWa] = useState({ enabled: false, loaded: false });
  const search = useGlobalSearch();
  const messagesEndRef = useRef(null);
  const currentUser = getStaffUser();

  useEffect(() => { loadInbox(); loadStatus(); }, []);

  async function loadStatus() {
    try {
      const st = await adminApi('/api/admin/chat/status');
      setWa({ ...st, loaded: true });
    } catch {
      setWa({ enabled: false, loaded: true });
    }
  }

  async function loadInbox() {
    setLoading(true);
    try {
      const res = await adminApi('/api/admin/chat/inbox');
      setConversations(res.conversations || []);
    } catch {}
    setLoading(false);
  }

  async function selectConversation(conv) {
    setSelectedConv(conv);
    try {
      const res = await adminApi(`/api/admin/chat/${conv.lead_id || conv.id}`);
      setMessages(res.conversation?.messages || []);
    } catch { setMessages([]); }
  }

  async function handleSend() {
    if (!newMessage.trim() || !selectedConv) return;
    setSending(true);
    try {
      // Always send by conversation id. The lead-scoped route cannot reach a
      // thread that has no lead behind it, and the inbox is full of those.
      await adminApi(`/api/admin/chat/conversation/${selectedConv.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ text: newMessage }),
      });
      setNewMessage('');
      const res = await adminApi(`/api/admin/chat/${selectedConv.lead_id || selectedConv.id}`);
      setMessages(res.conversation?.messages || []);
      loadInbox();
      toast('Sent');
    } catch (err) {
      // A silent failure here used to look like success, so say what happened.
      notify(err.message || 'Could not send');
      loadStatus();
    }
    setSending(false);
  }

  async function handleCall(leadId) {
    try {
      await adminApi('/api/telephony/call', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      });
      toast('Call initiated');
    } catch (err) { notify(err.message); }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Leads/Orders/Companies send you here with a lead id so "Message" lands on
  // the right conversation instead of an empty inbox.
  useEffect(() => {
    if (!target?.leadId || conversations.length === 0) return;
    const match = conversations.find(
      (c) => Number(c.lead_id) === Number(target.leadId) || Number(c.id) === Number(target.leadId)
    );
    if (match && match.id !== selectedConv?.id) selectConversation(match);
  }, [target, conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Template chips fill the box; they never send on their own.
  function applyTemplate(id) {
    const c = selectedConv;
    setNewMessage(buildMessage(id, {
      name: c?.lead?.contactName || c?.customer_name || '',
      business: c?.lead?.businessName || '',
      amount: c?.lead?.amount_pending || 0,
    }));
  }

  const filteredConvs = conversations.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = c.lead?.contactName || c.customer_name || '';
    const phone = c.customer_phone || '';
    return name.toLowerCase().includes(q) || phone.includes(q);
  });

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 140px)', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E7E2D8' }}>
      {/* Conversation list */}
      <div style={{ width: 320, borderRight: '1px solid #E7E2D8', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
<div style={{ padding: 14, borderBottom: '1px solid #E7E2D8' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: search ? 10 : 0 }}>
              <MessageSquare size={18} color="#F2701D" />
              <span style={{ fontWeight: 700, fontSize: 15, marginLeft: 8 }}>Chat Inbox</span>
              <button onClick={loadInbox} style={{ marginLeft: 'auto', padding: 4, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#949494' }}>
                <RefreshCw size={14} />
              </button>
            </div>
            {search && (
              <div style={{ fontSize: 11.5, color: '#F2701D', marginTop: 6, fontWeight: 600 }}>
                Filtering by “{search}” (use the top search bar)
              </div>
            )}
          </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#949494', fontSize: 12 }}>Loading…</div>
          ) : filteredConvs.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#949494', fontSize: 12 }}>No conversations</div>
          ) : (
            filteredConvs.map(c => (
              <div key={c.id} onClick={() => selectConversation(c)} style={{
                padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #F1EDE4',
                background: selectedConv?.id === c.id ? '#FFF4EC' : '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F2701D', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {(c.lead?.contactName || c.customer_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.lead?.contactName || c.customer_name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: '#949494' }}>{c.customer_phone || ''}</div>
                    {c.lead?.category && (
                      <div style={{ fontSize: 10, color: '#949494', marginTop: 1 }}>{c.lead.category}</div>
                    )}
                  </div>
                  {c.last_msg_at && (
                    <div style={{ fontSize: 10, color: '#949494', whiteSpace: 'nowrap' }}>
                      {new Date(c.last_msg_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedConv ? (
          <>
            {/* Chat header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E7E2D8', display: 'flex', alignItems: 'center', gap: 10, background: '#FAF9F7' }}>
              <button onClick={() => setSelectedConv(null)} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#949494' }}>
                <ChevronLeft size={18} />
              </button>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#F2701D', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                {(selectedConv.lead?.contactName || selectedConv.customer_name || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedConv.lead?.contactName || selectedConv.customer_name || 'Unknown'}</div>
                <div style={{ fontSize: 11, color: '#949494' }}>{selectedConv.customer_phone || ''}</div>
              </div>
              {selectedConv.lead_id && (
                <button onClick={() => handleCall(selectedConv.lead_id)} style={{ padding: 6, borderRadius: 6, border: '1px solid #E7E2D8', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <Phone size={14} /> Call
                </button>
              )}
            </div>

            <ConnectionBanner wa={wa} />

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#949494', fontSize: 13, marginTop: 40 }}>No messages yet. Start the conversation below.</div>
              )}
              {messages.map((m) => {
                const isOut = m.direction === 'out';
                const isSystem = m.direction === 'system';
                // A message Meta rejected must never look like a delivered one.
                const failed = isOut && m.status === 'failed';
                if (isSystem) {
                  return (
                    <div key={m.id} style={{ textAlign: 'center', fontSize: 11, color: '#949494', padding: '4px 0' }}>
                      {m.text}
                    </div>
                  );
                }
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
                      background: failed ? c.dangerBg : isOut ? c.accent : c.sunken,
                      color: failed ? c.dangerFg : isOut ? '#fff' : c.text,
                      border: failed ? `1px solid ${c.dangerBorder}` : 'none',
                      fontSize: 13, lineHeight: 1.5,
                    }}>
                      <div>{m.text}</div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4, textAlign: 'right', display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {m.sender_name && !isOut ? `${m.sender_name} · ` : ''}
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {failed && <strong style={{ fontWeight: 700 }}>· not delivered</strong>}
                        {isOut && m.status === 'sent' && <span>· delivered</span>}
                      </div>
                      {failed && m.error && (
                        <div style={{ fontSize: 10.5, marginTop: 5, opacity: 0.9 }}>{m.error}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer. Sending is blocked outright while WhatsApp is
                unconfigured — the alternative was a message that looks sent and
                is never delivered. */}
            <div style={{ padding: 12, borderTop: `1px solid ${c.border}`, background: c.card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: c.muted, marginRight: 2 }}>
                  <Sparkles size={11} /> Templates
                </span>
                {TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t.id)} title={`Insert "${t.label}"`}
                    style={{
                      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: `1px solid ${c.border}`, background: c.sunken, color: c.body, fontFamily: font.sans,
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={wa.enabled ? 'Type a message…' : 'Connect WhatsApp in Settings to send'}
                  disabled={!wa.enabled}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: radius.sm, fontSize: 13, fontFamily: font.sans,
                    border: `1.5px solid ${c.border}`, background: wa.enabled ? c.card : c.sunken,
                    color: wa.enabled ? c.text : c.disabled, outline: 'none',
                  }} />
                <button onClick={handleSend} disabled={sending || !newMessage.trim() || !wa.enabled}
                  style={{
                    padding: '10px 16px', borderRadius: radius.sm, border: 'none',
                    background: newMessage.trim() && wa.enabled ? c.accent : c.sunken,
                    color: newMessage.trim() && wa.enabled ? '#fff' : c.disabled,
                    cursor: sending || !wa.enabled ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: font.sans,
                  }}>
                  <Send size={14} /> {sending ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#949494', fontSize: 14 }}>
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tells the truth about whether messages can actually leave the building.
 *
 * Meta needs a phone_number_id and a token before a single message can be sent,
 * and neither exists yet. Without this banner the Chat tab looks complete: you
 * can type, the button is live, and the message goes nowhere. That failure is
 * invisible until a customer notices they were never contacted.
 */
function ConnectionBanner({ wa }) {
  // Don't flash a "not connected" warning before the status call has answered.
  if (!wa.loaded) return null;

  if (wa.enabled) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', background: c.okBg, borderBottom: `1px solid ${c.okBorder}`, fontSize: 11.5, color: c.okFg, fontWeight: 600 }}>
        <CheckCircle2 size={13} />
        WhatsApp connected
        {wa.display_number && <> · sending as {wa.display_number}</>}
        {wa.business_name && <> · {wa.business_name}</>}
        {!wa.webhook_url && (
          <span style={{ marginLeft: 6, fontWeight: 500, color: c.warnFg }}>
            · no webhook URL, so replies will not come back into this tab
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 16px', background: c.warnBg, borderBottom: `1px solid ${c.warnBorder}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 650, color: c.warnFg }}>
        <AlertTriangle size={14} /> WhatsApp is not connected — sending is disabled
      </div>
      <div style={{ fontSize: 11.5, color: c.body, marginTop: 3, lineHeight: 1.5 }}>
        Messages you type here cannot be delivered yet. In Meta, register a WhatsApp
        Business Account for <strong>6366870248</strong>, then paste its
        phone_number_id and access token into <strong>Settings → WhatsApp Business API</strong>.
        Until that is done this tab is a local notebook, not a messaging channel.
      </div>
    </div>
  );
}
