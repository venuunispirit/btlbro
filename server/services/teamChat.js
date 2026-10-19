import { dbHelpers } from '../db.js';

export function dmRoom(a, b) {
  const [x, y] = [Number(a), Number(b)].sort((n, m) => n - m);
  return `dm:${x}:${y}`;
}

export function canAccessRoom(user, room) {
  if (!user) return false;
  if (room === 'team') return true;
  const m = String(room || '').match(/^dm:(\d+):(\d+)$/);
  if (!m) return false;
  return [Number(m[1]), Number(m[2])].includes(Number(user.id));
}

export function listRooms(user) {
  const staff = (dbHelpers.getTeamMembers() || [])
    .filter((u) => Number(u.id) !== Number(user.id) && u.is_active !== false);
  return [
    { id: 'team', name: 'Team Chat', type: 'group', members: (dbHelpers.getTeamMembers() || []).length },
    ...staff.map((u) => ({
      id: dmRoom(user.id, u.id),
      name: u.name || u.email,
      type: 'dm',
      userId: u.id,
      role: u.role || '',
    })),
  ];
}

export function getMessages(room, limit = 200) {
  const msgs = dbHelpers.getTeamMessages(room) || [];
  return limit ? msgs.slice(-limit) : msgs;
}

export function sendMessage({ room, user, text }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Message text required');
  if (!canAccessRoom(user, room)) throw new Error('Not allowed in this room');
  return dbHelpers.addTeamMessage({
    room,
    sender_id: user.id,
    sender_name: user.name || user.email,
    text: t,
  });
}

export function initTeamChat(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
      const session = token ? dbHelpers.getSession(token) : null;
      const user = session ? dbHelpers.getUserById(session.user_id) : null;
      if (!user || !user.is_team || user.is_active === false) {
        return next(new Error('Staff sign-in required'));
      }
      socket.data.user = user;
      next();
    } catch (e) {
      next(e);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join('team');
    socket.join(`user:${user.id}`);
    for (const u of (dbHelpers.getTeamMembers() || [])) {
      if (Number(u.id) !== Number(user.id)) socket.join(dmRoom(user.id, u.id));
    }

    socket.on('send_message', (payload, cb) => {
      try {
        const msg = sendMessage({ room: payload?.room, user, text: payload?.text });
        io.to(payload.room).emit('new_message', msg);
        if (typeof cb === 'function') cb({ ok: true, message: msg });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('typing', (payload) => {
      const room = payload?.room;
      if (!canAccessRoom(user, room)) return;
      socket.to(room).emit('typing', {
        room,
        userId: user.id,
        name: user.name || user.email,
        isTyping: !!payload?.isTyping,
      });
    });
  });
}
