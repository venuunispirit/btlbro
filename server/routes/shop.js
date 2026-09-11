// ============================================================
// Shop API — per-user cart & wishlist + checkout (Razorpay).
//
//   GET    /api/shop/cart            → current user's cart
//   POST   /api/shop/cart            → replace cart (bulk merge from guest/local)
//   POST   /api/shop/cart/item       → upsert one item {product_id, size_label, qty, addons[], unit_price, name}
//   DELETE /api/shop/cart/item/:key  → remove one item (key = product|size|qty|addons hash)
//   GET    /api/shop/wishlist        → current user's wishlist
//   POST   /api/shop/wishlist        → toggle one product {product_id, name, base}
//   POST   /api/shop/checkout        → create payment order (Razorpay or fallback)
//
// All state lives in db.json keyed by user id — a user's cart follows them
// across devices. Guests keep their cart in localStorage; it's merged on login
// (POST /api/shop/cart with the local items) and cleared client-side after.
// ============================================================

import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

// ---------- Cart ----------
router.get('/cart', (req, res) => {
  res.json({ cart: dbHelpers.getCart(req.user.id) });
});

router.post('/cart', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  dbHelpers.setCart(req.user.id, items);
  res.json({ cart: dbHelpers.getCart(req.user.id) });
});

router.post('/cart/item', (req, res) => {
  const { product_id, size_label, qty, addons, unit_price, name } = req.body || {};
  if (!product_id || !size_label || !qty) return res.status(400).json({ error: 'product_id, size_label, qty required' });
  const cart = dbHelpers.getCart(req.user.id);
  const addonKey = (addons || []).slice().sort().join(',');
  const key = `${product_id}|${size_label}|${qty}|${addonKey}`;
  const next = cart.filter((i) => i.key !== key);
  next.push({ key, product_id, size_label, qty, addons: addons || [], unit_price, name });
  dbHelpers.setCart(req.user.id, next);
  res.json({ cart: next });
});

router.delete('/cart/item/:key', (req, res) => {
  const next = dbHelpers.getCart(req.user.id).filter((i) => i.key !== req.params.key);
  dbHelpers.setCart(req.user.id, next);
  res.json({ cart: next });
});

// ---------- Orders ----------
router.get('/orders', (req, res) => {
  const orders = dbHelpers.getShopOrdersByUser(req.user.id);
  res.json({ orders });
});

// ---------- Wishlist ----------
router.get('/wishlist', (req, res) => {
  res.json({ wishlist: dbHelpers.getWishlist(req.user.id) });
});

router.post('/wishlist', (req, res) => {
  const { product_id, name, base } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const list = dbHelpers.getWishlist(req.user.id);
  const exists = list.some((w) => w.product_id === product_id);
  const next = exists ? list.filter((w) => w.product_id !== product_id) : [...list, { product_id, name, base, added_at: new Date().toISOString() }];
  dbHelpers.setWishlist(req.user.id, next);
  res.json({ wishlist: next, added: !exists });
});

// ---------- Checkout ----------
// Razorpay order when keys are configured; otherwise a graceful
// "pay_on_confirmation" fallback (order saved, team confirms payment
// manually — same flow as the existing ₹999 QuickCheckout).
router.post('/checkout', (req, res) => {
  try {
    const { items, address, notes } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    const subtotal = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.qty) || 1), 0);
    const gst = Math.round(subtotal * 0.18);
    const total = subtotal + gst;

    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    const gateway = keyId && keySecret ? 'razorpay' : 'pay_on_confirmation';

    const order = dbHelpers.addShopOrder({
      user_id: req.user.id,
      user: { id: req.user.id, name: req.user.name, email: req.user.email },
      items,
      address,
      notes,
      subtotal,
      gst,
      total,
      gateway,
      payment_status: gateway === 'razorpay' ? 'pending' : 'on_confirmation',
      status: 'placed',
    });

    if (gateway === 'razorpay') {
      // Create a Razorpay order via their REST API (no SDK needed)
      fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
        },
        body: JSON.stringify({
          amount: total * 100, // paise
          currency: 'INR',
          receipt: `btl_${order.id}`,
          notes: { btl_order_id: String(order.id), user: req.user.email },
        }),
      })
        .then((r) => r.json())
        .then(async (rzp) => {
          if (rzp.id) {
            dbHelpers.updateShopOrder(order.id, { gateway_order_id: rzp.id, gateway: 'razorpay' });
          }
        })
        .catch(() => { /* order still saved; retry possible */ });

      return res.json({
        gateway: 'razorpay',
        key_id: keyId, // public key — safe to expose to the browser
        amount: total * 100,
        currency: 'INR',
        order_id: order.id,
        razorpay_order_id: order.gateway_order_id || null, // may not be set yet on first call
        user: { name: req.user.name, email: req.user.email },
      });
    }

    res.json({
      gateway: 'pay_on_confirmation',
      order_id: order.id,
      total, subtotal, gst,
      message: 'Order placed. Our team will call you to confirm and collect payment.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Checkout failed', details: error.message });
  }
});

// Verify Razorpay checkout signature → mark order paid
router.post('/checkout/verify', requireAuth, (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, btl_order_id } = req.body || {};
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keySecret) return res.status(400).json({ error: 'Razorpay not configured' });

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }
    dbHelpers.updateShopOrder(Number(btl_order_id), {
      payment_status: 'paid',
      status: 'paid',
      gateway_payment_id: razorpay_payment_id,
      paid_at: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Verification failed', details: error.message });
  }
});

export default router;
