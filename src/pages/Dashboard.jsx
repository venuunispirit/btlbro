import React, { useState, useEffect, useCallback } from "react";
import { Package, Clock, CheckCircle, AlertCircle, User, Mail, Calendar, ArrowLeft, X, Eye, EyeOff } from "lucide-react";
import { getUser, setSession, login as apiLogin, register as apiRegister, logout as apiLogout, me, getOrders } from "../services/shopClient.js";

const STATUS_STYLES = {
  placed: { bg: "#FFF8E6", color: "#8A6D1A", icon: Clock, label: "Placed" },
  paid: { bg: "#E8F5E9", color: "#2E7D32", icon: CheckCircle, label: "Paid" },
  pending: { bg: "#FFF8E6", color: "#8A6D1A", icon: Clock, label: "Pending" },
  on_confirmation: { bg: "#FFF3E0", color: "#E65100", icon: AlertCircle, label: "Awaiting Confirmation" },
  confirmed: { bg: "#E8F5E9", color: "#2E7D32", icon: CheckCircle, label: "Confirmed" },
  delivered: { bg: "#E8F5E9", color: "#2E7D32", icon: CheckCircle, label: "Delivered" },
  cancelled: { bg: "#FFEBEE", color: "#C62828", icon: AlertCircle, label: "Cancelled" },
};

