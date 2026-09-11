import React, { useState, useCallback } from 'react';
import { getStaffUser, adminLogin, adminLogout } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';

// Tab content pages — pure content, no layout
import DashboardTab from './tabs/DashboardTab.jsx';
import OrdersTab from './tabs/OrdersTab.jsx';
import LocationsTab from './tabs/LocationsTab.jsx';
import DataTab from './tabs/DataTab.jsx';
import WebsiteTab from './tabs/WebsiteTab.jsx';
import UploadsTab from './tabs/UploadsTab.jsx';
import GoogleDriveTab from './GoogleDriveTab.jsx';
import AnalyticsTab from './tabs/AnalyticsTab.jsx';
import TeamTab from './tabs/TeamTab.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';

const NAV_LABELS = {
  dashboard: 'Dashboard', orders: 'Orders', team: 'Team',
  locations: 'Locations', data: 'Data', website: 'Website',
  uploads: 'Uploads', drive: 'Google Drive', analytics: 'Analytics',
  settings: 'Settings',
};

export default function AdminPanel() {
  const [staff, setStaff] = useState(() => getStaffUser());
  const [tab, setTab] = useState('dashboard');
  const [authError, setAuthError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');

  // Compute allowed tabs based on role
  function can(level) {
    const lv = { member: 0, manager: 1, super_admin: 2 }[staff?.role || 'member'];
    return lv !== undefined && lv >= level;
  }

  const allowedTabs = ['dashboard', 'orders', 'team', 'locations', 'data', 'website', 'uploads', 'drive', 'analytics', 'settings']
    .filter(id => {
      const mins = { dashboard: 0, orders: 0, locations: 0, team: 1, data: 1, website: 1, uploads: 1, drive: 1, analytics: 1, settings: 2 };
      return can(mins[id] || 0);
    });
  const activeTabId = allowedTabs.includes(tab) ? tab : (allowedTabs[0] || 'dashboard');

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError('');
    try {
      const data = await adminLogin(authEmail.trim(), authPass);
      setStaff(data.user);
    } catch (err) {
      setAuthError(err.message || 'Login failed');
    }
  }

  function handleLogout() {
    adminLogout().finally(() => setStaff(null));
  }

  // ---- Login gate ----
  if (!staff) {
    return (
      <div style={loginStyles.wrap}>
        <div style={loginStyles.card}>
          <div style={loginStyles.logo}>
            <span style={loginStyles.logoMark}>B</span>
            <div>
              <div style={loginStyles.brand}>BTL<span style={{ color: '#F2701D' }}>bro</span></div>
              <div style={loginStyles.sub}>Admin Panel</div>
            </div>
          </div>
          <h2 style={loginStyles.title}>Welcome back</h2>
          <p style={loginStyles.hint}>Sign in with your team account.</p>
          <form onSubmit={handleLogin} style={loginStyles.form}>
            <label style={loginStyles.fieldLabel}>Email</label>
            <input style={loginStyles.input} type="email" value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@btlbro.in" required />
            <label style={loginStyles.fieldLabel}>Password</label>
            <input style={loginStyles.input} type="password" value={authPass}
              onChange={(e) => setAuthPass(e.target.value)} placeholder="••••••••" required />
            {authError && <div style={loginStyles.error}>{authError}</div>}
            <button style={loginStyles.btn} type="submit">Sign in to panel</button>
          </form>
          <div style={loginStyles.foot}>
            Same login as the website — your role determines panel access.
          </div>
        </div>
      </div>
    );
  }

  // ---- Main panel: Sidebar | Topbar + Content ----
  const renderTab = () => {
    switch (activeTabId) {
      case 'dashboard':  return <DashboardTab onNavigate={setTab} />;
      case 'orders':     return <OrdersTab />;
      case 'team':       return <TeamTab />;
      case 'locations':  return <LocationsTab />;
      case 'data':       return <DataTab />;
      case 'website':    return <WebsiteTab staff={staff} />;
      case 'uploads':    return <UploadsTab />;
      case 'drive':      return <GoogleDriveTab />;
      case 'analytics':  return <AnalyticsTab />;
      case 'settings':   return <SettingsTab />;
      default:           return <DashboardTab onNavigate={setTab} />;
    }
  };

  return (
    <div style={panelStyles.app}>
      <Sidebar staff={staff} activeTabId={activeTabId} onNavigate={setTab} onLogout={handleLogout} />
      <div style={panelStyles.main}>
        <Topbar staff={staff} activeLabel={NAV_LABELS[activeTabId]} />
        <div style={panelStyles.content}>
          {renderTab()}
        </div>
      </div>
    </div>
  );
}

// ---- Panel layout styles ----
const panelStyles = {
  app: { display: 'flex', minHeight: '100vh' },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  content: { padding: 26, flex: 1, background: '#F6F7F9' },
};

// ---- Login styles ----
const loginStyles = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(1200px 600px at 80% -10%, rgba(242,112,29,0.14), transparent 60%), #F6F7F9',
    padding: 24, fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    width: 400, maxWidth: '100%', background: '#fff', borderRadius: 18,
    padding: '38px 42px', boxShadow: '0 20px 60px rgba(17,17,17,0.10)',
    border: '1px solid #ECECEC',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logoMark: {
    width: 38, height: 38, borderRadius: 10, background: '#111', color: '#F2701D',
    fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' },
  sub: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, color: '#999' },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  hint: { color: '#777', fontSize: 13, margin: '6px 0 22px' },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#555', marginTop: 4 },
  input: {
    height: 44, borderRadius: 10, border: '1.5px solid #E0E0E0',
    padding: '0 14px', fontSize: 14, outline: 'none', transition: 'border .15s',
  },
  error: { background: '#FDECEC', color: '#C0392B', fontSize: 13, padding: '9px 12px', borderRadius: 8 },
  btn: {
    height: 48, borderRadius: 10, border: 'none',
    background: 'linear-gradient(135deg,#F2711C,#F2701D 60%,#E05E0F)',
    color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8,
  },
  foot: { fontSize: 12, color: '#999', marginTop: 18, textAlign: 'center', lineHeight: 1.5 },
};
