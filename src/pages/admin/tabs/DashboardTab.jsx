import React, { useState, useEffect } from 'react';
import { LayoutDashboard, CreditCard, MapPin, Users, TrendingUp, Package, Clock } from 'lucide-react';
import { getOrders, getTeam, getRecords, getSettings, getDriveStatus } from '../api.js';

const STAT_COLORS = ['#F2701D', '#8A2BE2', '#10B981', '#3B82F6', '#EF4444'];

export default function DashboardTab({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [ordersRes, teamRes, recordsRes, settingsRes, driveRes] = await Promise.allSettled([
          getOrders(),
          getTeam(),
          getRecords({ limit: 500 }),
          getSettings(),
          getDriveStatus(),
        ]);

        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : [];
        const team = teamRes.status === 'fulfilled' ? teamRes.value.members || [] : [];
        const records = recordsRes.status === 'fulfilled' ? recordsRes.value.records || [] : [];
        const settings = settingsRes.status === 'fulfilled' ? settingsRes.value.settings || {} : {};
        const drive = driveRes.status === 'fulfilled' ? driveRes.value : {};

        const totalRevenue = orders.reduce((s, o) => s + (Number(o.invoice?.total) || 0), 0);
        const pendingOrders = orders.filter(o => o.status === 'pending').length;
        const processedOrders = orders.filter(o => o.status === 'processed' || o.status === 'paid').length;

        setStats({
          totalOrders: orders.length,
          totalRevenue,
          pendingOrders,
          processedOrders,
          teamCount: team.length,
          locationCount: records.length,
          syncStatus: drive.lastSyncStatus || 'unknown',
          lastSync: drive.lastSyncAt || null,
        });
        setRecentOrders(orders.slice(-5).reverse());
      } catch (e) {
        console.error('Dashboard load error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading dashboard…</div>;
  if (!stats) return <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Failed to load dashboard data</div>;

  const cards = [
    { label: 'Total Orders', value: stats.totalOrders, icon: CreditCard, color: STAT_COLORS[0] },
    { label: 'Revenue', value: `₹${stats.totalRevenue.toLocaleString('en-IN')}`, icon: TrendingUp, color: STAT_COLORS[1] },
    { label: 'Pending', value: stats.pendingOrders, icon: Clock, color: STAT_COLORS[4] },
    { label: 'Team Members', value: stats.teamCount, icon: Users, color: STAT_COLORS[2] },
    { label: 'Locations', value: stats.locationCount, icon: MapPin, color: STAT_COLORS[3] },
    { label: 'Processed', value: stats.processedOrders, icon: Package, color: STAT_COLORS[2] },
  ];

  return (
    <div>
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 14, marginBottom: 28 }}>
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} style={{
              background: '#fff', borderRadius: 14, padding: '18px 20px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, background: c.color + '14',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={20} style={{ color: c.color }} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#999', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{c.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sync status + Recent orders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 18 }}>
        {/* Sync card */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Sheet Sync</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#888', fontSize: 13 }}>Status</span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999,
                background: stats.syncStatus === 'success' ? '#ECFDF5' : '#FEF2F2',
                color: stats.syncStatus === 'success' ? '#059669' : '#DC2626',
              }}>{stats.syncStatus}</span>
            </div>
            {stats.lastSync && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888', fontSize: 13 }}>Last Sync</span>
                <span style={{ fontSize: 13 }}>{new Date(stats.lastSync).toLocaleString()}</span>
              </div>
            )}
          </div>
          <button onClick={() => onNavigate?.('drive')} style={{
            marginTop: 16, width: '100%', padding: 10, borderRadius: 8, border: '1px solid #E0E0E0',
            background: '#FAFAFA', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#333',
          }}>Manage Sync →</button>
        </div>

        {/* Recent orders */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Recent Orders</h3>
            <button onClick={() => onNavigate?.('orders')} style={{
              fontSize: 12, fontWeight: 600, color: '#F2701D', background: 'none', border: 'none', cursor: 'pointer',
            }}>View All →</button>
          </div>
          {recentOrders.length === 0 ? (
            <p style={{ color: '#999', fontSize: 13 }}>No orders yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentOrders.map(o => (
                <div key={o.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: 8, background: '#FAFAFA', fontSize: 13,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.businessName || o.contactName || `Order #${o.id}`}</div>
                    <div style={{ color: '#999', fontSize: 11 }}>{o.contactName}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>₹{(Number(o.invoice?.total) || 0).toLocaleString('en-IN')}</div>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 999,
                      background: o.status === 'paid' ? '#ECFDF5' : o.status === 'processed' ? '#EFF6FF' : '#FEF2F2',
                      color: o.status === 'paid' ? '#059669' : o.status === 'processed' ? '#2563EB' : '#DC2626',
                      fontWeight: 600,
                    }}>{o.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