export default function Dashboard({ onNavigate }) {
  const [user, setUser] = useState(() => getUser());
  const [orders, setOrders] = useState([]);
  const [legacyOrders, setLegacyOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState("signin");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    me().then((data) => setUser(data.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const handler = (e) => { setUser(e.detail?.user ?? null); };
    window.addEventListener("btl-auth-change", handler);
    return () => window.removeEventListener("btl-auth-change", handler);
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      getOrders().then((d) => setOrders(d.orders || [])).catch(() => setOrders([])),
      fetch("/api/orders").then((r) => r.json()).then((d) => {
        const all = d.orders || [];
        setLegacyOrders(all.filter((o) => o.email === user.email || o.contactEmail === user.email));
      }).catch(() => setLegacyOrders([])),
    ]).finally(() => setLoading(false));
  }, [user]);

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
      if (authTab === "signin") {
        const data = await apiLogin(authForm.email, authForm.password);
        setUser(data.user);
        window.dispatchEvent(new CustomEvent("btl-auth-change", { detail: { user: data.user } }));
        if (data.user?.is_team) { onNavigate?.(data.user.role === "recee" ? "/recee" : "/dashboard"); return; }
      } else {
        const data = await apiRegister(authForm.name, authForm.email, authForm.password);
        setSession(data.user, data.token);
        setUser(data.user);
        window.dispatchEvent(new CustomEvent("btl-auth-change", { detail: { user: data.user } }));
      }
      setAuthOpen(false);
      setAuthForm({ name: "", email: "", password: "", confirmPassword: "" });
      setShowPass(false);
      setShowConfirm(false);
    } catch (err) {
      setAuthError(err.message || "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    window.dispatchEvent(new CustomEvent("btl-auth-change", { detail: { user: null } }));
  };

  if (!user) {
    return (
      <>
        <style>{CSS}</style>
        <div className="dash-root">
          <div className="dash-auth-required">
            <div className="dash-auth-icon"><User size={48} /></div>
            <h2>Sign in to view your orders</h2>
            <p>You need an account to track your bookings and order history.</p>
            <button className="dash-auth-btn" onClick={() => setAuthOpen(true)}>Sign In / Register</button>
          </div>
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
                      <input className="auth-input" type="text" placeholder="Priya Sharma" value={authForm.name} onChange={(e) => setAuthForm((f) => ({ ...f, name: e.target.value }))} required />
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
                        <input className="auth-input auth-input-pass" type={showConfirm ? "text" : "password"} placeholder="Re-enter password" value={authForm.confirmPassword} onChange={(e) => setAuthForm((f) => ({ ...f, confirmPassword: e.target.value }))} required minLength={6} />
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
        </div>
      </>
    );
  }

  const allOrders = [
    ...orders.map((o) => ({ ...o, _type: "shop" })),
    ...legacyOrders.map((o) => ({ ...o, _type: "campaign" })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <>
      <style>{CSS}</style>
      <div className="dash-root">
        <div className="dash-container">
          <div className="dash-header">
            <button className="dash-back" onClick={() => onNavigate?.("/")}>
              <ArrowLeft size={18} /> Back
            </button>
            <h1>My Account</h1>
          </div>

          <div className="dash-grid">
            <div className="dash-sidebar">
              <div className="dash-profile">
                <div className="dash-avatar">{user.name?.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</div>
                <div className="dash-name">{user.name}</div>
                <div className="dash-email"><Mail size={14} /> {user.email}</div>
                <div className="dash-since"><Calendar size={14} /> Member since {new Date(user.created_at || Date.now()).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</div>
              </div>
              <button className="dash-logout-btn" onClick={handleLogout}>Sign Out</button>
            </div>

            <div className="dash-main">
              <h2><Package size={20} /> Order History</h2>
              {loading ? (
                <div className="dash-empty">Loading orders...</div>
              ) : allOrders.length === 0 ? (
                <div className="dash-empty">
                  <Package size={40} />
                  <p>No orders yet</p>
                  <button className="dash-shop-btn" onClick={() => onNavigate?.("/products")}>Browse Products</button>
                </div>
              ) : (
                <div className="dash-orders">
                  {allOrders.map((order, i) => {
                    const status = STATUS_STYLES[order.status || order.payment_status] || STATUS_STYLES.placed;
                    const StatusIcon = status.icon;
                    const total = order.total || order.totalAmount || 0;
                    const items = order.items || order.selectedLocations || [];
                    return (
                      <div key={order.id || i} className="dash-order-card">
                        <div className="dash-order-top">
                          <div>
                            <span className="dash-order-id">#{order._type === "shop" ? "SH-" : "CM-"}{order.id}</span>
                            <span className="dash-order-type">{order._type === "shop" ? "Product Order" : "Campaign Order"}</span>
                          </div>
                          <span className="dash-order-status" style={{ background: status.bg, color: status.color }}>
                            <StatusIcon size={14} /> {status.label}
                          </span>
                        </div>
                        <div className="dash-order-items">
                          {items.slice(0, 3).map((item, j) => (
                            <span key={j} className="dash-order-item">
                              {item.name || item.product_id || item.fullName || "Item"}
                              {item.qty > 1 ? ` ×${item.qty}` : ""}
                            </span>
                          ))}
                          {items.length > 3 && <span className="dash-order-item">+{items.length - 3} more</span>}
                        </div>
                        <div className="dash-order-bottom">
                          <span className="dash-order-date">
                            {new Date(order.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          {total > 0 && <span className="dash-order-total">₹{total.toLocaleString("en-IN")}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.dash-root {
  --orange: #F2701D;
  --ink: #161616;
  --sec: #656565;
  --muted: #949494;
  --border: #E7E2D8;
  font-family: 'Inter', sans-serif;
  color: var(--ink);
  background: #FAF9F7;
  min-height: calc(100vh - 73px);
  padding: 32px 24px;
}
.dash-root * { box-sizing: border-box; }
.dash-root button { font-family: inherit; cursor: pointer; background: none; border: none; }

.dash-container { max-width: 1000px; margin: 0 auto; }

.dash-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.dash-header h1 { font-size: 24px; font-weight: 700; }
.dash-back {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 999px;
  background: #fff; border: 1.5px solid var(--border);
  font-size: 13px; font-weight: 600; color: var(--sec);
  transition: all 0.15s ease;
}
.dash-back:hover { border-color: var(--ink); color: var(--ink); }

.dash-grid { display: grid; grid-template-columns: 260px 1fr; gap: 24px; }
@media (max-width: 768px) { .dash-grid { grid-template-columns: 1fr; } }

.dash-sidebar { display: flex; flex-direction: column; gap: 16px; }
.dash-profile {
  background: #fff; border-radius: 16px; padding: 28px;
  text-align: center; border: 1px solid var(--border);
}
.dash-avatar {
  width: 64px; height: 64px; border-radius: 999px;
  background: var(--orange); color: #fff;
  font-size: 22px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 12px;
}
.dash-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.dash-email, .dash-since {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 13px; color: var(--muted); margin-top: 4px;
}
.dash-logout-btn {
  width: 100%; padding: 12px; border-radius: 10px;
  background: #fff; border: 1.5px solid var(--border);
  font-size: 14px; font-weight: 600; color: var(--sec);
  transition: all 0.15s ease;
}
.dash-logout-btn:hover { border-color: #E53E3E; color: #E53E3E; }

.dash-main h2 {
  display: flex; align-items: center; gap: 8px;
  font-size: 18px; font-weight: 700; margin-bottom: 16px;
}
.dash-empty {
  background: #fff; border-radius: 16px; padding: 48px 24px;
  text-align: center; color: var(--muted);
  border: 1px solid var(--border);
}
.dash-empty p { margin: 12px 0 20px; font-size: 15px; }
.dash-shop-btn {
  padding: 10px 24px; border-radius: 999px;
  background: var(--orange); color: #fff;
  font-size: 14px; font-weight: 600;
  transition: background 0.15s ease;
}
.dash-shop-btn:hover { background: #d8620f; }

.dash-orders { display: flex; flex-direction: column; gap: 12px; }
.dash-order-card {
  background: #fff; border-radius: 14px; padding: 18px 20px;
  border: 1px solid var(--border);
  transition: box-shadow 0.15s ease;
}
.dash-order-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
.dash-order-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.dash-order-id { font-weight: 700; font-size: 14px; margin-right: 8px; }
.dash-order-type { font-size: 12px; color: var(--muted); }
.dash-order-status {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.dash-order-items { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dash-order-item {
  padding: 4px 10px; border-radius: 6px;
  background: #F5F5F5; font-size: 12.5px; color: var(--sec);
}
.dash-order-bottom { display: flex; justify-content: space-between; align-items: center; }
.dash-order-date { font-size: 12.5px; color: var(--muted); }
.dash-order-total { font-size: 15px; font-weight: 700; color: var(--ink); }

.auth-overlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  /* The overlay scrolls so a tall modal (register tab on a short phone) is
     never clipped with its close button out of reach. */
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
  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
  opacity: 0;
}
.auth-field-group > * { overflow: hidden; }
.auth-field-group-open {
  grid-template-rows: 1fr;
  opacity: 1;
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
.dash-auth-required {
  max-width: 400px; margin: 80px auto; text-align: center;
  background: #fff; border-radius: 18px; padding: 40px 32px;
  border: 1px solid var(--border);
}
.dash-auth-icon { color: var(--muted); margin-bottom: 16px; }
.dash-auth-required h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.dash-auth-required p { font-size: 14px; color: var(--sec); margin-bottom: 24px; }
.dash-auth-btn {
  padding: 12px 28px; border-radius: 999px;
  background: var(--orange); color: #fff;
  font-size: 15px; font-weight: 600;
  transition: background 0.15s ease;
  /* 12px padding + 15px line-height lands at 43px, a hair under the 44px
     touch-target floor. min-height decouples the tap area from the type. */
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dash-auth-btn:hover { background: #d8620f; }
.dash-auth-btn:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
`;
