import express from 'express';
import crypto from 'crypto';
import { dbHelpers } from '../db.js';

const router = express.Router();

function getRazorpayConfig() {
  const settings = dbHelpers.getSettings();
  return {
    key_id: process.env.RAZORPAY_KEY_ID || settings.payment?.key_id || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || settings.payment?.key_secret || '',
    enabled: settings.payment?.gateway_enabled || false,
    currency: settings.payment?.currency || 'INR',
  };
}

// POST /api/payments/create-order — create a Razorpay order for the booking fee
router.post('/create-order', async (req, res) => {
  try {
    const config = getRazorpayConfig();
    if (!config.enabled || !config.key_id || !config.key_secret) {
      return res.status(400).json({ error: 'Payment gateway not configured' });
    }

    const { amount, currency, receipt } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    // Razorpay expects amount in paise (smallest unit)
    const amountPaise = Math.round(Number(amount) * 100);

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(config.key_id + ':' + config.key_secret).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: currency || config.currency,
        receipt: receipt || `lead_${Date.now()}`,
      }),
    });

    const order = await response.json();
    if (order.error) return res.status(502).json({ error: order.error.description || 'Razorpay error' });

    res.json({
      success: true,
      order_id: order.id,
      amount: amountPaise,
      currency: order.currency,
      key_id: config.key_id,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  }
});

// POST /api/payments/verify — verify Razorpay payment
router.post('/verify', (req, res) => {
  try {
    const config = getRazorpayConfig();
    if (!config.key_secret) {
      return res.status(400).json({ error: 'Payment gateway not configured' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', config.key_secret)
      .update(body)
      .digest('hex');

    const isValid = expectedSignature === razorpay_signature;
    if (!isValid) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    res.json({ success: true, verified: true });
  } catch (error) {
    res.status(500).json({ error: 'Verification failed', details: error.message });
  }
});

// GET /api/payments/config — get public Razorpay config (key_id only)
router.get('/config', (req, res) => {
  try {
    const config = getRazorpayConfig();
    res.json({
      enabled: config.enabled && !!config.key_id,
      key_id: config.key_id,
      currency: config.currency,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load config', details: error.message });
  }
});

export default router;
