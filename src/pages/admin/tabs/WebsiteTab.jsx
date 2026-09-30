import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Save, Upload, Image, Type, Palette, Trash2, Plus, RefreshCw, Eye, Package, Layout, Edit3, ChevronRight, Calendar, Clock, Tag, Settings } from 'lucide-react';
import { getContent, saveBlock, uploadImage, getProducts, createProduct, updateProduct, deleteProduct } from '../api.js';
import { CAMPAIGN_CATEGORIES, formatDuration, pct } from '../../../utils/campaignMath.js';

/* ============================================================
   WebsiteTab — 4-column layout:
     Col 1: Section list (navigation)
     Col 2: Fields editor
     Col 3: Live preview (real-time)
   + Products sub-view
   ============================================================ */

// Section presets for the CMS — maps to Landing.jsx sections
const SECTION_PRESETS = [
  {
    key: 'hero', label: 'Hero Section', icon: '🎯',
    fields: [
      { name: 'hero_image', label: 'Hero Image', type: 'image' },
      { name: 'eyebrow', label: 'Eyebrow Text', type: 'text' },
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'headline_accent', label: 'Headline Accent (orange)', type: 'text' },
      { name: 'copy', label: 'Body Copy', type: 'textarea' },
      { name: 'cta_primary', label: 'Primary CTA Text', type: 'text' },
      { name: 'cta_primary_link', label: 'Primary CTA Link', type: 'text' },
      { name: 'cta_secondary', label: 'Secondary CTA Text', type: 'text' },
      { name: 'phone_overlay_title', label: 'Phone Overlay Title', type: 'text' },
      { name: 'phone_overlay_text', label: 'Phone Overlay Text', type: 'textarea' },
    ],
  },
  {
    key: 'marquee', label: 'Campaigns', icon: '🔁',
    fields: [
      { name: 'items', label: 'Campaigns (JSON array: [{title, desc, image}])', type: 'json_array', template: [{ title: '', desc: '', image: '' }] },
      { name: 'speed_seconds', label: 'Seconds Each Card Stays Active (default 5)', type: 'text' },
    ],
  },
  {
    key: 'hero_features', label: 'Hero Features', icon: '✨',
    fields: [
      { name: 'items', label: 'Features (JSON array: [{title, desc}])', type: 'json_array', template: [{ title: '', desc: '' }] },
    ],
  },
  {
    key: 'hero_stats', label: 'Hero Stats', icon: '📊',
    fields: [
      { name: 'items', label: 'Stats (JSON array: [{value, label}])', type: 'json_array', template: [{ value: '', label: '' }] },
    ],
  },
  {
    key: 'trust', label: 'Trust Strip', icon: '🤝',
    fields: [
      { name: 'label', label: 'Label Text', type: 'text' },
      { name: 'logos', label: 'Brand Names (JSON array)', type: 'json_array', template: ['Brand Name'] },
    ],
  },
  {
    key: 'value_chain', label: 'Value Chain', icon: '🔗',
    fields: [
      { name: 'lede', label: 'Intro Text', type: 'textarea' },
      { name: 'stages', label: 'Stages (JSON array: [{stage, note}])', type: 'json_array', template: [{ stage: '', note: '' }] },
      { name: 'trust_label', label: 'Trust Label', type: 'text' },
      { name: 'trust_names', label: 'Trust Names (JSON array)', type: 'json_array', template: ['Name'] },
    ],
  },
  {
    key: 'pillars', label: 'Pillars (Solutions)', icon: '🏛️',
    fields: [
      { name: 'items', label: 'Pillars (JSON array: [{tag, headline, body, services, cta, image}])', type: 'json_array', template: [{ tag: '', headline: '', body: '', services: '', cta: '', image: '' }] },
    ],
  },
  {
    key: 'capability_directory', label: 'Capabilities', icon: '📋',
    fields: [
      { name: 'items', label: 'Capabilities (JSON array: [{cat, items}])', type: 'json_array', template: [{ cat: '', items: '' }] },
    ],
  },
  {
    key: 'outcomes', label: 'Business Outcomes', icon: '🎯',
    fields: [
      { name: 'items', label: 'Outcomes (JSON array: [{title, detail}])', type: 'json_array', template: [{ title: '', detail: '' }] },
    ],
  },
  {
    key: 'channels', label: 'Channel Explainer', icon: '📡',
    fields: [
      { name: 'items', label: 'Channels (JSON array: [{key, title, items, width}])', type: 'json_array', template: [{ key: '', title: '', items: '', width: '33%' }] },
    ],
  },
  {
    key: 'case_studies', label: 'Case Studies', icon: '📁',
    fields: [
      { name: 'items', label: 'Case Studies (JSON array: [{client, type, title, challenge, solution, result, image}])', type: 'json_array', template: [{ client: '', type: '', title: '', challenge: '', solution: '', result: '', image: '' }] },
    ],
  },
  {
    key: 'process_steps', label: 'Process Steps', icon: '⚙️',
    fields: [
      { name: 'items', label: 'Steps (JSON array: [{title, items}])', type: 'json_array', template: [{ title: '', items: '' }] },
    ],
  },
  {
    key: 'industries', label: 'Industries', icon: '🏭',
    fields: [
      { name: 'items', label: 'Industry Names (JSON array)', type: 'json_array', template: ['Industry'] },
    ],
  },
  {
    key: 'growth_section', label: 'Growth Section', icon: '📈',
    fields: [
      { name: 'label', label: 'Label', type: 'text' },
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'statement', label: 'Statement', type: 'textarea' },
      { name: 'points', label: 'Growth Points (JSON array)', type: 'json_array', template: ['Point'] },
      { name: 'cta', label: 'CTA Text', type: 'text' },
      { name: 'image', label: 'Image', type: 'image' },
    ],
  },
  {
    key: 'research', label: 'Research Section', icon: '🔬',
    fields: [
      { name: 'label', label: 'Label', type: 'text' },
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'sub', label: 'Subtitle', type: 'textarea' },
      { name: 'points', label: 'Points', type: 'textarea' },
      { name: 'cta', label: 'CTA Text', type: 'text' },
      { name: 'image', label: 'Image', type: 'image' },
    ],
  },
  {
    key: 'csr', label: 'CSR Section', icon: '🌍',
    fields: [
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'text', label: 'Body Text', type: 'textarea' },
      { name: 'points', label: 'Points', type: 'textarea' },
      { name: 'cta', label: 'CTA Text', type: 'text' },
      { name: 'image', label: 'Image', type: 'image' },
    ],
  },
  {
    key: 'testimonials', label: 'Testimonials', icon: '💬',
    fields: [
      { name: 'items', label: 'Testimonials (JSON array: [{quote, name, role}])', type: 'json_array', template: [{ quote: '', name: '', role: '' }] },
    ],
  },
  {
    key: 'insights', label: 'Insights / Blog', icon: '💡',
    fields: [
      { name: 'items', label: 'Insights (JSON array: [{title, tag}])', type: 'json_array', template: [{ title: '', tag: '' }] },
    ],
  },
  {
    key: 'final_cta', label: 'Final CTA', icon: '🚀',
    fields: [
      { name: 'label', label: 'Label', type: 'text' },
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'text', label: 'Body Text', type: 'textarea' },
      { name: 'cta_primary', label: 'CTA Button Text', type: 'text' },
      { name: 'cta_primary_link', label: 'CTA Link', type: 'text' },
      { name: 'cta_secondary', label: 'Secondary CTA', type: 'text' },
    ],
  },
  {
    key: 'why_btlbro', label: 'Why BTLbro', icon: '⭐',
    fields: [
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'statement', label: 'Statement (HTML)', type: 'textarea' },
    ],
  },
  {
    key: 'footer', label: 'Footer', icon: '📎',
    fields: [
      { name: 'company_name', label: 'Company Name', type: 'text' },
      { name: 'tagline', label: 'Tagline', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'address', label: 'Address', type: 'textarea' },
    ],
  },
];

