import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { Menu, X, ShoppingCart, User, LogOut, Package, ChevronDown, Eye, EyeOff } from "lucide-react";
import { getUser, setSession, clearSession, login as apiLogin, register as apiRegister, logout as apiLogout, me } from "../services/shopClient.js";

const TABS = [
  { id: "marketing", label: "Neighbourhood Marketing Tool" },
  { id: "website", label: "Website" },
  { id: "products", label: "Products" },
];

export default function Navbar({ activeTab, onTabChange, page, cartCount = 0, onCartClick, onNavigate }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLanding = !page || page === "landing";
  const isProducts = page === "products";
  const activeId = isProducts ? "products" : (activeTab || "marketing");

  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false });
  const cartIconRef = useRef(null);

  const [user, setUser] = useState(() => getUser());
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("signin");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    me().then((data) => setUser(data.user)).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => { setUser(e.detail?.user ?? null); };
    window.addEventListener("btl-auth-change", handler);
    return () => window.removeEventListener("btl-auth-change", handler);
  }, []);

  useEffect(() => {
    const handler = () => { setAuthTab("signin"); setAuthError(""); setAuthOpen(true); };
    window.addEventListener("btl-request-auth", handler);
    return () => window.removeEventListener("btl-request-auth", handler);
  }, []);

  useEffect(() => {
    const close = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const measurePill = () => {
    const container = tabsRef.current;
    if (!container) return;
    const active = container.querySelector(".navbar-tab-active");
    if (!active) { setPill((p) => ({ ...p, width: 0 })); return; }
    setPill({ left: active.offsetLeft, width: active.offsetWidth, ready: true });
  };

  useLayoutEffect(() => { measurePill(); }, [activeId, mobileOpen]);
  useEffect(() => {
    window.addEventListener("resize", measurePill);
    if (document.fonts?.ready) document.fonts.ready.then(measurePill);
    const t = setTimeout(measurePill, 300);
    return () => { window.removeEventListener("resize", measurePill); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (cartIconRef.current) window.__btlNavbarCartRef = cartIconRef.current;
    return () => { window.__btlNavbarCartRef = null; };
  });

  const handleTabClick = (t) => {
    if (t.id === "products") {
      onNavigate?.("/products");
    } else if (isLanding) {
      onTabChange?.(t.id);
    } else {
      onNavigate?.("/?tab=" + t.id);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      if (authTab === "register" && authForm.password !== authForm.confirmPassword) {
        setAuthError("Passwords don't match");
        setAuthLoading(false);
        return;
      }
      let result;
      if (authTab === "signin") {
        result = await apiLogin(authForm.email, authForm.password);
      } else {
        result = await apiRegister(authForm.name, authForm.email, authForm.password);
        setSession(result.user, result.token);
      }
      setUser(result.user);
      setAuthOpen(false);
      setAuthForm({ name: "", email: "", password: "", confirmPassword: "" });
      setShowPass(false);
      setShowConfirm(false);
      window.dispatchEvent(new CustomEvent("btl-auth-change", { detail: { user: result.user } }));
      // Team members land in their own dashboard based on role (no separate /admin
      if (result.user?.is_team && authTab === "signin") {
        onNavigate?.(result.user.role === "recee" ? "/recee" : "/dashboard");
      }
    } catch (err) {
      setAuthError(err.message || "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    setDropdownOpen(false);
    window.dispatchEvent(new CustomEvent("btl-auth-change", { detail: { user: null } }));
  };

  const initials = user?.name ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) : "";

  return (
    <>
      <style>{CSS}</style>
      <header className="navbar" id="btl-navbar">
        <div className="navbar-inner">
          <a href="/" className="logo">
            <span className="logo-text">
              <span className="logo-word">BTL<span className="logo-orange">bro</span></span>
              <span className="logo-tag">Hyperlocal marketing, simplified.</span>
            </span>
          </a>

          <div className="navbar-tabs" ref={tabsRef}>
            <span
              className="navbar-pill"
              style={{
                transform: `translateX(${pill.left}px)`,
                width: pill.width,
                opacity: pill.ready && pill.width > 0 ? 1 : 0,
              }}
              aria-hidden="true"
            />
            {TABS.map((t) => {
              const isActive = activeId === t.id;
              return (
                <button
                  key={t.id}
                  className={`navbar-tab ${isActive ? "navbar-tab-active" : ""}`}
                  onClick={() => handleTabClick(t)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="navbar-right">
            <button className="navbar-cart-btn" ref={cartIconRef}
              onClick={() => { setMobileOpen(false); onCartClick?.(); }} aria-label="Open cart">
              <ShoppingCart size={20} />
              {cartCount > 0 && <span className="navbar-cart-badge">{cartCount}</span>}
            </button>

            {user ? (
              <div className="navbar-user-wrap" ref={dropdownRef}>
                <button className="navbar-user-btn" onClick={() => setDropdownOpen((v) => !v)}>
                  <span className="navbar-avatar">{initials}</span>
                  <span className="navbar-user-name">{user.name?.split(" ")[0]}</span>
                  <ChevronDown size={14} />
                </button>
                {dropdownOpen && (
                  <div className="navbar-dropdown">
                    <div className="navbar-dropdown-header">
                      <span className="navbar-avatar navbar-avatar-lg">{initials}</span>
                      <div>
                        <div className="navbar-dd-name">{user.name}</div>
                        <div className="navbar-dd-email">{user.email}</div>
                      </div>
                    </div>
                    <div className="navbar-dropdown-divider" />
                    <button className="navbar-dropdown-item" onClick={() => { setDropdownOpen(false); onNavigate?.("/dashboard"); }}>
                      <Package size={16} /> My Orders
                    </button>
                    <button className="navbar-dropdown-item" onClick={handleLogout}>
                      <LogOut size={16} /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="navbar-login-btn" onClick={() => setAuthOpen(true)} aria-label="Sign in">
                <User size={16} /> <span className="navbar-login-label">Sign In</span>
              </button>
            )}

            {/* Inside .navbar-right on purpose: as a sibling it inherited
                .navbar-inner's 20px gap, so the burger sat 24px from the sign-in
                button while the cart sat 6px from it. Here all three share one gap. */}
            <button className="navbar-burger" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="navbar-mobile">
            {TABS.map((t) => {
              const isActive = activeId === t.id;
              return (
                <button
                  key={t.id}
                  className={`navbar-tab ${isActive ? "navbar-tab-active" : ""}`}
                  onClick={() => { setMobileOpen(false); handleTabClick(t); }}
                >
                  {t.label}
                </button>
              );
            })}
            <div className="navbar-mobile-divider" />
            {user ? (
              <>
                <button className="navbar-tab" onClick={() => { setMobileOpen(false); onNavigate?.("/dashboard"); }}>
                  My Orders
                </button>
                <button className="navbar-tab" onClick={() => { handleLogout(); setMobileOpen(false); }}>
                  Sign Out
                </button>
              </>
            ) : (
              <button className="navbar-tab" onClick={() => { setMobileOpen(false); setAuthOpen(true); }}>
                Sign In / Register
              </button>
            )}
          </div>
        )}
      </header>

      {authOpen && (
        <div className="auth-overlay" onClick={() => setAuthOpen(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <button className="auth-close" onClick={() => setAuthOpen(false)}><X size={18} /></button>

            <div className="auth-brand">
              <div className="auth-brand-text">
                <span className="auth-brand-name">BTL<span style={{ color: "#F2701D" }}>bro</span></span>
              </div>
            </div>

            <h2 className="auth-title">{authTab === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="auth-subtitle">{authTab === "signin" ? "Sign in to track orders and manage your bookings." : "Join BTLbro to start your marketing journey."}</p>

            <div className="auth-tabs">
              <button className={`auth-tab ${authTab === "signin" ? "auth-tab-active" : ""}`} onClick={() => { setAuthTab("signin"); setAuthError(""); }}>Sign In</button>
              <button className={`auth-tab ${authTab === "register" ? "auth-tab-active" : ""}`} onClick={() => { setAuthTab("register"); setAuthError(""); }}>Register</button>
            </div>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              <div className={`auth-field-group ${authTab === "register" ? "auth-field-group-open" : ""}`}>
                <div className="auth-field">
                  <label className="auth-label">Full Name</label>
                  <input className="auth-input" type="text" placeholder="Priya Sharma" value={authForm.name} onChange={(e) => setAuthForm((f) => ({ ...f, name: e.target.value }))} required={authTab === "register"} />
                </div>
              </div>
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input className="auth-input" type="email" placeholder="you@example.com" value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
              <div className="auth-field">
                <label className="auth-label">Password</label>
                <div className="auth-input-wrap">
                  <input className="auth-input auth-input-pass" type={showPass ? "text" : "password"} placeholder="Min 6 characters" value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))} required minLength={6} />
                  <button type="button" className="auth-eye" onClick={() => setShowPass((v) => !v)} tabIndex={-1}>
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className={`auth-field-group ${authTab === "register" ? "auth-field-group-open" : ""}`}>
                <div className="auth-field">
                  <label className="auth-label">Confirm Password</label>
                  <div className="auth-input-wrap">
                    <input className="auth-input auth-input-pass" type={showConfirm ? "text" : "password"} placeholder="Re-enter password" value={authForm.confirmPassword} onChange={(e) => setAuthForm((f) => ({ ...f, confirmPassword: e.target.value }))} required={authTab === "register"} minLength={6} />
                    <button type="button" className="auth-eye" onClick={() => setShowConfirm((v) => !v)} tabIndex={-1}>
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>
              {authError && <div className="auth-error">{authError}</div>}
              <button className="auth-submit" type="submit" disabled={authLoading}>
                {authLoading ? "Please wait..." : authTab === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>

            <p className="auth-footer">
              {authTab === "signin" ? (
                <>Don't have an account? <button className="auth-link" onClick={() => { setAuthTab("register"); setAuthError(""); }}>Create one</button></>
              ) : (
                <>Already have an account? <button className="auth-link" onClick={() => { setAuthTab("signin"); setAuthError(""); }}>Sign in</button></>
              )}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

.navbar {
  --torange: #F2701D;
  --tink: #1A1A1A;
  --tborder: #E7E2D8;
  --tbg: #FFFFFF;
  --tmax-w: 1400px;
  font-family: 'Inter', sans-serif;
  color: var(--tink);
  background: var(--tbg);
  position: sticky;
  top: 0;
  z-index: 900;
  box-shadow: 0 1px 0 var(--tborder);
}
.navbar a { color: inherit; text-decoration: none; }
/* :where() contributes 0 specificity, so this reset only has to beat the browser's
   default button styling. Written as ".navbar .navbar-cart-btn" it scored 0,2,0 and
   silently beat the 0,1,0 component rules below it, so their background fills never
   rendered and the cart/user buttons came out transparent. Keep the parts inside
   :where() so the rules below win on source order alone. */
.navbar :where(.navbar-tab, .navbar-burger, .navbar-cart-btn, .navbar-user-btn, .navbar-dropdown-item, .navbar-login-btn) { font-family: inherit; cursor: pointer; background: none; border: none; }

.navbar-inner { max-width: var(--tmax-w); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 16px 32px 14px; gap: 20px; }
@media (max-width: 640px) { .navbar-inner { padding: 14px 18px; } }

.logo { display: flex; align-items: center; gap: 6px; }
.logo-text { display: flex; flex-direction: column; line-height: 1.15; }
.logo-word { font-family: 'Zilla Slab', serif; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; color: var(--tink); }
.logo-orange { color: var(--torange); }
.logo-tag { font-size: 11px; color: #A3A3A3; margin-top: -1px; }

.navbar-tabs { display: flex; align-items: center; background: #F0F0F0; border-radius: 999px; padding: 4px; position: relative; flex-shrink: 0; }
.navbar-pill {
  position: absolute;
  top: 4px; bottom: 4px; left: 0;
  border-radius: 999px;
  background: var(--torange);
  box-shadow: 0 2px 8px rgba(242,112,29,0.25);
  transition: transform 0.35s cubic-bezier(0.45, 0, 0.15, 1), width 0.35s cubic-bezier(0.45, 0, 0.15, 1), opacity 0.2s ease;
  pointer-events: none;
  will-change: transform, width;
}
.navbar-tab { position: relative; z-index: 1; padding: 8px 20px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--tsec, #6B6B6B); background: none; transition: color .25s ease; white-space: nowrap; }
.navbar-tab:hover { color: var(--tink); }
.navbar .navbar-tab-active { color: #fff !important; }
.navbar .navbar-tab-active:hover { color: #fff !important; }

.navbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
/* 44px keeps the burger on the recommended minimum tap target. */
.navbar-burger {
  display: none;
  width: 44px; height: 44px; flex-shrink: 0;
  align-items: center; justify-content: center;
  border-radius: 999px;
  background: #F0F0F0; color: var(--tink);
  transition: background 0.15s ease, transform 0.15s ease;
}
.navbar-burger:hover { background: #E4E0DA; }
/* Mobile: the tab pill collapses into the burger, and the cart stays visible
   as a standalone button immediately before it. Sign-in stays in the header too,
   but shrinks to a bare icon so the row does not crowd. */
@media (max-width: 980px) {
  .navbar-tabs { display: none; }
  .navbar-right { display: flex; margin-left: auto; gap: 6px; }
  .navbar-user-wrap { display: none; }
  /* Bare icons on mobile — no filled circle behind them. Prefixed with .navbar
     because the cart/burger base rules score (0,1,0) and the cart one is
     declared AFTER this media query, so an unprefixed override would lose on
     source order. Desktop keeps the cart's circle. */
  .navbar .navbar-cart-btn,
  .navbar .navbar-burger { background: none; }
  /* Keep a light tint on hover/press so a tap still gives feedback now that
     there is no resting fill. */
  .navbar .navbar-cart-btn:hover,
  .navbar .navbar-burger:hover { background: #F4F1EC; }
  .navbar .navbar-login-btn {
    display: flex;
    width: 44px;
    height: 44px;
    padding: 0;
    gap: 0;
    justify-content: center;
    border: none;
    border-radius: 999px;
    background: none !important;
    color: var(--tink);
  }
  .navbar .navbar-login-btn:hover { background: #F4F1EC !important; }
  /* Icon-only on mobile: the text label is dropped, not the button. */
  .navbar-login-label { display: none; }
  /* No extra margin: the burger now lives inside .navbar-right, so the row's
     single gap spaces it evenly from the cart and the sign-in icon. */
  .navbar-burger { display: flex; }
}
.navbar-mobile { display: flex; flex-direction: column; gap: 14px; padding: 0 20px 22px; }
.navbar-mobile .navbar-tab-active { background: var(--torange); color: #fff; }
.navbar-mobile-divider { border-top: 1px solid var(--tborder); margin: 4px 0; }

.navbar-cart-btn {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; flex-shrink: 0; border-radius: 999px;
  background: #F0F0F0; color: var(--tink);
  transition: background 0.15s ease, transform 0.15s ease;
}
.navbar-cart-btn:hover { background: #E4E0DA; transform: scale(1.05); }
.navbar-cart-badge {
  position: absolute; top: -2px; right: -2px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 999px; background: var(--torange); color: #fff;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; line-height: 1;
  animation: badgePop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes badgePop { 0% { transform: scale(0); } 60% { transform: scale(1.3); } 100% { transform: scale(1); } }

.navbar-login-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 20px; min-height: 44px; border-radius: 999px;
  background: var(--tink) !important; color: #fff;
  font-size: 13.5px; font-weight: 600;
  transition: background 0.15s ease, transform 0.15s ease;
}
.navbar-login-btn:hover { background: #333 !important; transform: scale(1.03); }

.navbar-user-wrap { position: relative; }
.navbar-user-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px; border-radius: 999px;
  background: #F0F0F0; transition: background 0.15s ease;
}
.navbar-user-btn:hover { background: #E4E0DA; }
.navbar-avatar {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 999px;
  background: var(--torange); color: #fff;
  font-size: 12px; font-weight: 700; flex-shrink: 0;
}
.navbar-avatar-lg { width: 40px; height: 40px; font-size: 14px; }
.navbar-user-name { font-size: 13.5px; font-weight: 600; color: var(--tink); }

.navbar-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 240px; background: #fff; border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
  padding: 8px; z-index: 999;
  animation: ddFadeIn 0.15s ease;
}
@keyframes ddFadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.navbar-dropdown-header { display: flex; align-items: center; gap: 10px; padding: 10px 8px; }
.navbar-dd-name { font-size: 14px; font-weight: 600; }
.navbar-dd-email { font-size: 12px; color: #999; }
.navbar-dropdown-divider { border-top: 1px solid #F0F0F0; margin: 4px 0; }
.navbar-dropdown-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 10px 12px; border-radius: 8px;
  font-size: 13.5px; font-weight: 500; color: var(--tink);
  transition: background 0.12s ease;
}
.navbar-dropdown-item:hover { background: #F5F5F5; }

.btl-fly-ghost {
  position: fixed; z-index: 9999; pointer-events: none;
  font-size: 32px; line-height: 1;
  transition: all 0.55s cubic-bezier(0.34, 1.2, 0.64, 1);
  will-change: transform, opacity;
}
.btl-fly-ghost.btl-fly-end { transform: scale(0.3) !important; opacity: 0 !important; }

.auth-overlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  /* The overlay itself scrolls. Without this a tall modal (the register tab on
     a short phone) is clipped at both ends and the top of the form — including
     the only close control — is unreachable. */
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 24px 16px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.auth-modal {
  background: #fff; border-radius: 20px; padding: 0;
  width: 420px; max-width: 92vw; position: relative;
  box-shadow: 0 25px 80px rgba(0,0,0,0.2), 0 4px 20px rgba(0,0,0,0.08);
  animation: modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  /* margin:auto keeps a modal taller than the viewport genuinely scrollable
     inside a centred flexbox (a plain centred child gets its top cut off). */
  margin: auto;
}
@keyframes modalSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.auth-close {
  position: absolute; top: 16px; right: 16px;
  width: 44px; height: 44px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  color: #F2701D; border: 1.5px solid #F2701D; background: #fff;
  transition: all 0.15s ease; z-index: 2; cursor: pointer;
}
.auth-close:hover { background: rgba(242,112,29,0.1); color: #d8620f; border-color: #d8620f; }
@media (max-width: 480px) {
  .auth-overlay { padding: 16px 12px; }
  .auth-brand { padding: 24px 20px 0; }
  .auth-title, .auth-subtitle { padding-left: 20px; padding-right: 20px; }
  .auth-tabs { margin-left: 20px; margin-right: 20px; }
  .auth-form { padding: 0 20px; }
  .auth-footer { padding: 18px 20px 24px; }
}
.auth-brand {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 28px 32px 0;
}
.auth-brand-text { display: flex; flex-direction: column; }
.auth-brand-name { font-family: 'Zilla Slab', serif; font-size: 22px; font-weight: 700; color: #1A1A1A; }
.auth-title {
  text-align: center; font-size: 20px; font-weight: 700; color: #1A1A1A;
  margin: 14px 0 4px; padding: 0 32px;
}
.auth-subtitle {
  text-align: center; font-size: 13.5px; color: #888;
  margin: 0 0 24px; padding: 0 32px; line-height: 1.5;
}
.auth-tabs {
  display: flex; gap: 4px; background: #F3F3F3; border-radius: 12px;
  padding: 4px; margin: 0 32px 24px;
}
.auth-tab {
  flex: 1; padding: 10px 0; border-radius: 8px;
  font-size: 13.5px; font-weight: 600; color: #888;
  transition: all 0.2s ease; border: none; cursor: pointer; background: none; font-family: inherit;
}
.auth-tab:hover { color: #555; }
.auth-tab-active { background: #fff; color: #1A1A1A; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.auth-form { display: flex; flex-direction: column; gap: 16px; padding: 0 32px; }
.auth-field-group {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin 0.3s ease;
  opacity: 0;
  margin-top: 0;
}
.auth-field-group > * { overflow: hidden; }
.auth-field-group-open {
  grid-template-rows: 1fr;
  opacity: 1;
  margin-top: 0;
}
.auth-field { display: flex; flex-direction: column; gap: 6px; }
.auth-label { font-size: 13px; font-weight: 600; color: #444; }
.auth-input {
  width: 100%; padding: 12px 14px; border: 1.5px solid #E0E0E0; border-radius: 10px;
  font-size: 14px; font-family: inherit; outline: none; color: #1A1A1A;
  background: #FAFAFA; transition: all 0.2s ease; box-sizing: border-box;
}
.auth-input::placeholder { color: #BBB; }
.auth-input:focus { border-color: #F2701D; background: #fff; box-shadow: 0 0 0 3px rgba(242,112,29,0.1); }
.auth-input-wrap { position: relative; }
.auth-input-pass { padding-right: 44px; }
.auth-eye {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  color: #AAA; background: none; border: none; cursor: pointer; padding: 0;
  transition: color 0.15s ease;
}
.auth-eye:hover { color: #666; }
.auth-error {
  font-size: 13px; color: #D32F2F; padding: 10px 14px;
  background: #FFF5F5; border-radius: 8px; border: 1px solid #FFCDD2;
}
.auth-submit {
  width: 100%; padding: 13px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #F2701D, #E8600A); color: #fff;
  font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: all 0.2s ease; margin-top: 4px;
}
.auth-submit:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(242,112,29,0.35); }
.auth-submit:active { transform: translateY(0); }
.auth-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.auth-footer {
  text-align: center; font-size: 13px; color: #888;
  padding: 20px 32px 28px; margin: 0; border-top: 1px solid #F0F0F0;
  margin-top: 20px;
}
.auth-link {
  color: #F2701D; font-weight: 600; cursor: pointer;
  background: none; border: none; font-family: inherit; font-size: inherit;
  padding: 0; transition: color 0.15s ease;
}
.auth-link:hover { color: #d8620f; text-decoration: underline; }
`;
