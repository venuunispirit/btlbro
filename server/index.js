import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import googleDriveRoutes from './routes/googleDrive.js';
import sheetSyncRoutes from './routes/sheetSync.js';
import ordersRoutes from './routes/orders.js';
import vendorsRoutes from './routes/vendors.js';
import purchaseOrderRoutes from './routes/purchaseOrders.js';
import notificationRoutes from './routes/notifications.js';
import leadsRoutes from './routes/leads.js';
import settingsRoutes from './routes/settings.js';
import placesRoutes from './routes/places.js';
import authRoutes from './routes/auth.js';
import shopRoutes from './routes/shop.js';
import teamRoutes from './routes/team.js';
import cmsRoutes from './routes/cms.js';
import publicCmsRoutes from './routes/publicCms.js';
import uploadRoutes from './routes/upload.js';
import paymentsRoutes from './routes/payments.js';
import upiPaymentsRoutes, { callbackRouter as upiCallbackRoutes } from './routes/upiPayments.js';
import checkoutRoutes from './routes/checkout.js';
import chatRoutes from './routes/chat.js';
import internalChatRoutes from './routes/internalChat.js';
import companiesRoutes from './routes/companies.js';
import telephonyRoutes from './routes/telephony.js';
import departmentsRoutes from './routes/departments.js';
import receeRoutes from './routes/recee.js';
import { startScheduler } from './services/scheduler.js';
import { install as installNotifier } from './services/notify.js';
import { adminAuth } from './middleware/adminAuth.js';
import { ensureSuperAdmin, migrateCustomerRoles } from './bootstrap.js';
import { initTeamChat } from './services/teamChat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 8081;
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: ['http://localhost:5174','http://localhost:3000','http://127.0.0.1:5174'], credentials: true },
});
app.set('io', io);

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: ['http://localhost:5174', 'http://localhost:3000', 'http://127.0.0.1:5174'],
  credentials: true,
}));
// Public PayU callback. Mounted BEFORE express.json() because PayU may POST a
// base64-encoded body that the JSON parser would not read, and the raw bytes
// are needed to verify the hash. Auth lives in the handler, not a session.
app.use('/api/payments/callback', express.raw({ type: () => true, limit: '256kb' }), upiCallbackRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== API ROUTES ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Google Drive Integration routes
app.use('/api/admin/google-drive', adminAuth, googleDriveRoutes);

// Google Sheet → Database sync routes
app.use('/api/admin', adminAuth, sheetSyncRoutes);

// Customer orders (persisted in db.json)
app.use('/api/orders', ordersRoutes);
// Vendors: /api/vendors/* is the vendor's own portal, /api/admin/vendors/* is staff.
app.use('/api', vendorsRoutes);

// Purchase Orders: committing to a vendor before anything is owed.
app.use('/api', purchaseOrderRoutes);

// Staff notification feed (the topbar bell).
app.use('/api', notificationRoutes);

// Leads (CRM pipeline — checkout creates leads, not orders)
app.use('/api/leads', leadsRoutes);

// Payments (Razorpay)
app.use('/api/payments', paymentsRoutes);

// Admin UPI money movements — send/receive ledger for the Payments tab (manager+)
app.use('/api/admin/payments', upiPaymentsRoutes);

// Public checkout payment (marketing funnel → lead + collection request)
app.use('/api/checkout', checkoutRoutes);

// Admin settings (persisted in db.json)
app.use('/api/settings', settingsRoutes);

// Team management (internal staff accounts with roles)
app.use('/api/admin/team', teamRoutes);

// Website management: content blocks, products, inline record editing
app.use('/api/admin', cmsRoutes);

// Image upload for website management (saved to server/uploads)
app.use('/api/admin/upload', uploadRoutes);

// Public CMS routes (no auth — the frontend reads content & products from here)
app.use('/api', publicCmsRoutes);

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Google Places autocomplete (public, customer-facing)
app.use('/api/places', placesRoutes);

// WhatsApp chat (admin)
app.use('/api/admin/chat', chatRoutes);

// Internal team chat (socket.io backed)
app.use('/api/admin/internal-chat', internalChatRoutes);

// Customer accounts / companies (the CRM spine — leads, chat, payments rollup)
app.use('/api/admin/companies', companiesRoutes);

// Telephony (Twilio — click-to-call + inbound)
app.use('/api/telephony', telephonyRoutes);

// Departments (org structure)
app.use('/api/admin/departments', departmentsRoutes);

// Site surveys (recee team) — geolocation + photos → admin review
app.use('/api/recee', receeRoutes);

// Customer accounts (register/login) for the Products shop
app.use('/api/auth', authRoutes);

// Shop: per-user cart, wishlist, checkout (Razorpay / pay-on-confirmation)
app.use('/api/shop', shopRoutes);

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ========== START SERVER ==========
// Wire payment notifications to their delivery channels. Without this the feed
// still records events, nothing is ever sent.
installNotifier();

initTeamChat(io);

server.listen(PORT, () => {
  console.log(`\n🚀 BTL Bro API Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Public content: http://localhost:${PORT}/api/content`);
  console.log(`📦 Public products: http://localhost:${PORT}/api/products`);
  console.log(`\n⏰ Starting auto-sync scheduler...\n`);

  // Start the scheduler
  startScheduler();

  // First-run: ensure a Super Admin exists from env, so the panel is reachable
  const admin = ensureSuperAdmin();
  migrateCustomerRoles();
  console.log(admin
    ? `👤 Super Admin ready: ${admin.email}`
    : `⚠️  No super admin configured. Set ADMIN_EMAIL / ADMIN_PASSWORD in server/.env to create one.`);
});

export default app;
