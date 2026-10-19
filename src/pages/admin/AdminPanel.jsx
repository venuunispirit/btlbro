import React, { useState, useCallback, useEffect } from 'react';
import { getStaffUser, adminLogin, adminLogout } from './api.js';
import { FeedbackProvider } from './components/Feedback.jsx';
import './admin.css';
import { getUser } from '../../services/shopClient.js';
import { clearGlobalSearch } from './useGlobalSearch.js';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';

// Tab content pages — pure content, no layout
import DashboardTab from './tabs/DashboardTab.jsx';
import OrdersTab from './tabs/OrdersTab.jsx';
import PaymentsTab from './tabs/PaymentsTab.jsx';
import LeadsTab from './tabs/LeadsTab.jsx';
import LocationsTab from './tabs/LocationsTab.jsx';
import DataTab from './tabs/DataTab.jsx';
import WebsiteTab from './tabs/WebsiteTab.jsx';
import UploadsTab from './tabs/UploadsTab.jsx';
import GoogleDriveTab from './GoogleDriveTab.jsx';
import AnalyticsTab from './tabs/AnalyticsTab.jsx';
import TeamTab from './tabs/TeamTab.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import TeamChatTab from './tabs/TeamChatTab.jsx';
import DepartmentsTab from './tabs/DepartmentsTab.jsx';
import SiteSurveysTab from './tabs/SiteSurveysTab.jsx';
import CompaniesTab from './tabs/CompaniesTab.jsx';
import AccountsTab from './tabs/AccountsTab.jsx';
import VendorsTab from './tabs/VendorsTab.jsx';

const NAV_LABELS = {
  dashboard: 'Dashboard', orders: 'Orders', payments: 'Payments', leads: 'Leads', chat: 'Team Chat', whatsapp: 'WhatsApp',
  companies: 'Companies', accounts: 'Accounts', vendors: 'Vendors',
  team: 'Team', departments: 'Departments', locations: 'Locations', data: 'Data', website: 'Website',
  uploads: 'Uploads', drive: 'Google Drive', analytics: 'Analytics', surveys: 'Site Surveys',
  settings: 'Settings',
};

// One line of orientation under the page name. Only the tabs that need it
// have one — a generic filler line on every page is worse than none.
const NAV_SUBTITLES = {
  payments: 'Pay anyone from a scanned QR or UPI ID, and collect with an amount-locked QR or link.',
};

