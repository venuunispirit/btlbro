import React, { useState, useEffect } from 'react';
import { Save, CreditCard, Truck, Percent, DollarSign, Check } from 'lucide-react';
import { getSettings, saveSettings } from '../api.js';

export default function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await getSettings();
        setSettings(res.settings || {});
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  function update(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function updatePayment(key, value) {
    setSettings(prev => ({ ...prev, payment: { ...(prev.payment || {}), [key]: value } }));
  }

  function updateStore(key, value) {
    setSettings(prev => ({ ...prev, store: { ...(prev.store || {}), [key]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveSettings(settings);
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { alert(err.message); }
    setSaving(false);
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading settings…</div>;
  if (!settings) return <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Failed to load settings</div>;

  const payment = settings.payment || {};
  const store = settings.store || {};

  return (
    <div style={{ maxWidth: 700 }}>
      {saved && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: '#ECFDF5', color: '#059669', fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={15} /> Settings saved successfully
        </div>
      )}

      {/* Pricing */}
      <Section title="Pricing" icon={DollarSign}>
        <Field label="Per Location Price (₹)">
          <input type="number" value={settings.per_location_price || 0} onChange={e => update('per_location_price', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Agency Fee (%)">
          <input type="number" value={settings.agency_fee || 10} onChange={e => update('agency_fee', Number(e.target.value))} style={inputStyle} />
        </Field>
      </Section>

      {/* Payment Gateway */}
      <Section title="Payment Gateway" icon={CreditCard}>
        <Field label="Gateway Provider">
          <select value={payment.gateway_provider || 'razorpay'} onChange={e => updatePayment('gateway_provider', e.target.value)} style={inputStyle}>
            <option value="razorpay">Razorpay</option>
            <option value="cashfree">Cashfree</option>
            <option value="manual">Manual / Pay on Delivery</option>
          </select>
        </Field>
        <Field label="Enable Online Payment">
          <Toggle value={payment.gateway_enabled || false} onChange={v => updatePayment('gateway_enabled', v)} />
        </Field>
        <Field label="Minimum Order Amount (₹)">
          <input type="number" value={payment.min_order || 0} onChange={e => updatePayment('min_order', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Minimum Booking Amount (₹)">
          <input type="number" value={payment.min_booking || 999} onChange={e => updatePayment('min_booking', Number(e.target.value))} style={inputStyle} />
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Minimum advance for QuickCheckout</div>
        </Field>
        <Field label="Test Mode">
          <Toggle value={payment.test_mode !== false} onChange={v => updatePayment('test_mode', v)} />
        </Field>
      </Section>

      {/* Store settings */}
      <Section title="Store / Products" icon={Truck}>
        <Field label="Enable Products Shop">
          <Toggle value={store.enabled || false} onChange={v => updateStore('enabled', v)} />
        </Field>
        <Field label="Default GST Rate (%)">
          <input type="number" value={store.gst_rate || 18} onChange={e => updateStore('gst_rate', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Shipping Fee (₹)">
          <input type="number" value={store.shipping_fee || 0} onChange={e => updateStore('shipping_fee', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Free Shipping Above (₹)">
          <input type="number" value={store.free_shipping_above || 0} onChange={e => updateStore('free_shipping_above', Number(e.target.value))} style={inputStyle} />
        </Field>
      </Section>

      {/* Save button */}
      <div style={{ marginTop: 24 }}>
        <button onClick={handleSave} disabled={saving} style={{
          padding: '12px 32px', borderRadius: 10, border: 'none',
          background: saving ? '#CCC' : 'linear-gradient(135deg,#F2711C,#F2701D 60%,#E05E0F)',
          color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 24, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <Icon size={18} style={{ color: '#F2701D' }} />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: '#555', minWidth: 180 }}>{label}</label>
      <div style={{ flex: 1, maxWidth: 300 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2, cursor: 'pointer',
      background: value ? '#F2701D' : '#D1D5DB', transition: 'background .2s',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10, background: '#fff',
        transform: `translateX(${value ? 20 : 0}px)`, transition: 'transform .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }} />
    </button>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #E0E0E0', fontSize: 13, boxSizing: 'border-box',
};
