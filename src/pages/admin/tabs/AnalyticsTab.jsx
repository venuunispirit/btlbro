import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, MapPin, Target } from 'lucide-react';
import { getOrders, getRecords, getTeam, getContent, saveBlock } from '../api.js';
import { CAMPAIGN_CATEGORIES, pct, formatDuration, formatNumber, formatINR } from '../../../utils/campaignMath.js';
import CampaignMiniChart from '../components/CampaignMiniChart.jsx';
import { useFeedback } from '../components/Feedback.jsx';

/* ============================================================
   CampaignAnalyticsPanel — campaign/category analytics manager.
   Reads & writes the SAME source of truth as the website marquee:
   the CMS `marquee` block (site_content.marquee.items). One source,
   zero duplication (req #23). Percentages are always auto-calculated
   via campaignMath (req #12); division by zero renders N/A.
   ============================================================ */
function CampaignAnalyticsPanel() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  useEffect(() => {
    async function load() {
      try {
        const res = await getContent();
        const block = res.content?.marquee || {};
        const list = Array.isArray(block.items) ? block.items : [];
        setItems(list);
        if (list.length > 0) setSelectedId((prev) => prev || String(list[0].title || '0'));
      } catch {}
    }
    load();
  }, []);

  const idx = items.findIndex((it, i) => String(it.title || i) === selectedId);
  const current = idx >= 0 ? items[idx] : null;

  function patchCurrent(patch) {
    if (idx < 0) return;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const block = await getContent();
      const marquee = { ...(block.content?.marquee || {}) };
      const list = Array.isArray(marquee.items) ? [...marquee.items] : [];
      // Re-apply only this campaign's analytics fields onto the saved copy.
      if (idx >= 0 && idx < list.length) {
        list[idx] = {
          ...list[idx],
          estimated_reach: current.estimated_reach, actual_reach: current.actual_reach,
          estimated_return: current.estimated_return, actual_return: current.actual_return,
          total_resources: current.total_resources, resources_utilized: current.resources_utilized,
          analytics: current.analytics,
          category: current.category,
        };
      }
      await saveBlock('marquee', { ...marquee, items: list });
      setSavedMsg('Campaign analytics saved');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (err) {
      notify(err.message);
    } finally { setSaving(false); }
  }

  const filteredItems = items.map((it, i) => ({ it, i }))
    .filter(({ it }) => categoryFilter === 'All' || (it.category || 'Uncategorized') === categoryFilter);

  const reachAchv = current ? pct(current.actual_reach, current.estimated_reach) : 'N/A';
  const returnAchv = current ? pct(current.actual_return, current.estimated_return) : 'N/A';
  const util = current ? pct(current.resources_utilized, current.total_resources) : 'N/A';

  const stat = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', border: '1px solid #F1EDE4' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#949494', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || '#161616', marginTop: 2 }}>{value}</div>
    </div>
  );

  const numField = (label, key, ph) => (
    <div>
      <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#949494', marginBottom: 4 }}>{label}</label>
      <input type="text" inputMode="numeric" value={current?.[key] ?? ''} placeholder={ph}
        onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); patchCurrent({ [key]: raw === '' ? '' : Number(raw) }); }}
        style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 12.5, boxSizing: 'border-box' }} />
    </div>
  );

  if (items.length === 0) {
    return (
      <div style={{ padding: 20, borderRadius: 12, border: '1.5px dashed #E7E2D8', fontSize: 13, color: '#949494', textAlign: 'center', marginBottom: 24 }}>
        No campaigns yet — create one in the <strong>Website → Marquee</strong> section, then manage its analytics here.
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4', marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Target size={16} color="#F2701D" /> Campaign Analytics
      </h3>

      {/* Campaign + category selector (req #12) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 12.5 }}>
          {filteredItems.map(({ it, i }) => <option key={i} value={String(it.title || i)}>{it.title || `Campaign ${i + 1}`}{it.category ? ` · ${it.category}` : ''}</option>)}
        </select>
        {['All', ...CAMPAIGN_CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCategoryFilter(c)}
            style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: categoryFilter === c ? 'none' : '1px solid #E7E2D8', background: categoryFilter === c ? '#F2701D' : '#fff', color: categoryFilter === c ? '#fff' : '#4A4A4A' }}>
            {c}
          </button>
        ))}
      </div>

      {current && (
        <>
          {/* Dates + duration */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#949494', marginBottom: 4 }}>Start Date</label>
              <input type="date" value={current.start_date || ''} onChange={(e) => patchCurrent({ start_date: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 12.5 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: '#949494', marginBottom: 4 }}>End Date</label>
              <input type="date" value={current.end_date || ''} min={current.start_date || undefined} onChange={(e) => patchCurrent({ end_date: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 12.5 }} />
            </div>
            <div style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#FFF4EC', color: '#C2410C' }}>
              Duration: {formatDuration(current.start_date, current.end_date)}
            </div>
          </div>

          {/* Numeric metric controls (reqs #13–#17) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            {numField('Estimated Reach', 'estimated_reach', '250000')}
            {numField('Actual Reach', 'actual_reach', '225000')}
            {numField('Estimated Return (₹)', 'estimated_return', '500000')}
            {numField('Actual Return (₹)', 'actual_return', '450000')}
            {numField('Total Human Resources', 'total_resources', '50')}
            {numField('Human Resources Utilized', 'resources_utilized', '42')}
          </div>

          {/* Auto-calculated percentages */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {stat('Reach Achievement', typeof reachAchv === 'number' ? `${reachAchv}%` : reachAchv, '#2563EB')}
            {stat('Return Achievement', typeof returnAchv === 'number' ? `${returnAchv}%` : returnAchv, '#F2701D')}
            {stat('Resource Utilization', typeof util === 'number' ? `${util}%` : util, '#059669')}
          </div>

          {/* Graph preview — exactly what the frontend popup will render */}
          <div style={{ border: '1px solid #F1EDE4', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4A4A4A', marginBottom: 6 }}>Graph Preview (🔵 Reach / 🟠 Returns — shown on the website popup)</div>
            <CampaignMiniChart
              points={current.analytics || []}
              autoSource={{
                start_date: current.start_date, end_date: current.end_date,
                estimated_reach: current.estimated_reach, actual_reach: current.actual_reach,
                estimated_return: current.estimated_return, actual_return: current.actual_return,
              }}
            />
          </div>

          {/* Achievement data points */}
          <div style={{ border: '1px solid #F1EDE4', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#4A4A4A' }}>Achievement Data (Date / Reach / Returns)</span>
              <button onClick={() => patchCurrent({ analytics: [...(current.analytics || []), { date: '', reach: '', returns: '' }] })}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #F2701D', background: '#FFF4EC', color: '#F2701D', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Add Point
              </button>
            </div>
            {(current.analytics || []).length === 0 && <div style={{ fontSize: 11.5, color: '#949494' }}>No data points yet.</div>}
            {(current.analytics || []).map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input type="date" value={p.date || ''} onChange={(e) => patchCurrent({ analytics: current.analytics.map((q, qi) => (qi === i ? { ...q, date: e.target.value } : q)) })}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #E7E2D8', fontSize: 11.5 }} />
                <input type="text" inputMode="numeric" value={p.reach ?? ''} placeholder="Reach" onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); patchCurrent({ analytics: current.analytics.map((q, qi) => (qi === i ? { ...q, reach: raw === '' ? '' : Number(raw) } : q)) }); }}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #E7E2D8', fontSize: 11.5 }} />
                <input type="text" inputMode="numeric" value={p.returns ?? ''} placeholder="Returns ₹" onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); patchCurrent({ analytics: current.analytics.map((q, qi) => (qi === i ? { ...q, returns: raw === '' ? '' : Number(raw) } : q)) }); }}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #E7E2D8', fontSize: 11.5 }} />
                <button onClick={() => patchCurrent({ analytics: current.analytics.filter((_, qi) => qi !== i) })}
                  style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saving ? '#E7E2D8' : '#F2701D', color: '#fff', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save Campaign Analytics'}
            </button>
            {savedMsg && <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ {savedMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// A short, styled line for "there is genuinely nothing here" — as opposed to
// an unstyled grey word that reads as a rendering failure.
const noData = {
  fontSize: 12.5, color: '#949494', background: '#FAF9F7',
  border: '1px dashed #E7E2D8', borderRadius: 10, padding: '14px 16px',
  lineHeight: 1.5, margin: 0,
};

export default function AnalyticsTab() {
  const { toast, notify } = useFeedback();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [ordersRes, recordsRes, teamRes] = await Promise.allSettled([getOrders(), getRecords({ limit: 500 }), getTeam()]);
        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : [];
        const records = recordsRes.status === 'fulfilled' ? recordsRes.value.records || [] : [];
        const team = teamRes.status === 'fulfilled' ? teamRes.value.members || [] : [];

        // Category breakdown
        const categories = {};
        orders.forEach(o => {
          const cat = o.category || 'Uncategorized';
          categories[cat] = (categories[cat] || 0) + 1;
        });

        // Revenue by status
        const revenue = { pending: 0, processed: 0, paid: 0 };
        orders.forEach(o => {
          const status = o.status || 'pending';
          revenue[status] = (revenue[status] || 0) + (Number(o.invoice?.total) || 0);
        });

        // Type breakdown for locations
        const types = {};
        records.forEach(r => {
          const t = r.data?.type || 'Unknown';
          types[t] = (types[t] || 0) + 1;
        });

        setData({ orders, categories, revenue, types, teamCount: team.length, locationCount: records.length });
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading analytics…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#DC2626' }}>Failed to load analytics</div>;

  const maxCat = Math.max(...Object.values(data.categories), 1);
  const maxType = Math.max(...Object.values(data.types), 1);

  return (
    <div>
      <CampaignAnalyticsPanel />

      {/* Revenue summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Pending Revenue', value: data.revenue.pending, color: '#DC2626' },
          { label: 'Processed Revenue', value: data.revenue.processed, color: '#2563EB' },
          { label: 'Paid Revenue', value: data.revenue.paid, color: '#059669' },
        ].map((item, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4' }}>
            <div style={{ fontSize: 12, color: '#949494', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{item.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: item.color, marginTop: 4 }}>₹{item.value.toLocaleString('en-IN')}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Category breakdown */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Orders by Category</h3>
          {Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span>{cat}</span><span style={{ fontWeight: 600 }}>{count}</span>
              </div>
              <div style={{ height: 6, background: '#F4F1EA', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(count / maxCat) * 100}%`, background: '#F2701D', borderRadius: 3, transition: 'width .3s' }} />
              </div>
            </div>
          ))}
          {Object.keys(data.categories).length === 0 && (
            <p style={noData}>No orders have been placed yet, so there is nothing to split by category.</p>
          )}
        </div>

        {/* Location types */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Locations by Type</h3>
          {Object.entries(data.types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <div key={type} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span>{type}</span><span style={{ fontWeight: 600 }}>{count}</span>
              </div>
              <div style={{ height: 6, background: '#F4F1EA', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(count / maxType) * 100}%`, background: '#0F766E', borderRadius: 3, transition: 'width .3s' }} />
              </div>
            </div>
          ))}
          {Object.keys(data.types).length === 0 && (
            <p style={noData}>No location records are synced yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
