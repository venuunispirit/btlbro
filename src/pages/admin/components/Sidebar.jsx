import React from 'react';
import {
  LayoutDashboard, CreditCard, MapPin, Upload, FileSpreadsheet,
  BarChart3, Settings as SettingsIcon, Users, Palette, Table2, LogOut,
  Shield, Globe,
} from 'lucide-react';

const ROLES = {
  member: { label: 'Member', color: '#F2701D' },
  manager: { label: 'Manager', color: '#8A2BE2' },
  super_admin: { label: 'Super Admin', color: '#111' },
};

export default function Sidebar({ staff, activeTabId, onNavigate, onLogout }) {
  const role = staff?.role || 'member';
  const roleMeta = ROLES[role] || ROLES.member;

  function can(level) {
    const lv = { member: 0, manager: 1, super_admin: 2 }[role];
    return lv !== undefined && lv >= level;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, min: 0 },
    { id: 'orders', label: 'Orders', icon: CreditCard, min: 0 },
    { id: 'team', label: 'Team', icon: Users, min: 1 },
    { id: 'locations', label: 'Locations', icon: MapPin, min: 0 },
    { id: 'data', label: 'Data', icon: Table2, min: 1 },
    { id: 'website', label: 'Website', icon: Globe, min: 1 },
    { id: 'uploads', label: 'Uploads', icon: Upload, min: 1 },
    { id: 'drive', label: 'Google Drive', icon: FileSpreadsheet, min: 1 },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, min: 1 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, min: 2 },
  ].filter((n) => can(n.min));

  return (
    <aside style={styles.sidebar}>
      {/* Brand */}
      <div style={styles.brand}>
        <span style={styles.brandMark}>B</span>
        <div>
          <div style={styles.brandName}>BTL<span style={{ color: '#F2701D' }}>bro</span></div>
          <div style={styles.brandTag}>Admin</div>
        </div>
      </div>

      {/* Staff card */}
      <div style={styles.staffCard}>
        <div style={styles.staffAvatar}>{staff.name?.charAt(0).toUpperCase() || 'U'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.staffName}>{staff.name}</div>
          <div style={styles.staffRole}>{roleMeta.label}</div>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav style={styles.nav}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTabId;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)} style={{
              ...styles.navItem, ...(isActive ? styles.navItemActive : {}),
            }}>
              <Icon size={17} style={{ flexShrink: 0 }} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={styles.sidebarFoot}>
        <Shield size={14} style={{ marginRight: 6, opacity: 0.7 }} />
        Role-based access · {roleMeta.label}
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 244, background: '#141416', color: '#EDEDED',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '20px 20px 14px',
  },
  brandMark: {
    width: 34, height: 34, borderRadius: 9, background: '#fff', color: '#111',
    fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brandName: { fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' },
  brandTag: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.6, color: '#777' },
  staffCard: {
    display: 'flex', alignItems: 'center', gap: 10,
    margin: '8px 14px 6px', padding: 10, borderRadius: 12,
    background: 'rgba(255,255,255,0.06)',
  },
  staffAvatar: {
    width: 34, height: 34, borderRadius: 50, background: '#F2701D', color: '#fff',
    fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  staffName: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  staffRole: { fontSize: 11, color: '#9A9A9A', marginTop: 2 },
  logoutBtn: { background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 6, borderRadius: 8 },
  nav: {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px',
    flex: 1, overflowY: 'auto',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
    color: '#A6A6A6', fontSize: 13.5, fontWeight: 500, padding: '11px 12px',
    borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
  },
  navItemActive: { background: '#F2701D', color: '#fff', fontWeight: 600 },
  sidebarFoot: {
    padding: '16px 20px', fontSize: 11.5, color: '#7a7a7a',
    display: 'flex', alignItems: 'center',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
};
