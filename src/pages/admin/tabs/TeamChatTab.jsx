import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Send, MessageSquare, Users, ChevronLeft, RefreshCw, Circle } from 'lucide-react';
import { getStaffUser, getToken, api as adminApi } from '../api.js';
import { useFeedback } from '../components/Feedback.jsx';
import { c, ui, radius, font } from '../theme.js';

export default function TeamChatTab() {
  const { toast, notify } = useFeedback();
  const [rooms, setRooms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [sending, setSending] = useState(false);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const selectedRef = useRef(null);
  const currentUser = getStaffUser();

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi('/api/admin/internal-chat/rooms');
      setRooms(res.rooms || []);
      if (!selectedRef.current && (res.rooms || []).length) {
        setSelected(res.rooms[0]);
      }
    } catch (e) {
      notify(e.message || 'Failed to load rooms');
    }
    setLoading(false);
  }, [notify]);

  const loadMessages = useCallback(async (room) => {
    if (!room) return;
    try {
      const res = await adminApi(`/api/admin/internal-chat/messages?room=${encodeURIComponent(room.id)}`);
      setMessages(res.messages || []);
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (selected) loadMessages(selected);
  }, [selected, loadMessages]);

  // Socket connection
  useEffect(() => {
    const token = getToken();
    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('new_message', (msg) => {
      const sel = selectedRef.current;
      if (sel && msg.room === sel.id) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
      // bump room list ordering not needed
    });
    socket.on('typing', (p) => {
      const sel = selectedRef.current;
      if (sel && p.room === sel.id && p.userId !== currentUser?.id) {
        if (p.isTyping) {
          setTypingUser(p.name);
          clearTimeout(window.__typingTimer);
          window.__typingTimer = setTimeout(() => setTypingUser(null), 2000);
        } else {
          setTypingUser(null);
        }
      }
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUser]);

  async function handleSend() {
    if (!input.trim() || !selected || sending) return;
    const text = input.trim();
    setSending(true);
    setInput('');
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('send_message', { room: selected.id, text }, (ack) => {
        setSending(false);
        if (ack?.ok && ack.message) {
          setMessages((prev) => (prev.some((m) => m.id === ack.message.id) ? prev : [...prev, ack.message]));
        } else {
          notify(ack?.error || 'Could not send');
          setInput(text);
        }
      });
    } else {
      try {
        const res = await adminApi('/api/admin/internal-chat/send', {
          method: 'POST',
          body: JSON.stringify({ room: selected.id, text }),
        });
        setMessages((prev) => (prev.some((m) => m.id === res.message?.id) ? prev : [...prev, res.message]));
      } catch (e) {
        notify(e.message || 'Could not send');
        setInput(text);
      }
      setSending(false);
    }
  }

  function handleTyping(val) {
    setInput(val);
    const socket = socketRef.current;
    if (socket && socket.connected && selected) {
      socket.emit('typing', { room: selected.id, isTyping: !!val });
    }
  }

  const avatarFor = (room) => {
    if (room.type === 'group') return 'T';
    return (room.name || '?').charAt(0).toUpperCase();
  };

  return (
    <div className="chat-shell" data-has-conv={selected ? 'true' : 'false'} style={{ display: 'flex', height: 'calc(100vh - 168px)', minHeight: 0, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E7E2D8' }}>
      {/* Room list */}
      <div className="chat-list" style={{ width: 280, borderRight: '1px solid #E7E2D8', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
        <div style={{ padding: 14, borderBottom: '1px solid #E7E2D8', display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={18} color="#F2701D" />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Team Chat</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: connected ? '#10B981' : '#949494' }}>
            <Circle size={8} fill={connected ? '#10B981' : '#949494'} stroke="none" />
            {connected ? 'live' : 'offline'}
          </span>
          <button onClick={loadRooms} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#949494' }}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#949494', fontSize: 12 }}>Loading…</div>
          ) : rooms.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#949494', fontSize: 12 }}>No rooms</div>
          ) : (
            rooms.map((r) => (
              <div key={r.id} onClick={() => setSelected(r)} style={{
                padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #F1EDE4',
                background: selected?.id === r.id ? '#FFF4EC' : '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: r.type === 'group' ? '#161616' : '#F2701D', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {avatarFor(r)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#949494' }}>
                      {r.type === 'group' ? `${r.members || 0} members` : (r.role || 'staff')}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="chat-thread" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }} data-chat-thread>
        {selected ? (
          <>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E7E2D8', display: 'flex', alignItems: 'center', gap: 10, background: '#FAF9F7' }}>
              <button onClick={() => setSelected(null)} className="chat-back" style={{ padding: 4, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#949494' }}>
                <ChevronLeft size={18} />
              </button>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: selected.type === 'group' ? '#161616' : '#F2701D', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                {avatarFor(selected)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: '#949494' }}>{selected.type === 'group' ? 'All team members' : 'Direct message'}</div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#949494', fontSize: 13, marginTop: 40 }}>No messages yet. Start the conversation.</div>
              )}
              {messages.map((m) => {
                const isMe = Number(m.sender_id) === Number(currentUser?.id);
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
                      background: isMe ? c.accent : c.sunken,
                      color: isMe ? '#fff' : c.text,
                      fontSize: 13, lineHeight: 1.5,
                    }}>
                      {!isMe && <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.7, marginBottom: 2 }}>{m.sender_name}</div>}
                      <div>{m.text}</div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingUser && (
                <div style={{ fontSize: 11, color: '#949494', fontStyle: 'italic' }}>{typingUser} is typing…</div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div style={{ padding: 12, borderTop: `1px solid ${c.border}`, background: c.card, display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder="Type a message…"
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: radius.sm, fontSize: 13, fontFamily: font.sans,
                  border: `1.5px solid ${c.border}`, background: c.card, color: c.text, outline: 'none',
                }} />
              <button onClick={handleSend} disabled={sending || !input.trim()}
                style={{
                  padding: '10px 16px', borderRadius: radius.sm, border: 'none',
                  background: input.trim() ? c.accent : c.sunken,
                  color: input.trim() ? '#fff' : c.disabled,
                  cursor: sending ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, fontFamily: font.sans,
                }}>
                <Send size={14} /> {sending ? '…' : 'Send'}
              </button>
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
