import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Save, Upload, Image, Type, Palette, Trash2, Plus, RefreshCw, Eye, Package, Layout, Edit3 } from 'lucide-react';
import { getContent, saveBlock, uploadImage, getProducts, createProduct, updateProduct, deleteProduct } from '../api.js';

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
      { name: 'eyebrow', label: 'Eyebrow Text', type: 'text' },
      { name: 'headline', label: 'Headline', type: 'text' },
      { name: 'headline_accent', label: 'Headline Accent (orange)', type: 'text' },
      { name: 'copy', label: 'Body Copy', type: 'textarea' },
      { name: 'cta_primary', label: 'Primary CTA Text', type: 'text' },
      { name: 'cta_primary_link', label: 'Primary CTA Link', type: 'text' },
      { name: 'cta_secondary', label: 'Secondary CTA Text', type: 'text' },
      { name: 'hero_image', label: 'Hero Image', type: 'image' },
      { name: 'phone_overlay_title', label: 'Phone Overlay Title', type: 'text' },
      { name: 'phone_overlay_text', label: 'Phone Overlay Text', type: 'textarea' },
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
      {value && (
        <div style={{ marginBottom: 8, position: 'relative' }}>
          <img src={value} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid #E0E0E0' }} />
          <button onClick={() => onChange('')} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 999, background: '#fff', border: '1px solid #E0E0E0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trash2 size={11} />
          </button>
        </div>
      )}
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px dashed #CCC', background: '#FAFAFA', cursor: 'pointer', fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        <Upload size={13} /> {uploading ? 'Uploading…' : value ? 'Change' : 'Upload Image'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
    </div>
  );
}

// ---- Fields Editor ----
function FieldsEditor({ section, content, onSave }) {
  const [data, setData] = useState(() => {
    const initial = { ...(content || {}) };
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

  function updateField(name, value) {
    setData(prev => ({ ...prev, [name]: value }));
    if (parseError) setParseError('');
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

    setSaving(true);
    try {
      await onSave(section.key, toSave);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{section.icon} {section.label}</h3>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: saving ? '#CCC' : '#F2701D', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {parseError && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, marginBottom: 10 }}>
          ⚠️ {parseError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {section.fields.map(f => (
          <div key={f.name}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>{f.label}</label>
            {f.type === 'image' ? (
              <ImageUpload value={data[f.name] || ''} onChange={(v) => updateField(f.name, v)} />
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
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('hero');
  const [activeView, setActiveView] = useState('sections');
  const [savedMsg, setSavedMsg] = useState('');

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

  async function handleSave(key, data) {
    try {
      const res = await saveBlock(key, data);
      setContent(prev => ({ ...prev, [key]: res.block }));
      setSavedMsg('Saved!');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch (err) { alert(err.message); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 13 }}>Loading content…</div>;

  const currentSection = SECTION_PRESETS.find(s => s.key === activeSection);

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

      {savedMsg && (
        <div style={{ padding: '8px 14px', borderRadius: 6, background: '#ECFDF5', color: '#059669', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          ✓ {savedMsg}
        </div>
      )}

      {activeView === 'products' ? (
        <ProductsManager />
      ) : (
        /* 4-column layout: section list | fields | preview */
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 320px', gap: 14, alignItems: 'start' }}>
          {/* Col 1: Section list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 16 }}>
            {SECTION_PRESETS.map(s => {
              const hasData = content[s.key] && Object.keys(content[s.key]).length > 1;
              return (
                <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
                  padding: '8px 10px', borderRadius: 6, border: 'none', textAlign: 'left',
                  fontSize: 12, fontWeight: activeSection === s.key ? 700 : 500,
                  background: activeSection === s.key ? '#F2701D' : 'transparent',
                  color: activeSection === s.key ? '#fff' : '#555',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span>{s.icon} {s.label}</span>
                  {hasData && activeSection !== s.key && (
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: '#10B981' }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Col 2: Fields editor */}
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, border: '1px solid #F0F0F0' }}>
            <FieldsEditor key={activeSection} section={currentSection} content={content[activeSection] || {}} onSave={handleSave} />
          </div>

          {/* Col 3: Live preview */}
          <div style={{ position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#999', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Eye size={13} /> Live Preview
            </div>
            <div style={{ background: '#F8F8F8', borderRadius: 10, padding: 14, border: '1px solid #F0F0F0' }}>
              <LivePreview section={currentSection} content={content[activeSection] || {}} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
