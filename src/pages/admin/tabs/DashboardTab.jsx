import React, { useState, useEffect } from 'react';
import { LayoutDashboard, CreditCard, MapPin, Users, TrendingUp, Package, Clock, Wallet } from 'lucide-react';
import { getOrders, getTeam, getRecords, getDriveStatus, getUpiSummary, staffRole } from '../api.js';

const STAT_COLORS = ['#F2701D', '#8A2BE2', '#10B981', '#2563EB', '#DC2626'];

export default function DashboardTab({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        // The UPI summary is behind the Payments gate (manager+), but the
        // dashboard is visible to every role including `member`. Asking for it
        // unconditionally would just log a 403 for the roles that can't have
        // it, so only roles that can see money even ask.
        const canSeeMoney = ['manager', 'bdm', 'ops_manager', 'super_admin'].includes(staffRole());

        const [ordersRes, teamRes, recordsRes, driveRes, moneyRes] = await Promise.allSettled([
          getOrders(),
          getTeam(),
          getRecords({ limit: 500 }),
          getDriveStatus(),
          canSeeMoney ? getUpiSummary() : Promise.resolve(null),
        ]);

        const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : [];
        const team = teamRes.status === 'fulfilled' ? teamRes.value.members || [] : [];
        const records = recordsRes.status === 'fulfilled' ? recordsRes.value.records || [] : [];
        const drive = driveRes.status === 'fulfilled' ? driveRes.value : {};
        const money = moneyRes.status === 'fulfilled' && moneyRes.value ? moneyRes.value : null;

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
          // `null` for roles without money access, so the cards below can hide
          // themselves instead of showing a misleading ₹0.
          collected: money ? Number(money.in_paid) || 0 : null,
          awaiting: money ? (Number(money.in_pending) || 0) + (Number(money.in_failed) || 0) : null,
          movements: money ? Number(money.count) || 0 : null,
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

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#949494' }}>Loading dashboard…</div>;
  if (!stats) return <div style={{ padding: 40, textAlign: 'center', color: '#DC2626' }}>Failed to load dashboard data</div>;

  const cards = [
    { label: 'Total Orders', value: stats.totalOrders, icon: CreditCard, color: STAT_COLORS[0] },
    { label: 'Revenue', value: `₹${stats.totalRevenue.toLocaleString('en-IN')}`, icon: TrendingUp, color: STAT_COLORS[1] },
    { label: 'Pending', value: stats.pendingOrders, icon: Clock, color: STAT_COLORS[4] },
    { label: 'Team Members', value: stats.teamCount, icon: Users, color: STAT_COLORS[2] },
    { label: 'Locations', value: stats.locationCount, icon: MapPin, color: STAT_COLORS[3] },
    { label: 'Processed', value: stats.processedOrders, icon: Package, color: STAT_COLORS[2] },
  ];

  // Money actually received, straight from the ledger. Only rendered for the
  // roles that can open the Payments tab, so a `member` never sees a ₹0 that
  // reads like "we've collected nothing" when it's really "you can't see this".
  const moneyCards = stats.collected === null ? [] : [
    { label: 'Collected', value: `₹${stats.collected.toLocaleString('en-IN')}`, icon: Wallet, color: '#059669', tab: 'payments' },
    { label: 'Awaiting', value: stats.awaiting, icon: Clock, color: '#B45309', tab: 'payments' },
    { label: 'Movements', value: stats.movements, icon: CreditCard, color: '#2563EB', tab: 'payments' },
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
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, background: c.color + '14',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={20} style={{ color: c.color }} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: '#949494', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{c.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Money actually received — ledger-driven, not order-invoice-driven */}
      {moneyCards.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Money In</h3>
            <button onClick={() => onNavigate?.('payments')} style={{
              fontSize: 12, fontWeight: 600, color: '#F2701D', background: 'none', border: 'none', cursor: 'pointer',
            }}>Open Payments →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 14, marginBottom: 28 }}>
            {moneyCards.map((c, i) => {
              const Icon = c.icon;
              return (
                <div key={i} style={{
                  background: '#fff', borderRadius: 14, padding: '18px 20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 12, background: c.color + '14',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Icon size={20} style={{ color: c.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: '#949494', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{c.value}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Sync status + Recent orders. auto-fit so the pair stacks on a phone
          instead of squeezing two cards into a 320px row. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 18 }}>
        {/* Sync card */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Sheet Sync</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#949494', fontSize: 13 }}>Status</span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999,
                background: stats.syncStatus === 'success' ? '#ECFDF5' : '#FEF2F2',
                color: stats.syncStatus === 'success' ? '#059669' : '#DC2626',
              }}>{stats.syncStatus}</span>
            </div>
            {stats.lastSync && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#949494', fontSize: 13 }}>Last Sync</span>
                <span style={{ fontSize: 13 }}>{new Date(stats.lastSync).toLocaleString()}</span>
              </div>
            )}
          </div>
          <button onClick={() => onNavigate?.('drive')} style={{
            marginTop: 16, width: '100%', padding: 10, borderRadius: 8, border: '1px solid #E7E2D8',
            background: '#FAF9F7', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#161616',
          }}>Manage Sync →</button>
        </div>

        {/* Recent orders */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F1EDE4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Recent Orders</h3>
            <button onClick={() => onNavigate?.('orders')} style={{
              fontSize: 12, fontWeight: 600, color: '#F2701D', background: 'none', border: 'none', cursor: 'pointer',
            }}>View All →</button>
          </div>
          {recentOrders.length === 0 ? (
            <p style={{ color: '#949494', fontSize: 13 }}>No orders yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentOrders.map(o => (
                <div key={o.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: 8, background: '#FAF9F7', fontSize: 13,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{o.businessName || o.contactName || `Order #${o.id}`}</div>
                    <div style={{ color: '#949494', fontSize: 11 }}>{o.contactName}</div>
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
