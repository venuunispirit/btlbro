import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import googleDriveRoutes from './routes/googleDrive.js';
import sheetSyncRoutes from './routes/sheetSync.js';
import ordersRoutes from './routes/orders.js';
import settingsRoutes from './routes/settings.js';
import placesRoutes from './routes/places.js';
import authRoutes from './routes/auth.js';
import shopRoutes from './routes/shop.js';
import teamRoutes from './routes/team.js';
import cmsRoutes from './routes/cms.js';
import publicCmsRoutes from './routes/publicCms.js';
import uploadRoutes from './routes/upload.js';
import { startScheduler } from './services/scheduler.js';
import { adminAuth } from './middleware/adminAuth.js';
import { ensureSuperAdmin } from './bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
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
app.listen(PORT, () => {
  console.log(`\n🚀 BTL Bro API Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌐 Public content: http://localhost:${PORT}/api/content`);
  console.log(`📦 Public products: http://localhost:${PORT}/api/products`);
  console.log(`\n⏰ Starting auto-sync scheduler...\n`);

  // Start the scheduler
  startScheduler();

  // First-run: ensure a Super Admin exists from env, so the panel is reachable
  const admin = ensureSuperAdmin();
  console.log(admin
    ? `👤 Super Admin ready: ${admin.email}`
    : `⚠️  No super admin configured. Set ADMIN_EMAIL / ADMIN_PASSWORD in server/.env to create one.`);
});

export default app;