// ---- Image Upload ----
function ImageUpload({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onChange(res.url);
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  }

  return (
    <div>
      {/* Upload button first — compact preview sits UNDER the button */}
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px dashed #CCC', background: '#FAFAFA', cursor: 'pointer', fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Upload size={13} /> {uploading ? 'Uploading…' : value ? 'Change Image' : 'Upload Image'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
      {value && (
        <div style={{ marginTop: 8, position: 'relative' }}>
          <img src={value} alt="" style={{ width: '100%', maxHeight: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid #E0E0E0', display: 'block' }} />
          <button onClick={() => onChange('')} title="Remove image"
            style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 999, background: '#fff', border: '1px solid #E0E0E0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Marquee Campaign Editor ----
// Edits the `items` json_array field of the marquee section as friendly
// campaign cards (title / description / image upload) instead of raw JSON.
function parseMarqueeItems(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/* ---- Campaign numeric field ----
   Numeric-only input (req #13 etc.): strips non-numeric characters as the
   user types; empty input stays empty rather than forcing a 0. */
function CampaignNumberInput({ value, onChange, placeholder, invalid }) {
  return (
    <input
      type="text" inputMode="numeric"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        onChange(raw === '' ? '' : Number(raw));
      }}
      style={{
        width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${invalid ? '#DC2626' : '#E0E0E0'}`,
        fontSize: 12.5, boxSizing: 'border-box', background: invalid ? '#FFF5F5' : '#fff',
      }}
    />
  );
}

/* ---- Campaign date pair with live duration (req #10) ---- */
function CampaignDates({ item, update, errors }) {
  const invalidRange = errors.end_before_start;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 130 }}>
        <label style={tinyLabel}>Start Date *</label>
        <input type="date" value={item.start_date || ''} onChange={(e) => update({ start_date: e.target.value })}
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 12, boxSizing: 'border-box' }} />
      </div>
      <div style={{ flex: 1, minWidth: 130 }}>
        <label style={tinyLabel}>End Date *</label>
        <input type="date" value={item.end_date || ''} min={item.start_date || undefined} onChange={(e) => update({ end_date: e.target.value })}
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${invalidRange ? '#DC2626' : '#E0E0E0'}`, fontSize: 12, boxSizing: 'border-box', background: invalidRange ? '#FFF5F5' : '#fff' }} />
      </div>
      <div>
        <label style={tinyLabel}>Duration</label>
        <div style={{
          padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
          background: invalidRange ? '#FEF2F2' : '#FFF3E8', color: invalidRange ? '#DC2626' : '#C2410C',
        }}>
          {invalidRange ? '⚠ End before start' : formatDuration(item.start_date, item.end_date)}
        </div>
      </div>
    </div>
  );
}

/* ---- Category dropdown (BTL / TTL / ATL — req #11) ---- */
function CampaignCategorySelect({ value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 12.5, boxSizing: 'border-box', background: '#fff' }}>
      <option value="">Select category…</option>
      {CAMPAIGN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

/* ---- Achievement analytics points editor (req #18) ---- */
function AnalyticsPointsEditor({ points, onChange }) {
  const list = Array.isArray(points) ? points : [];
  function update(i, patch) {
    onChange(list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)); }
  function add() { onChange([...list, { date: '', reach: '', returns: '' }]); }

  const numCell = (v, onInput, ph) => (
    <input type="text" inputMode="numeric" value={v ?? ''} placeholder={ph}
      onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); onInput(raw === '' ? '' : Number(raw)); }}
      style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 11.5, boxSizing: 'border-box' }} />
  );

  return (
    <div style={{ border: '1px solid #E7E7E7', borderRadius: 8, padding: 10, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#555' }}>Achievement Data Points (Date / Reach / Returns)</span>
        <button onClick={add} type="button"
          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #F2701D', background: '#FFF8F3', color: '#F2701D', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          + Add Point
        </button>
      </div>
      {list.length === 0 && <div style={{ fontSize: 11, color: '#999', padding: '6px 0 2px' }}>No data points yet — these plot the blue (Reach) & orange (Returns) lines on the popup graph.</div>}
      {list.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input type="date" value={p.date || ''} onChange={(e) => update(i, { date: e.target.value })}
            style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #E0E0E0', fontSize: 11.5, boxSizing: 'border-box' }} />
          {numCell(p.reach, (v) => update(i, { reach: v }), 'Reach')}
          {numCell(p.returns, (v) => update(i, { returns: v }), 'Returns ₹')}
          <button onClick={() => remove(i)} type="button" title="Delete data point"
            style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #F3C9C9', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

const tinyLabel = { display: 'block', fontSize: 10.5, fontWeight: 700, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };

/* ---- ChangeImageButton ----
   Upload/Change + remove controls with NO preview of its own — used under
   the Live Card Preview, which already displays the uploaded image. */
function ChangeImageButton({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onChange(res.url);
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1.5px dashed #CCC', background: '#FAFAFA', cursor: 'pointer', fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Upload size={13} /> {uploading ? 'Uploading…' : value ? 'Change Image' : 'Upload Image'}
      </button>
      {value && (
        <button onClick={() => onChange('')} title="Remove image"
          style={{ width: 34, borderRadius: 8, border: '1px solid #F3C9C9', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={13} />
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
    </div>
  );
}

/* ---- fmt helpers for the display-only cards ---- */
function fmtCardDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\./g, '-');
}
const CARD_CAT_STYLES = {
  BTL: { background: '#FFF1E4', color: '#EA6A0A' },
  TTL: { background: '#EAF1FE', color: '#2563EB' },
  ATL: { background: '#E7F8F1', color: '#0B915F' },
  Gamified: { background: '#F3E8FF', color: '#7C3AED' },
};

/* ============================================================
   MarqueeEditor — master-detail campaign manager.
   LEFT: vertical display-only cards (image, title, desc, category,
         dates, duration, arrow). Click selects → orange highlight.
   RIGHT: preview + ALL editing controls for the selected campaign.
   Same data/handlers as before — layout/UX only.
   ============================================================ */
function MarqueeEditor({ value, onChange, speedSeconds, onSpeedChange }) {
  const items = parseMarqueeItems(value);
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState(0);
  const [gearOpen, setGearOpen] = useState(false);

  // Escape closes the gear popover; clicking anywhere else closes it too
  useEffect(() => {
    if (!gearOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setGearOpen(false); };
    const onClick = () => setGearOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [gearOpen]);

  // Keep selection inside bounds when items are removed/reordered.
  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  // Admin-side validation mirror of req #25.
  function validate(it) {
    const errors = {};
    if (it.start_date && it.end_date && new Date(it.end_date) < new Date(it.start_date)) errors.end_before_start = true;
    const tr = Number(it.total_resources || 0);
    const ru = Number(it.resources_utilized || 0);
    if (tr > 0 && ru > tr) errors.utilized_gt_total = true;
    return errors;
  }

  function update(i, patch) {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next);
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setSelected(j);
  }
  function add() {
    onChange([...items, {
      title: '', desc: '', image: '',
      category: '', start_date: '', end_date: '',
      estimated_reach: '', actual_reach: '', estimated_return: '', actual_return: '',
      total_resources: '', resources_utilized: '', analytics: [],
    }]);
    setSelected(items.length); // select the new campaign immediately
  }

  const filtered = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => filter === 'All' || (it.category || 'Uncategorized') === filter);
  const current = items[selected];
  const currentErrors = current ? validate(current) : {};

  const chipBtn = (c) => ({
    padding: '5px 14px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
    border: filter === c ? 'none' : '1px solid #E5E7EB',
    background: filter === c ? '#F2701D' : '#fff', color: filter === c ? '#fff' : '#555',
    boxShadow: filter === c ? '0 2px 8px rgba(242,112,29,.35)' : 'none',
  });

  const editLabel = { display: 'block', fontSize: 10.5, fontWeight: 700, color: '#8A8A8A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const inputStyle = { width: '100%', padding: '8px 11px', borderRadius: 8, border: '1.5px solid #E5E7EB', fontSize: 12.5, boxSizing: 'border-box', background: '#fff' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 14, alignItems: 'start' }}>
      {/* ============ LEFT: vertical campaign cards (display-only) ============ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {['All', ...CAMPAIGN_CATEGORIES, ...(items.some((it) => !it.category) ? ['Uncategorized'] : [])].map((c) => (
            <button key={c} onClick={() => setFilter(c)} type="button" style={chipBtn(c)}>{c}</button>
          ))}
          {/* Gear = marquee control settings, after the last category chip */}
          <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 2 }}>
            <button
              type="button"
              onClick={() => setGearOpen((v) => !v)}
              title="Campaign marquee settings"
              aria-label="Campaign marquee settings"
              style={{ width: 27, height: 27, borderRadius: 999, border: gearOpen ? 'none' : '1px solid #E5E7EB', background: gearOpen ? '#F2701D' : '#fff', color: gearOpen ? '#fff' : '#F2701D', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: gearOpen ? '0 2px 8px rgba(242,112,29,.35)' : 'none' }}
            >
              <Settings size={14} />
            </button>
            {gearOpen && (
              <span
                onMouseDown={(e) => e.stopPropagation()}
                style={{ position: 'absolute', top: 33, left: 0, zIndex: 60, width: 250, padding: '12px 14px', background: '#fff', border: '1px solid #ECECEC', borderRadius: 12, boxShadow: '0 14px 38px rgba(30,15,0,.16)', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}
              >
                <b style={{ fontSize: 12, color: '#1A1A1A' }}>Marquee Settings</b>
                <label style={{ fontSize: 11, color: '#8A8A8A', fontWeight: 600 }}>
                  Seconds each card stays active (default 5)
                </label>
                <input
                  type="text" inputMode="numeric"
                  value={speedSeconds ?? ''}
                  placeholder="5"
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    onSpeedChange(raw === '' ? '' : Number(raw));
                  }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 12.5, boxSizing: 'border-box' }}
                />
                <span style={{ fontSize: 10.5, color: '#AAA' }}>Remember to press Save — the site marquee updates instantly after saving.</span>
              </span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto', paddingRight: 2 }}>
          {items.length === 0 && (
            <div style={{ padding: 18, borderRadius: 10, border: '1.5px dashed #E0E0E0', fontSize: 12, color: '#999', textAlign: 'center' }}>
              No campaigns yet — add your first one.
            </div>
          )}
          {filtered.length === 0 && items.length > 0 && (
            <div style={{ padding: 18, borderRadius: 10, border: '1.5px dashed #E0E0E0', fontSize: 12, color: '#999', textAlign: 'center' }}>
              No {filter} campaigns.
            </div>
          )}
          {filtered.map(({ it, i }) => {
            const isSel = i === selected;
            const catStyle = CARD_CAT_STYLES[it.category] || { background: '#F3F4F6', color: '#6B7280' };
            return (
              <button
                key={i} type="button" onClick={() => setSelected(i)}
                style={{
                  display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', width: '100%',
                  padding: 12, borderRadius: 14, cursor: 'pointer',
                  background: isSel ? '#FFF9F4' : '#fff',
                  border: `1.5px solid ${isSel ? '#F2701D' : '#ECECEC'}`,
                  boxShadow: isSel ? '0 6px 18px rgba(242,112,29,.16)' : '0 1px 3px rgba(0,0,0,.04)',
                  transition: 'border-color .15s ease, box-shadow .15s ease',
                }}
              >
                {/* thumbnail */}
                {it.image ? (
                  <img src={it.image} alt="" style={{ width: 86, height: 64, objectFit: 'cover', borderRadius: 9, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 86, height: 64, borderRadius: 9, flexShrink: 0, background: '#F3F0EA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9C4BE', fontSize: 18 }}>◆</div>
                )}
                {/* info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1A1A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.title || 'Untitled Campaign'}
                  </div>
                  {it.desc && (
                    <div style={{ fontSize: 11.5, color: '#8A8A8A', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.desc}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, flexWrap: 'wrap', fontSize: 10.5, color: '#6B6B6B' }}>
                    {(it.start_date || it.end_date) && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={11} color={isSel ? '#F2701D' : '#9A9A9A'} />
                        {fmtCardDate(it.start_date) || '—'} to {fmtCardDate(it.end_date) || '—'}
                      </span>
                    )}
                    {it.start_date && it.end_date && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} color={isSel ? '#F2701D' : '#9A9A9A'} />
                        {formatDuration(it.start_date, it.end_date)}
                      </span>
                    )}
                    {it.category && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 9.5, fontWeight: 800, ...catStyle }}>
                        <Tag size={9} /> {it.category}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} color={isSel ? '#F2701D' : '#C0C0C0'} style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>

        <button onClick={add}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px dashed #F2701D', background: '#FFF8F3', color: '#F2701D', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Plus size={14} /> Add Campaign
        </button>
      </div>

      {/* ============ RIGHT: preview + edit panel ============ */}
      <div style={{ border: '1px solid #ECECEC', borderRadius: 14, padding: 18, background: '#fff', minHeight: 300 }}>
        {!current ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center', gap: 8 }}>
            <div style={{ width: 74, height: 74, borderRadius: '50%', border: '1.5px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
              <Eye size={28} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1A1A1A', marginTop: 8 }}>Select a campaign</div>
            <div style={{ fontSize: 12.5, color: '#9A9A9A', maxWidth: 240 }}>Click on any campaign from the left to preview and edit details here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>


            {/* Live card preview (updates as you type) + identity fields */}
            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Live preview: exactly how this card appears on the website marquee */}
              <div style={{ flexShrink: 0 }}>
                <label style={{ ...editLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Live Card Preview
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: '#FFF1E4', color: '#EA6A0A', fontSize: 9, fontWeight: 800, letterSpacing: '.05em' }}>● LIVE</span>
                </label>
                <div style={{
                  position: 'relative', width: 320, maxWidth: '100%', height: 205, borderRadius: 12,
                  overflow: 'hidden', background: '#F0EDE9',
                  border: '2px solid #FF7A00',
                  boxShadow: '0 0 0 4px rgba(255,122,0,.14), 0 14px 44px rgba(255,122,0,.22)',
                }}>
                  {current.image ? (
                    <img src={current.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9C4BE', fontSize: 30 }}>◆</div>
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.05) 30%, rgba(0,0,0,.85) 100%)' }} />
                  {current.category && (
                    <span style={{
                      position: 'absolute', top: 10, left: 10, padding: '3px 10px', borderRadius: 999,
                      fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
                      ...(CARD_CAT_STYLES[current.category] || { background: '#F3F4F6', color: '#6B7280' }),
                    }}>{current.category}</span>
                  )}
                  <div style={{ position: 'absolute', left: 16, right: 16, bottom: 13 }}>
                    <div style={{ fontFamily: "'Zilla Slab', serif", fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                      {current.title || 'Untitled Campaign'}
                    </div>
                    {current.desc ? (
                      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 4, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                        {current.desc}
                      </div>
                    ) : null}
                  </div>
                </div>
                {/* Single image control for the ONE image shown in the preview above */}
                <div style={{ width: 320, maxWidth: '100%', marginTop: 8 }}>
                  <ChangeImageButton value={current.image || ''} onChange={(v) => update(selected, { image: v })} />
                </div>
                <div style={{ fontSize: 10.5, color: '#AAA', marginTop: 6 }}>
                  This is how visitors see the card — edits reflect instantly.
                </div>
              </div>

              {/* RIGHT FORM — Row 1: title + campaign navigation; Row 2: dates +
                  duration; Row 3: description + category. The ONE image source
                  stays in the Live Card Preview (single button below it). */}
              <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* ROW 1 — Campaign Title + navigation on the same row */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ ...editLabel, marginRight: 'auto' }}>Campaign Title *</label>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#AAA', whiteSpace: 'nowrap' }}>Campaign {selected + 1} of {items.length}</span>
                    <button onClick={() => move(selected, -1)} disabled={selected === 0} title="Move up"
                      style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: selected === 0 ? 'default' : 'pointer', opacity: selected === 0 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
                    <button onClick={() => move(selected, 1)} disabled={selected === items.length - 1} title="Move down"
                      style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: selected === items.length - 1 ? 'default' : 'pointer', opacity: selected === items.length - 1 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↓</button>
                    <button onClick={() => remove(selected)} title="Remove campaign"
                      style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #F3C9C9', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={13} /></button>
                  </div>
                  <input type="text" value={current.title || ''} onChange={(e) => update(selected, { title: e.target.value })}
                    placeholder="Campaign title (e.g. Retail Activation)" style={{ ...inputStyle, marginTop: 4 }} />
                </div>

                {/* ROW 2 — Start Date + End Date + Duration in one row */}
                <CampaignDates item={current} update={(patch) => update(selected, patch)} errors={currentErrors} />

                {/* ROW 3 — Short Description (wide) + Category (fixed width) in one row */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={editLabel}>Short Description</label>
                    <textarea value={current.desc || ''} onChange={(e) => update(selected, { desc: e.target.value })}
                      placeholder="Shown on the card and popup" rows={2}
                      style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
                  </div>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <label style={editLabel}>Category *</label>
                    <CampaignCategorySelect value={current.category} onChange={(v) => update(selected, { category: v })} />
                  </div>
                </div>
              </div>
            </div>

            {/* Performance metrics — 3 rows × 2 columns: label left, value box right */}
            <div>
              <label style={{ ...editLabel, marginBottom: 6 }}>Performance Metrics</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 28px' }}>
                {[
                  { label: 'Est. Reach', key: 'estimated_reach', ph: '250000' },
                  { label: 'Actual Reach', key: 'actual_reach', ph: '225000' },
                  { label: 'Est. Return ₹', key: 'estimated_return', ph: '500000' },
                  { label: 'Actual Return ₹', key: 'actual_return', ph: '450000' },
                  { label: 'Total Human Resources', key: 'total_resources', ph: '50', invalid: true },
                  { label: 'Human Resources Utilized', key: 'resources_utilized', ph: '42', invalid: true },
                ].map((m) => (
                  <div key={m.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
                    <label style={{ ...editLabel, marginBottom: 0, minWidth: 0, overflowWrap: 'break-word' }}>{m.label}</label>
                    <div style={{ width: 140, flexShrink: 0 }}>
                      <CampaignNumberInput
                        value={current[m.key]}
                        onChange={(v) => update(selected, { [m.key]: v })}
                        placeholder={m.ph}
                        invalid={m.invalid ? currentErrors.utilized_gt_total : undefined}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {currentErrors.utilized_gt_total && (
                <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600, marginTop: 6 }}>⚠ Resources utilized cannot be greater than total human resources.</div>
              )}
            </div>

            {/* Live auto-calculated percentages */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[['Reach Achievement', pct(current.actual_reach, current.estimated_reach)], ['Return Achievement', pct(current.actual_return, current.estimated_return)], ['Resource Utilization', pct(current.resources_utilized, current.total_resources)]].map(([label, v]) => (
                <span key={label} style={{ padding: '5px 12px', borderRadius: 999, background: '#F0F7FF', color: '#1D4ED8', fontSize: 11, fontWeight: 700 }}>
                  {label}: {typeof v === 'number' ? `${v}%` : v}
                </span>
              ))}
            </div>

            {/* Achievement data points */}
            <AnalyticsPointsEditor points={current.analytics} onChange={(v) => update(selected, { analytics: v })} />
          </div>
        )}
      </div>
    </div>
  );
}

// Convert the editor's raw strings into the draft shape the preview consumes
// (json_array fields are parsed into real arrays; invalid JSON stays a string
// while the user is mid-edit so typing never breaks the preview).
function toDraftShape(data, section) {
  const out = { ...data };
  section.fields.forEach((f) => {
    if (f.type === 'json_array' && typeof out[f.name] === 'string') {
      try { out[f.name] = JSON.parse(out[f.name]); } catch { /* keep string while typing */ }
    }
  });
  return out;
}

// ---- Fields Editor ----
function FieldsEditor({ section, value, onChange, onSave, hasDraft, savedMsg }) {
  const [data, setData] = useState(() => {
    const initial = { ...(value || {}) };
    // For json_array fields, if data is an array under `items`, stringify it
    section.fields.forEach(f => {
      if (f.type === 'json_array' && Array.isArray(initial[f.name])) {
        initial[f.name] = JSON.stringify(initial[f.name], null, 2);
      } else if (f.type === 'json_array' && Array.isArray(initial.items) && f.name === 'items') {
        initial.items = JSON.stringify(initial.items, null, 2);
      }
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState('');
  const [skipNote, setSkipNote] = useState('');
  const [valPopup, setValPopup] = useState('');
  const [gearOpen, setGearOpen] = useState(false);

  // Escape closes the validation popup; clicking anywhere closes the gear popover
  useEffect(() => {
    if (!valPopup && !gearOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setValPopup(''); setGearOpen(false); } };
    const onClick = () => setGearOpen(false);
    document.addEventListener('keydown', onKey);
    if (gearOpen) document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [valPopup, gearOpen]);

  function updateField(name, value) {
    const next = { ...data, [name]: value };
    setData(next);
    onChange(toDraftShape(next, section));
    if (parseError) setParseError('');
    if (skipNote) setSkipNote('');
    if (valPopup) setValPopup('');
  }

  async function handleSave() {
    // Validate JSON fields before saving
    const toSave = { ...data };
    for (const f of section.fields) {
      if (f.type === 'json_array' && typeof toSave[f.name] === 'string') {
        try {
          const parsed = JSON.parse(toSave[f.name]);
          toSave[f.name] = parsed; // send as actual array, not string
        } catch {
          setParseError(`Invalid JSON in "${f.label}". Fix the syntax and try again.`);
          return;
        }
      }
    }

    // Campaigns save individually: only COMPLETE campaigns (Title, Category,
    // Start Date, End Date all filled) are saved — incomplete ones are skipped
    // with a note. If nothing is complete, the save is blocked entirely.
    if (section.key === 'marquee') {
      const items = Array.isArray(toSave.items) ? toSave.items : [];
      const complete = [];
      const skipped = [];
      const blanks = [];
      items.forEach((it, i) => {
        const miss = [];
        if (!String(it?.title || '').trim()) miss.push('Title');
        if (!it?.category) miss.push('Category');
        if (!it?.start_date) miss.push('Start Date');
        if (!it?.end_date) miss.push('End Date');
        if (it?.start_date && it?.end_date && it.end_date < it.start_date) miss.push('End Date is before Start Date');
        // "blank" = a freshly added campaign with NOTHING typed into it
        const touched = !!(String(it?.title || '').trim() || it?.desc || it?.image ||
          Number(it?.estimated_reach) > 0 || Number(it?.actual_reach) > 0 ||
          Number(it?.estimated_return) > 0 || Number(it?.actual_return) > 0 ||
          Number(it?.total_resources) > 0 || Number(it?.resources_utilized) > 0);
        if (!miss.length) complete.push(it);
        else if (!touched) blanks.push(`Campaign ${i + 1} — nothing entered yet`);
        else skipped.push(`Campaign ${i + 1}${it?.title ? ` ("${it.title}")` : ''} — enter ${miss.join(', ')}`);
      });
      // A brand-new empty campaign must be filled (or deleted) — never silently saved/dropped
      if (blanks.length) {
        setParseError('');
        setValPopup(`Please enter your values before saving:\n\n${blanks.join('\n')}\n\nFill in Title, Category, Start Date and End Date — or delete the empty campaign with the 🗑 button — then press Save again.`);
        return; // block the save and show the popup
      }
      if (complete.length === 0) {
        setParseError('');
        setValPopup(`Please enter your values before saving. Every campaign needs Title, Category, Start Date and End Date:\n\n${skipped.join('\n')}`);
        return; // nothing complete → block the save and show the popup
      }
      if (skipped.length) {
        setSkipNote(`Saved ${complete.length} of ${items.length} campaigns — incomplete ones were skipped:\n${skipped.join('\n')}`);
        setTimeout(() => setSkipNote(''), 8000);
      } else {
        setSkipNote('');
      }
      toSave.items = complete; // save only the complete campaigns
    }

    setSaving(true);
    try {
      await onSave(section.key, toSave);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{section.icon} {section.label}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {savedMsg && (
            <span style={{ padding: '4px 10px', borderRadius: 6, background: '#ECFDF5', color: '#059669', fontSize: 11, fontWeight: 700 }}>
              ✓ {savedMsg}
            </span>
          )}
          {hasDraft && (
            <span style={{ padding: '4px 10px', borderRadius: 6, background: '#FEF3C7', color: '#B45309', fontSize: 11, fontWeight: 600 }}>
              ● Unsaved changes
            </span>
          )}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: saving ? '#CCC' : '#F2701D', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {parseError && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, marginBottom: 10, whiteSpace: 'pre-line' }}>
          ⚠️ {parseError}
        </div>
      )}
      {skipNote && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', fontSize: 12, fontWeight: 500, marginBottom: 10, whiteSpace: 'pre-line' }}>
          ⚠️ {skipNote}
        </div>
      )}

      {/* Validation popup — blocks saving until required values are entered */}
      {valPopup && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Missing campaign values"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setValPopup(''); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,18,25,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ width: 'min(470px, 100%)', background: '#fff', borderRadius: 14, border: '1px solid #F3D9BF', boxShadow: '0 24px 60px rgba(20,10,0,.28)', overflow: 'hidden', animation: 'valPopIn .18s ease' }}>
            <style>{'@keyframes valPopIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }'}</style>
            <div style={{ padding: '13px 18px', background: '#FFF3E8', borderBottom: '1px solid #F3D9BF', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 17 }}>⚠️</span>
              <b style={{ fontSize: 14, color: '#C2410C' }}>Enter required values</b>
            </div>
            <div style={{ padding: '14px 18px', fontSize: 12.5, color: '#7A4A22', whiteSpace: 'pre-line', lineHeight: 1.65 }}>
              {valPopup}
            </div>
            <div style={{ padding: '0 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setValPopup('')}
                autoFocus
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 999, border: 'none', background: 'linear-gradient(135deg, #F97316, #EA6A0A)', color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 16px rgba(249,115,22,.35)' }}
              >
                ← Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {section.fields.filter((f) => !(section.key === 'marquee' && f.name === 'speed_seconds')).map(f => (
          <div key={f.name}>
            {!(section.key === 'marquee' && f.name === 'items') && (
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>{f.label}</label>
            )}
            {f.type === 'image' ? (
              <ImageUpload value={data[f.name] || ''} onChange={(v) => updateField(f.name, v)} />
            ) : section.key === 'marquee' && f.name === 'items' ? (
              <MarqueeEditor
                value={data[f.name]}
                onChange={(v) => updateField(f.name, v)}
                speedSeconds={data.speed_seconds}
                onSpeedChange={(v) => updateField('speed_seconds', v)}
              />
            ) : f.type === 'textarea' || f.type === 'json_array' ? (
              <textarea value={data[f.name] || ''} onChange={e => updateField(f.name, e.target.value)}
                rows={f.type === 'json_array' ? 8 : 3}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: '1.5px solid #E0E0E0', fontSize: 12, fontFamily: f.type === 'json_array' ? 'monospace' : 'inherit',
                  resize: 'vertical', boxSizing: 'border-box',
                }} />
            ) : (
              <input type="text" value={data[f.name] || ''} onChange={e => updateField(f.name, e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 12, boxSizing: 'border-box' }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Live Preview ----
function LivePreview({ section, content }) {
  if (!section || !content) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>
      <Eye size={28} style={{ marginBottom: 10, opacity: 0.4 }} />
      <div>Select a section and edit fields to see a live preview</div>
    </div>
  );

  const key = section.key;

  if (key === 'hero') {
    return (
      <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #eee' }}>
        {content.hero_image && <img src={content.hero_image} alt="" style={{ width: '100%', height: 140, objectFit: 'cover' }} />}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#F2701D', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{content.eyebrow || 'Eyebrow'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '6px 0', fontFamily: 'Zilla Slab, serif', lineHeight: 1.15 }}>
            {(content.headline || 'Headline').split('.').slice(0, -1).join('.')}.{' '}
            <span style={{ color: '#F2701D' }}>{content.headline_accent || 'Accent text'}</span>
          </h2>
          <p style={{ fontSize: 12, color: '#666', lineHeight: 1.5, marginTop: 6 }}>{content.copy || 'Body copy goes here…'}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <span style={{ padding: '5px 12px', borderRadius: 6, background: '#F2701D', color: '#fff', fontSize: 11, fontWeight: 600 }}>{content.cta_primary || 'CTA'}</span>
            <span style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#333' }}>{content.cta_secondary || 'Secondary'}</span>
          </div>
        </div>
      </div>
    );
  }

  if (key === 'pillars') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length === 0 && <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 20 }}>No pillars defined yet</div>}
        {items.map((p, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
            <div style={{ fontSize: 10, color: '#F2701D', fontWeight: 600 }}>{p.tag || `Pillar ${i + 1}`}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{p.headline || 'Headline'}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4, lineHeight: 1.4 }}>{p.body || 'Body text…'}</div>
            {p.image && <img src={p.image} alt="" style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, marginTop: 8 }} />}
          </div>
        ))}
      </div>
    );
  }

  if (key === 'outcomes') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0 && <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 20 }}>No outcomes defined</div>}
        {items.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #eee' }}>
            <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{String(i + 1).padStart(2, '0')}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{o.title || 'Outcome'}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2, lineHeight: 1.4 }}>{o.detail || 'Detail…'}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (key === 'case_studies') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length === 0 && <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 20 }}>No case studies defined</div>}
        {items.map((cs, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', border: '1px solid #eee' }}>
            {cs.image && <img src={cs.image} alt="" style={{ width: '100%', height: 80, objectFit: 'cover' }} />}
            <div style={{ padding: 10 }}>
              <div style={{ fontSize: 10, color: '#F2701D', fontWeight: 600 }}>{cs.client} · {cs.type}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{cs.title || 'Title'}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Result: {cs.result || '—'}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (key === 'marquee') {
    const items = parseMarqueeItems(content.items);
    const speed = Math.max(1, parseInt(content.speed_seconds, 10) || 5);
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #eee' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Campaigns · highlight rotates every {speed}s</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          {items.map((it, i) => (
            <div key={i} style={{
              position: 'relative', width: 132, height: 88, borderRadius: 8, overflow: 'hidden', background: '#F0EDE9', flexShrink: 0,
              border: `2px solid ${i === 0 ? '#FF7A00' : 'transparent'}`,
              boxShadow: i === 0 ? '0 0 0 3px rgba(255,122,0,.15), 0 10px 26px rgba(255,122,0,.28)' : 'none',
              transform: i === 0 ? 'scale(1.06)' : 'scale(1)', transition: 'all .6s ease',
            }}>
              {it.image ? <img src={it.image} alt={it.title || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9C4BE', fontSize: 10 }}>No image</div>}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 35%, rgba(0,0,0,.72) 100%)' }} />
              <div style={{ position: 'absolute', left: 7, right: 7, bottom: 6 }}>
                <div style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>{it.title || 'Untitled'}</div>
                <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 8.5, lineHeight: 1.3, marginTop: 2, whiteSpace: 'pre-line', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.desc || ''}</div>
              </div>
            </div>
          ))}
          {items.length === 0 && <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 20 }}>No campaigns defined yet</div>}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#999' }}>{items.length} campaign{items.length === 1 ? '' : 's'} · on the site, the orange highlight moves to the next card every {speed}s</div>
      </div>
    );
  }

  if (key === 'trust') {
    const logos = Array.isArray(content.logos) ? content.logos : [];
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #eee' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#888', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{content.label || 'Trust Label'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {logos.map((l, i) => (
            <span key={i} style={{ padding: '4px 12px', borderRadius: 4, background: '#F5F5F5', fontSize: 11, color: '#555' }}>{l}</span>
          ))}
        </div>
      </div>
    );
  }

  if (key === 'value_chain') {
    const stages = Array.isArray(content.stages) ? content.stages : [];
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #eee' }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 10 }}>{content.lede || 'Intro text…'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
          {stages.map((s, i) => (
            <div key={i} style={{ padding: '8px 10px', flex: '1 1 80px', borderRight: i < stages.length - 1 ? '1px solid #eee' : 'none' }}>
              <div style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{s.stage || 'Stage'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (key === 'channels') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #eee' }}>
        <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
          {items.map((c, i) => <span key={i} style={{ width: c.width || '33%', background: i === 0 ? '#161616' : i === 1 ? '#F2701D' : '#B8AFA6' }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length || 3}, 1fr)`, gap: 10 }}>
          {items.map((c, i) => (
            <div key={i}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{c.key || 'ATL'}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{c.title || 'Title'}</div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>{c.items || 'Items'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (key === 'testimonials') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((t, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 8, padding: 12, borderLeft: '3px solid #F2701D', border: '1px solid #eee', borderLeftWidth: 3, borderLeftColor: '#F2701D' }}>
            <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic', lineHeight: 1.5 }}>"{t.quote || 'Quote…'}"</div>
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6 }}>{t.name || 'Name'}</div>
            <div style={{ fontSize: 10, color: '#999' }}>{t.role || 'Role'}</div>
          </div>
        ))}
      </div>
    );
  }

  if (key === 'process_steps') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <div style={{ display: 'flex', gap: 0, borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        {items.map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 8px', borderRight: i < items.length - 1 ? '1px solid #eee' : 'none' }}>
            <div style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{s.title || 'Step'}</div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 4, lineHeight: 1.4 }}>{s.items || 'Details'}</div>
          </div>
        ))}
      </div>
    );
  }

  if (key === 'final_cta') {
    return (
      <div style={{ background: '#F2701D', borderRadius: 8, padding: 16, color: '#fff' }}>
        <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{content.label || 'Label'}</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '6px 0' }}>{content.headline || 'Headline'}</h3>
        <p style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>{content.text || 'Body text…'}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <span style={{ padding: '5px 14px', borderRadius: 6, background: '#fff', color: '#F2701D', fontSize: 11, fontWeight: 600 }}>{content.cta_primary || 'CTA'}</span>
          <span style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.5)' }}>{content.cta_secondary || 'Secondary'}</span>
        </div>
      </div>
    );
  }

  if (key === 'growth_section') {
    return (
      <div style={{ background: '#171717', borderRadius: 8, padding: 16, color: '#fff' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{content.label || 'Label'}</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '6px 0' }}>{content.headline || 'Headline'}</h3>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{content.statement || 'Statement…'}</p>
        <ol style={{ marginTop: 10, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(Array.isArray(content.points) ? content.points : []).map((p, i) => (
            <li key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
              <span style={{ color: '#F2701D', fontSize: 10 }}>{String(i + 1).padStart(2, '0')}</span> {p}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Generic preview for other sections
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 14, border: '1px solid #eee' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#F2701D', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{section.label}</div>
      {Object.entries(content).filter(([k]) => k !== 'updated_at').map(([k, v]) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 600 }}>{k}</div>
          {typeof v === 'string' && v.startsWith('http') && v.match(/\.(jpg|jpeg|png|gif|webp)/i) ? (
            <img src={v} alt="" style={{ width: '100%', maxHeight: 80, objectFit: 'cover', borderRadius: 4, marginTop: 3 }} />
          ) : Array.isArray(v) ? (
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{JSON.stringify(v).slice(0, 100)}…</div>
          ) : (
            <div style={{ fontSize: 12, color: '#333', marginTop: 2, lineHeight: 1.4 }}>{String(v).slice(0, 200)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Products Manager ----
function ProductsManager() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', price: '', mrp: '', category: 'General', description: '', image: '', stock: '', size_label: '', icon: '', use: 'Indoor', rating: '', reviews: '', sizes: '[]', finishing: '[]' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const res = await getProducts(true);
      setProducts(res.products || []);
    } catch {}
    setLoading(false);
  }

  function startEdit(p) {
    if (p) {
      setForm({
        name: p.name || '', price: p.price || '', mrp: p.mrp || '', category: p.category || 'General',
        description: p.description || '', image: p.image || '', stock: p.stock ?? '', size_label: p.size_label || '',
        icon: p.icon || '', use: p.use || 'Indoor', rating: p.rating || '', reviews: p.reviews || '',
        sizes: JSON.stringify(p.sizes || [], null, 2), finishing: JSON.stringify(p.finishing || [], null, 2),
      });
      setEditing(p.id);
    } else {
      setForm({ name: '', price: '', mrp: '', category: 'General', description: '', image: '', stock: '', size_label: '', icon: '', use: 'Indoor', rating: '', reviews: '', sizes: '[]', finishing: '[]' });
      setEditing('new');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      let sizes, finishing;
      try { sizes = JSON.parse(form.sizes); } catch { sizes = []; }
      try { finishing = JSON.parse(form.finishing); } catch { finishing = []; }

      const payload = {
        ...form,
        price: Number(form.price),
        mrp: form.mrp ? Number(form.mrp) : undefined,
        stock: form.stock !== '' ? Number(form.stock) : undefined,
        rating: form.rating !== '' ? Number(form.rating) : undefined,
        reviews: form.reviews !== '' ? Number(form.reviews) : undefined,
        sizes,
        finishing,
      };

      if (editing === 'new') {
        const res = await createProduct(payload);
        setProducts(prev => [...prev, res.product]);
      } else {
        const res = await updateProduct(editing, payload);
        setProducts(prev => prev.map(p => p.id === editing ? res.product : p));
      }
      setEditing(null);
    } catch (err) { alert(err.message); }
    setSaving(false);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this product?')) return;
    try { await deleteProduct(id); setProducts(prev => prev.filter(p => p.id !== id)); } catch (err) { alert(err.message); }
  }

  async function handleToggleActive(p) {
    try {
      const res = await updateProduct(p.id, { is_active: !p.is_active });
      setProducts(prev => prev.map(x => x.id === p.id ? res.product : x));
    } catch {}
  }

  if (editing !== null) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #F0F0F0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{editing === 'new' ? 'Add Product' : 'Edit Product'}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditing(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: saving ? '#CCC' : '#F2701D', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { name: 'name', label: 'Product Name', required: true },
            { name: 'price', label: 'Price (₹)', required: true, type: 'number' },
            { name: 'mrp', label: 'MRP (₹)', type: 'number' },
            { name: 'category', label: 'Category' },
            { name: 'icon', label: 'Emoji Icon' },
            { name: 'use', label: 'Use (Indoor/Outdoor)' },
            { name: 'rating', label: 'Rating', type: 'number' },
            { name: 'reviews', label: 'Reviews Count', type: 'number' },
            { name: 'size_label', label: 'Default Size' },
            { name: 'stock', label: 'Stock', type: 'number' },
          ].map(f => (
            <div key={f.name}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3 }}>{f.label}{f.required && ' *'}</label>
              <input type={f.type || 'text'} value={form[f.name]} onChange={e => setForm(prev => ({ ...prev, [f.name]: e.target.value }))} required={f.required}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #E0E0E0', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3 }}>Description</label>
          <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} rows={2}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #E0E0E0', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3 }}>Sizes (JSON: [{`{label, mult}`}])</label>
          <textarea value={form.sizes} onChange={e => setForm(prev => ({ ...prev, sizes: e.target.value }))} rows={4}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #E0E0E0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 3 }}>Finishing (JSON: [{`{label, price}`}])</label>
          <textarea value={form.finishing} onChange={e => setForm(prev => ({ ...prev, finishing: e.target.value }))} rows={4}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1.5px solid #E0E0E0', fontSize: 11, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginTop: 10 }}>
          {form.image && <img src={form.image} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #E0E0E0', marginBottom: 6 }} />}
          <label style={{ display: 'block', padding: '8px 12px', borderRadius: 6, border: '1.5px dashed #CCC', background: '#FAFAFA', cursor: 'pointer', fontSize: 12, color: '#666', textAlign: 'center' }}>
            <Upload size={13} style={{ marginRight: 4 }} /> Upload Product Image
            <input type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              try { const res = await uploadImage(file); setForm(f => ({ ...f, image: res.url })); } catch (err) { alert(err.message); }
            }} style={{ display: 'none' }} />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Products ({products.length})</h3>
        <button onClick={() => startEdit(null)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#F2701D', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> Add Product
        </button>
      </div>
      {loading ? <p style={{ color: '#999', fontSize: 12 }}>Loading…</p> : products.length === 0 ? (
        <p style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 30 }}>No products yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {products.map(p => (
            <div key={p.id} style={{ border: '1px solid #F0F0F0', borderRadius: 8, overflow: 'hidden', opacity: p.is_active === false ? 0.5 : 1 }}>
              {p.image ? <img src={p.image} alt={p.name} style={{ width: '100%', height: 100, objectFit: 'cover' }} /> :
                <div style={{ width: '100%', height: 100, background: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>{p.icon || '📦'}</div>}
              <div style={{ padding: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>₹{p.price}</span>
                  <span style={{ fontSize: 10, color: '#888', background: '#F5F5F5', padding: '1px 6px', borderRadius: 999 }}>{p.category}</span>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <button onClick={() => startEdit(p)} style={{ flex: 1, padding: 4, borderRadius: 4, border: '1px solid #E0E0E0', background: '#fff', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => handleToggleActive(p)} style={{ padding: 4, borderRadius: 4, border: '1px solid #E0E0E0', background: '#fff', fontSize: 11, cursor: 'pointer' }}>{p.is_active === false ? 'Enable' : 'Hide'}</button>
                  <button onClick={() => handleDelete(p.id)} style={{ padding: 4, borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 11, cursor: 'pointer' }}><Trash2 size={11} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Tab ----
export default function WebsiteTab() {
  const [content, setContent] = useState({});
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('hero');
  const [activeView, setActiveView] = useState('sections');
  const [savedMsg, setSavedMsg] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await getContent();
        setContent(res.content || {});
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  // Live drafts: edits flow straight into the preview WITHOUT hitting save.
  function handleDraft(key, data) {
    setDrafts(prev => ({ ...prev, [key]: data }));
  }

  async function handleSave(key, data) {
    try {
      const res = await saveBlock(key, data);
      setContent(prev => ({ ...prev, [key]: res.block }));
      setDrafts(prev => { const n = { ...prev }; delete n[key]; return n; });
      setSavedMsg('Saved!');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch (err) { alert(err.message); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading content…</div>;

  const currentSection = SECTION_PRESETS.find(s => s.key === activeSection);
  // Preview shows the unsaved draft when present, else the saved content.
  const currentContent = drafts[activeSection] || content[activeSection] || {};
  const filteredSections = SECTION_PRESETS.filter(s =>
    `${s.label} ${s.key}`.toLowerCase().includes(sectionFilter.toLowerCase())
  );

  return (
    <div>
      {/* View toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: '#F3F3F3', borderRadius: 8, padding: 3, width: 'fit-content' }}>
        {[
          { id: 'sections', label: 'Website Sections', icon: Layout },
          { id: 'products', label: 'Products & Pricing', icon: Package },
        ].map(v => (
          <button key={v.id} onClick={() => setActiveView(v.id)} style={{
            padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600,
            background: activeView === v.id ? '#fff' : 'transparent',
            color: activeView === v.id ? '#111' : '#888',
            boxShadow: activeView === v.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}><v.icon size={13} /> {v.label}</button>
        ))}
      </div>

      {activeView === 'products' ? (
        <ProductsManager />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, alignItems: 'start' }}>
          {/* Col 1: Section list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 16 }}>
            <input
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              placeholder="Search sections…"
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #E7E2D8', background: '#fff', fontSize: 12, marginBottom: 6, outline: 'none' }}
            />
            {filteredSections.map(s => {
              const hasData = content[s.key] && Object.keys(content[s.key]).length > 1;
              const isDraft = !!drafts[s.key];
              return (
                <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
                  padding: '8px 10px', borderRadius: 6, border: 'none', textAlign: 'left',
                  fontSize: 12, fontWeight: activeSection === s.key ? 700 : 500,
                  background: activeSection === s.key ? '#F2701D' : 'transparent',
                  color: activeSection === s.key ? '#fff' : '#555',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 6,
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.icon} {s.label}</span>
                  {(hasData || isDraft) && activeSection !== s.key && (
                    <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: isDraft ? '#F2701D' : '#10B981' }} />
                  )}
                </button>
              );
            })}
            {filteredSections.length === 0 && (
              <div style={{ padding: 8, fontSize: 11, color: '#999' }}>No sections match “{sectionFilter}”.</div>
            )}
          </div>

          {/* Col 2: Fields editor */}
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, border: '1px solid #E7E2D8' }}>
            <FieldsEditor key={activeSection} section={currentSection}
              value={currentContent} onChange={(d) => handleDraft(activeSection, d)}
              onSave={handleSave} hasDraft={!!drafts[activeSection]} savedMsg={savedMsg} />
          </div>
        </div>
      )}
    </div>
  );
}