export default function AdminPanel() {
  const [staff, setStaff] = useState(() => getStaffUser());
  const [tab, setTab] = useState(() => {
    try { return sessionStorage.getItem('btl_admin_tab') || 'dashboard'; } catch { return 'dashboard'; }
  });

  // A logged-in customer (non-team) has no business here — send them home.
  useEffect(() => {
    const raw = getUser();
    if (raw && !raw.is_team) window.location.replace('/');
  }, []);

  // `opts.leadId` lets a tab send you somewhere with a record already open —
  // Leads/Orders/Companies use it to jump straight into the right thread.
  function changeTab(next, opts) {
    setTab(next);
    if (next === 'whatsapp') setChatTarget(opts?.leadId ? { leadId: opts.leadId } : null);
    clearGlobalSearch();
    try { sessionStorage.setItem('btl_admin_tab', next); } catch {}
  }
  const [chatTarget, setChatTarget] = useState(null);
  const [authError, setAuthError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('btl_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  // Mobile drawer. On a phone the 244px rail cannot sit beside the content — it
  // becomes an overlay that slides in from the left (see .admin-sidebar in
  // admin.css). Desktop ignores this entirely and keeps the sticky rail.
  const [navOpen, setNavOpen] = useState(false);

  // The drawer covers the page, so the page behind it must not scroll away.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [navOpen]);

  // Escape closes it, matching the drawer pattern users already know.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('btl_sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  }

  // Compute allowed tabs based on role
  function can(level) {
    const lv = { member: 0, recee: 0, bd_executive: 1, ops_executive: 1, manager: 1, recee_manager: 1, bdm: 2, ops_manager: 2, super_admin: 3 }[staff?.role || 'member'];
    return lv !== undefined && lv >= level;
  }

  const allowedTabs = ['dashboard', 'orders', 'payments', 'leads', 'chat', 'whatsapp', 'companies', 'accounts', 'vendors', 'team', 'departments', 'locations', 'data', 'website', 'uploads', 'drive', 'analytics', 'surveys', 'settings']
    .filter(id => {
      const mins = { dashboard: 0, orders: 0, leads: 1, chat: 1, whatsapp: 1, companies: 1, team: 2, departments: 2, locations: 0, data: 1, website: 1, uploads: 1, drive: 1, analytics: 1, surveys: 2, settings: 3 };
      // Money moves here, so this is Manager and above. The `manager` role sits
      // at level 1 in the matrix, hence the explicit allowance alongside surveys.
      if (id === 'payments') return can(2) || staff?.role === 'manager';
      if (id === 'accounts') return can(2) || staff?.role === 'manager';
      // Vendors is the money-OUT side, so it mirrors the server's PAYOUT_ROLES
      // (manager, bdm, ops_manager, super_admin) rather than a level check.
      if (id === 'vendors') return ['manager', 'bdm', 'ops_manager', 'super_admin'].includes(staff?.role || '');
      if (id === 'surveys') return can(2) || ['manager', 'recee_manager'].includes(staff?.role || '');
      // Accounts mirror the server's ACCOUNT_ROLES allowlist exactly. A level
      // check would wrongly admit recee_manager / ops_executive, who the API
      // rejects with a 403 — better to hide the tab than show a broken one.
      if (id === 'companies') return ['bd_executive', 'manager', 'bdm', 'ops_manager', 'super_admin'].includes(staff?.role || '');
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

  // A token can outlive the session behind it (server restarted, session
  // removed, account deactivated). Any panel's 401 clears the token and pings
  // this event; drop straight back to the sign-in screen with an explanation
  // instead of leaving an empty dashboard that looks like lost data.
  useEffect(() => {
    const onExpired = () => {
      setStaff(null);
      setAuthError('Your session expired. Please sign in again.');
    };
    window.addEventListener('btl:session-expired', onExpired);
    return () => window.removeEventListener('btl:session-expired', onExpired);
  }, []);

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
      case 'dashboard':  return <DashboardTab onNavigate={changeTab} />;
      case 'orders':     return <OrdersTab onNavigate={changeTab} />;
      case 'payments':   return <PaymentsTab />;
      case 'leads':      return <LeadsTab onNavigate={changeTab} />;
      case 'chat':       return <TeamChatTab />;
      case 'whatsapp':   return <ChatTab target={chatTarget} />;
      case 'companies':   return <CompaniesTab onNavigate={changeTab} />;
      case 'accounts':    return <AccountsTab onNavigate={changeTab} />;
      case 'vendors':     return <VendorsTab onNavigate={changeTab} />;
      case 'team':       return <TeamTab />;
      case 'departments': return <DepartmentsTab />;
      case 'locations':  return <LocationsTab />;
      case 'data':       return <DataTab />;
      case 'website':    return <WebsiteTab staff={staff} />;
      case 'uploads':    return <UploadsTab />;
      case 'drive':      return <GoogleDriveTab />;
      case 'analytics':  return <AnalyticsTab />;
      case 'surveys':    return <SiteSurveysTab />;
      case 'settings':   return <SettingsTab />;
      default:           return <DashboardTab onNavigate={changeTab} />;
    }
  };

  return (
    <FeedbackProvider>
    <div className="admin-root" style={panelStyles.app}>
      <Sidebar staff={staff} activeTabId={activeTabId} onNavigate={changeTab} onLogout={handleLogout} collapsed={collapsed} onToggleCollapse={toggleCollapse} open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="admin-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div style={panelStyles.main}>
        <Topbar
          staff={staff}
          activeLabel={NAV_LABELS[activeTabId]}
          subtitle={NAV_SUBTITLES[activeTabId]}
          onNavigate={changeTab}
          onOpenMenu={() => setNavOpen(true)}
        />
        <div className="admin-content" style={panelStyles.content}>
          {renderTab()}
        </div>
      </div>
    </div>
    </FeedbackProvider>
  );
}

// ---- Panel layout styles ----
const panelStyles = {
  app: { display: 'flex', minHeight: '100vh' },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  content: { padding: 26, flex: 1, background: '#FAF9F7', minWidth: 0 },
};

// ---- Login styles ----
const loginStyles = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(1200px 600px at 80% -10%, rgba(242,112,29,0.14), transparent 60%), #FAF9F7',
    padding: 24, fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    width: 400, maxWidth: '100%', background: '#fff', borderRadius: 18,
    padding: '38px 42px', boxShadow: '0 20px 60px rgba(17,17,17,0.10)',
    border: '1px solid #F1EDE4',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logoMark: {
    width: 38, height: 38, borderRadius: 10, background: '#161616', color: '#F2701D',
    fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' },
  sub: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, color: '#949494' },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  hint: { color: '#949494', fontSize: 13, margin: '6px 0 22px' },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginTop: 4 },
  input: {
    height: 44, borderRadius: 10, border: '1.5px solid #E7E2D8',
    padding: '0 14px', fontSize: 14, outline: 'none', transition: 'border .15s',
  },
  error: { background: '#FEF2F2', color: '#DC2626', fontSize: 13, padding: '9px 12px', borderRadius: 8 },
  btn: {
    height: 48, borderRadius: 10, border: 'none',
    background: 'linear-gradient(135deg,#F2701D,#F2701D 60%,#C2410D)',
    color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8,
  },
  foot: { fontSize: 12, color: '#949494', marginTop: 18, textAlign: 'center', lineHeight: 1.5 },
};
