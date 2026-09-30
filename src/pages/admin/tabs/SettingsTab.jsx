import React, { useState, useEffect } from 'react';
import { Save, CreditCard, Truck, Percent, DollarSign, Check, Phone, MessageSquare } from 'lucide-react';
import { getSettings, saveSettings } from '../api.js';
import { useFeedback } from '../components/Feedback.jsx';

export default function SettingsTab() {
  const { toast, notify } = useFeedback();
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

  function updateTelephony(key, value) {
    setSettings(prev => ({ ...prev, telephony: { ...(prev.telephony || {}), [key]: value } }));
  }

  function updateWhatsApp(key, value) {
    setSettings(prev => ({ ...prev, whatsapp: { ...(prev.whatsapp || {}), [key]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveSettings(settings);
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { notify(err.message); }
    setSaving(false);
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading settings…</div>;
  if (!settings) return <div style={{ padding: 40, textAlign: 'center', color: '#DC2626' }}>Failed to load settings</div>;

  const payment = settings.payment || {};
  const store = settings.store || {};
  const telephony = settings.telephony || {};
  const whatsapp = settings.whatsapp || {};

  return (
    <div>
      {saved && (
        <div style={saveToast}>
          <Check size={15} /> Settings saved successfully
        </div>
      )}
      <div style={gridWrap}>

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <select value={payment.gateway_provider || 'razorpay'} onChange={e => updatePayment('gateway_provider', e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            <option value="razorpay">Razorpay</option>
            <option value="cashfree">Cashfree</option>
            <option value="manual">Manual / Pay on Delivery</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#4A4A4A' }}>{payment.gateway_enabled ? 'On' : 'Off'}</span>
            <Toggle value={payment.gateway_enabled || false} onChange={v => updatePayment('gateway_enabled', v)} />
          </div>
        </div>
        <Field label="Minimum Order Amount (₹)">
          <input type="number" value={payment.min_order || 0} onChange={e => updatePayment('min_order', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="Booking Amount (₹)">
          <input type="number" value={payment.min_booking ?? 999} onChange={e => updatePayment('min_booking', Number(e.target.value))} style={inputStyle} />
          <div style={hint}>Advance a customer pays at checkout to confirm a campaign. Charged by the server, so the figure a customer sees and the figure taken always match.</div>
        </Field>
        <Field label="Test Mode">
          <Toggle value={payment.test_mode !== false} onChange={v => updatePayment('test_mode', v)} />
        </Field>
      </Section>

      {/* Razorpay API Keys */}
      <Section title="Razorpay API Keys" icon={CreditCard}>
        <Field label="Key ID">
          <input type="text" value={payment.key_id || ''} onChange={e => updatePayment('key_id', e.target.value)} placeholder="rzp_test_..." style={inputStyle} />
        </Field>
        <Field label="Key Secret">
          <input type="password" value={payment.key_secret || ''} onChange={e => updatePayment('key_secret', e.target.value)} placeholder="••••••••" style={inputStyle} />
          <div style={hint}>Server-side only — never exposed to the browser.</div>
        </Field>
      </Section>

      {/* Store settings */}
      <Section title="Store / Products" icon={Truck}
        toggle={store.enabled || false}
        onToggle={v => updateStore('enabled', v)}>
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

      {/* Telephony (Twilio) */}
      <Section title="Telephony (Twilio)" icon={Phone}
        toggle={telephony.enabled || false}
        onToggle={v => updateTelephony('enabled', v)}>
        <Field label="Twilio SID">
          <input type="text" value={telephony.sid || ''} onChange={e => updateTelephony('sid', e.target.value)} placeholder="AC..." style={inputStyle} />
        </Field>
        <Field label="Twilio Auth Token">
          <input type="password" value={telephony.token || ''} onChange={e => updateTelephony('token', e.target.value)} placeholder="••••••••" style={inputStyle} />
        </Field>
        <Field label="Company Number">
          <input type="tel" value={telephony.from_number || ''} onChange={e => updateTelephony('from_number', e.target.value)} placeholder="+91..." style={inputStyle} />
          <div style={hint}>The one company number — all calls route through here.</div>
        </Field>
      </Section>

      {/* WhatsApp Business API */}
      <Section title="WhatsApp Business API" icon={MessageSquare}
        toggle={whatsapp.enabled || false}
        onToggle={v => updateWhatsApp('enabled', v)}>
        <Field label="Phone Number ID">
          <input type="text" value={whatsapp.phone_number_id || ''} onChange={e => updateWhatsApp('phone_number_id', e.target.value)} placeholder="1234567890" style={inputStyle} />
        </Field>
        <Field label="Access Token">
          <input type="password" value={whatsapp.access_token || ''} onChange={e => updateWhatsApp('access_token', e.target.value)} placeholder="••••••••" style={inputStyle} />
        </Field>
        <Field label="Verify Token">
          <input type="text" value={whatsapp.verify_token || 'btlbro_verify'} onChange={e => updateWhatsApp('verify_token', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Business Name">
          <input type="text" value={whatsapp.business_name || 'BTLbro'} onChange={e => updateWhatsApp('business_name', e.target.value)} style={inputStyle} />
        </Field>
        {/* Shown in the Chat tab header so staff can see who they are sending
            as. Meta owns the number itself — this is only a label. */}
        <Field label="Display Number" hint="How the number appears to customers, e.g. +91 63668 70248">
          <input type="text" value={whatsapp.display_number || ''} onChange={e => updateWhatsApp('display_number', e.target.value)} placeholder="+91 63668 70248" style={inputStyle} />
        </Field>
        {/* Without this Meta cannot deliver replies, so the Chat tab stays
            one-way: messages go out, nothing comes back. */}
        <Field label="Webhook URL" hint="Public HTTPS URL Meta calls for inbound replies">
          <input type="text" value={whatsapp.webhook_url || ''} onChange={e => updateWhatsApp('webhook_url', e.target.value)} placeholder="https://your-domain.com/api/admin/chat/webhook" style={inputStyle} />
        </Field>
      </Section>

      {/* Save */}
      <Section title="Save Changes" icon={Save} accent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: '#4A4A4A', lineHeight: 1.5 }}>
            All settings are saved to the server instantly as one batch.
          </p>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '11px 20px', borderRadius: 10, border: 'none',
            background: saving ? '#E7E2D8' : 'linear-gradient(135deg,#F2701D,#F2701D 60%,#C2410D)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </Section>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, accent, toggle, onToggle }) {
  return (
    <div style={{ ...card, borderColor: accent ? '#F2C9A8' : '#F1EDE4' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon size={17} style={{ color: '#F2701D' }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#161616' }}>{title}</h3>
        </div>
        {toggle !== undefined && <Toggle value={toggle} onChange={onToggle} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#4A4A4A' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: '#949494', lineHeight: 1.45 }}>{hint}</span>}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2, cursor: 'pointer',
      background: value ? '#F2701D' : '#C9C2B4', transition: 'background .2s',
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10, background: '#fff',
        transform: `translateX(${value ? 20 : 0}px)`, transition: 'transform .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }} />
    </button>
  );
}

const gridWrap = {
  columns: '3 300px',
  columnGap: 16,
  minHeight: '100%',
};

const card = {
  background: '#fff', borderRadius: 14, padding: 18,
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4',
  breakInside: 'avoid',
  marginBottom: 16,
};

const saveToast = {
  padding: '9px 16px', borderRadius: 8, background: '#ECFDF5', color: '#059669',
  fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
  marginBottom: 16,
};

const hint = { fontSize: 11, color: '#949494', marginTop: 2 };

const inputStyle = {
  width: '100%', padding: '8px 11px', borderRadius: 8,
  border: '1.5px solid #E7E2D8', fontSize: 13, boxSizing: 'border-box',
  outline: 'none',
};