import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, MapPin } from 'lucide-react';
import { getOrders, getRecords, getTeam } from '../api.js';

export default function AnalyticsTab() {
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

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading analytics…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Failed to load analytics</div>;

  const maxCat = Math.max(...Object.values(data.categories), 1);
  const maxType = Math.max(...Object.values(data.types), 1);

  return (
    <div>
      {/* Revenue summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Pending Revenue', value: data.revenue.pending, color: '#DC2626' },
          { label: 'Processed Revenue', value: data.revenue.processed, color: '#2563EB' },
          { label: 'Paid Revenue', value: data.revenue.paid, color: '#059669' },
        ].map((item, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
            <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{item.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: item.color, marginTop: 4 }}>₹{item.value.toLocaleString('en-IN')}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Category breakdown */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Orders by Category</h3>
          {Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span>{cat}</span><span style={{ fontWeight: 600 }}>{count}</span>
              </div>
              <div style={{ height: 6, background: '#F0F0F0', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(count / maxCat) * 100}%`, background: '#F2701D', borderRadius: 3, transition: 'width .3s' }} />
              </div>
            </div>
          ))}
          {Object.keys(data.categories).length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No data</p>}
        </div>

        {/* Location types */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Locations by Type</h3>
          {Object.entries(data.types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <div key={type} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span>{type}</span><span style={{ fontWeight: 600 }}>{count}</span>
              </div>
              <div style={{ height: 6, background: '#F0F0F0', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(count / maxType) * 100}%`, background: '#8A2BE2', borderRadius: 3, transition: 'width .3s' }} />
              </div>
            </div>
          ))}
          {Object.keys(data.types).length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No data</p>}
        </div>
      </div>
    </div>
  );
}
