import React from 'react';
import {
  LayoutDashboard, CreditCard, MapPin, Upload, FileSpreadsheet,
  BarChart3, Settings as SettingsIcon, Users, Palette, Table2, LogOut,
  Shield, Globe, Target, MessageSquare, Layers, Camera, Wallet,
  PanelLeftClose, PanelLeftOpen, Building2, Truck, X,
} from 'lucide-react';

const ROLES = {
  member: { label: 'Member', color: '#F2701D' },
  recee: { label: 'Recee Team', color: '#0D9488' },
  recee_manager: { label: 'Recee Manager', color: '#0F766E' },
  bd_executive: { label: 'BD Executive', color: '#2563EB' },
  ops_executive: { label: 'Ops Executive', color: '#7C3AED' },
  manager: { label: 'Manager', color: '#8A2BE2' },
  bdm: { label: 'BDM', color: '#059669' },
  ops_manager: { label: 'Ops Manager', color: '#D97706' },
  super_admin: { label: 'Super Admin', color: '#161616' },
};

const SIDEBAR_W = 244;
const SIDEBAR_COLLAPSED_W = 64;

export default function Sidebar({ staff, activeTabId, onNavigate, onLogout, collapsed, onToggleCollapse, open, onClose }) {
  const role = staff?.role || 'member';
  const roleMeta = ROLES[role] || ROLES.member;
  const isCollapsed = !!collapsed;

  function can(level) {
    const lv = { member: 0, recee: 0, bd_executive: 1, ops_executive: 1, manager: 1, recee_manager: 1, bdm: 2, ops_manager: 2, super_admin: 3 }[role];
    return lv !== undefined && lv >= level;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, min: 0 },
    { id: 'leads', label: 'Leads', icon: Target, min: 1 },
    { id: 'orders', label: 'Orders', icon: CreditCard, min: 0 },
    { id: 'payments', label: 'Payments', icon: Wallet, min: 2, also: ['manager'] },
    { id: 'chat', label: 'Chat', icon: MessageSquare, min: 1 },
    { id: 'companies', label: 'Companies', icon: Building2, also: ['bd_executive', 'manager', 'bdm', 'ops_manager', 'super_admin'] },
    { id: 'accounts', label: 'Accounts', icon: Wallet, min: 2, also: ['manager'] },
    { id: 'vendors', label: 'Vendors', icon: Truck, also: ['manager', 'bdm', 'ops_manager', 'super_admin'] },
    { id: 'team', label: 'Team', icon: Users, min: 2 },
    { id: 'departments', label: 'Departments', icon: Layers, min: 2 },
    { id: 'locations', label: 'Locations', icon: MapPin, min: 0 },
    { id: 'data', label: 'Data', icon: Table2, min: 1 },
    { id: 'website', label: 'Website', icon: Globe, min: 1 },
    { id: 'uploads', label: 'Uploads', icon: Upload, min: 1 },
    { id: 'drive', label: 'Google Drive', icon: FileSpreadsheet, min: 1 },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, min: 1 },
    { id: 'surveys', label: 'Site Surveys', icon: Camera, min: 2, also: ['manager', 'recee_manager'] },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, min: 3 },
  ].filter((n) => can(n.min) || (n.also || []).includes(role));

  // On narrow screens the drawer is a full overlay, so it always renders its
  // labels even if the desktop collapse preference is on. `open` is only ever
  // true on a phone (the desktop rail is never a drawer), so this changes
  // nothing on desktop.
  const mini = isCollapsed && !open;
  const W = mini ? SIDEBAR_COLLAPSED_W : SIDEBAR_W;

  return (
    <aside className="admin-sidebar" data-open={open ? 'true' : 'false'} style={{ ...styles.sidebar, width: W, height: '100dvh', flexShrink: 0 }}>
      {/* Top: Brand + Collapse toggle */}
      <div style={styles.topRow}>
        <div style={{ ...styles.brand, justifyContent: mini ? 'center' : 'flex-start' }}>
          <span style={styles.brandMark}>B</span>
          {!mini && (
            <div>
              <div style={styles.brandName}>BTL<span style={{ color: '#F2701D' }}>bro</span></div>
              <div style={styles.brandTag}>Admin</div>
            </div>
          )}
        </div>
        {!mini && (
          <button className="admin-collapse-btn" onClick={onToggleCollapse} style={styles.collapseBtn} title="Collapse sidebar">
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* Drawer-only close. The desktop sidebar collapses in place, so it has no
          dismissal control — on mobile it covers the page and needs one. */}
      {open && <button className="admin-sidebar-close" onClick={onClose} title="Close menu" aria-label="Close menu" />}

      {/* Expanded collapse button when collapsed — centred below brand */}
      {isCollapsed && !open && (
        <div className="collapsed-toggle-wrap">
          <button className="admin-collapse-btn" onClick={onToggleCollapse} style={styles.collapseBtnCentered} title="Expand sidebar">
            <PanelLeftOpen size={18} />
          </button>
        </div>
      )}

      {/* Staff card — hidden when collapsed */}
      {!mini && (
        <div style={styles.staffCard}>
          <div style={styles.staffAvatar}>{staff.name?.charAt(0).toUpperCase() || 'U'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.staffName}>{staff.name}</div>
            <div style={styles.staffRole}>{roleMeta.label}</div>
          </div>
        </div>
      )}

      {/* Collapsed avatar — just the initial */}
      {isCollapsed && (
        <div style={styles.collapsedAvatar} title={`${staff.name} — ${roleMeta.label}`}>
          {staff.name?.charAt(0).toUpperCase() || 'U'}
        </div>
      )}

      {/* Navigation */}
      <nav style={styles.nav}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTabId;
          return (
            <button
              key={item.id}
              className="admin-nav-item"
              onClick={() => { onNavigate(item.id); onClose?.(); }}
              title={mini ? item.label : undefined}
              aria-current={isActive ? 'page' : undefined}
              style={{
                ...styles.navItem,
                justifyContent: mini ? 'center' : 'flex-start',
                padding: mini ? '11px 0' : '11px 12px',
                ...(isActive ? styles.navItemActive : {}),
              }}
            >
              <Icon size={17} style={{ flexShrink: 0 }} />
              {!mini && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom section: role info + sign out */}
      <div style={styles.bottomSection}>
        {!mini && (
          <div style={styles.sidebarFoot}>
            <Shield size={14} style={{ marginRight: 6, opacity: 0.7 }} />
            Role-based access · {roleMeta.label}
          </div>
        )}
        <button
          onClick={onLogout}
          style={{ ...styles.logoutBtn, justifyContent: mini ? 'center' : 'flex-start' }}
          title="Sign out"
        >
          <LogOut size={17} style={{ flexShrink: 0 }} />
          {!mini && <span style={{ marginLeft: 10, fontSize: 13.5, fontWeight: 500 }}>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    background: '#161616', color: '#EDEDED',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    transition: 'width 0.2s ease',
    overflow: 'hidden',
  },
  topRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 16px 14px',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  brandMark: {
    width: 34, height: 34, borderRadius: 9, background: '#fff', color: '#161616',
    fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  brandName: { fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', whiteSpace: 'nowrap' },
  brandTag: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.6, color: '#949494' },
  collapseBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)', color: '#949494', cursor: 'pointer',
    transition: 'all .15s', flexShrink: 0,
  },
  collapsedToggleWrap: {
    display: 'flex', justifyContent: 'center', padding: '0 0 6px',
  },
  collapseBtnCentered: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)', color: '#949494', cursor: 'pointer',
    transition: 'all .15s',
  },
  staffCard: {
    display: 'flex', alignItems: 'center', gap: 10,
    margin: '8px 14px 6px', padding: 10, borderRadius: 12,
    background: 'rgba(255,255,255,0.06)',
  },
  staffAvatar: {
    width: 34, height: 34, borderRadius: 50, background: '#F2701D', color: '#fff',
    fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  collapsedAvatar: {
    width: 34, height: 34, borderRadius: 50, background: '#F2701D', color: '#fff',
    fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '8px auto 6px', flexShrink: 0,
  },
  staffName: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  staffRole: { fontSize: 11, color: '#949494', marginTop: 2 },
  nav: {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px',
    flex: 1, overflowY: 'auto',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
    color: '#949494', fontSize: 13.5, fontWeight: 500, padding: '11px 12px',
    borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
    whiteSpace: 'nowrap',
  },
  navItemActive: { background: '#F2701D', color: '#fff', fontWeight: 600 },
  bottomSection: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  sidebarFoot: {
    padding: '14px 20px 6px', fontSize: 11.5, color: '#949494',
    display: 'flex', alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  logoutBtn: {
    display: 'flex', alignItems: 'center',
    background: 'none', border: 'none',
    color: '#949494', cursor: 'pointer', padding: '14px 20px',
    transition: 'color .15s', width: '100%', whiteSpace: 'nowrap',
  },
};
