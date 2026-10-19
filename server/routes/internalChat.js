import express from 'express';
import { dbHelpers } from '../db.js';
import { requireStaff } from '../middleware/staffAuth.js';
import { listRooms, getMessages, sendMessage, canAccessRoom } from '../services/teamChat.js';

const router = express.Router();

router.get('/rooms', requireStaff, (req, res) => {
  try {
    res.json({ rooms: listRooms(req.staff) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/messages', requireStaff, (req, res) => {
  try {
    const room = req.query.room;
    if (!canAccessRoom(req.staff, room)) return res.status(403).json({ error: 'Not allowed' });
    res.json({ messages: getMessages(room) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/send', requireStaff, (req, res) => {
  try {
    const { room, text } = req.body || {};
    const msg = sendMessage({ room, user: req.staff, text });
    const io = req.app.get('io');
    if (io) io.to(room).emit('new_message', msg);
    res.json({ success: true, message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
