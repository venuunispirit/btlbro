import React, { useState } from 'react';
import { login as apiLogin, register as apiRegister, getUser, clearSession } from '../services/shopClient.js';

// Unified sign-in: the SAME email/password works for customers and the internal
// team. After login, the user is routed based on their account:
//   - recee team   → /recee  (site-capture screen)
//   - other staff  → /dashboard (role-based panel)
//   - customers    → /dashboard (account dashboard)
// There is no separate /admin URL anymore.

function homeFor(user) {
  if (!user) return '/login';
  if (user.is_team) return user.role === 'recee' ? '/recee' : '/dashboard';
  return '/dashboard';
}

export default function LoginPage({ onNavigate }) {
  const [tab, setTab] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState('');

  // Already signed in? Go straight to the right dashboard.
  const existing = getUser();
  if (existing) {
    const dest = homeFor(existing);
    if (dest !== '/login') {
      onNavigate?.(dest);
      return null;
    }
  }

  function go(where) {
    clearSession();
    onNavigate?.(where);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const data = tab === 'signin'
        ? await apiLogin(form.email, form.password)
        : await apiRegister(form.name, form.email, form.password);
      const dest = homeFor(data.user);
      if (tab === 'signin' && data.user.is_team) {
        // Internal team member — routed by role below.
      }
      window.dispatchEvent(new CustomEvent('btl-auth-change', { detail: { user: data.user } }));
      onNavigate?.(dest);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.logoMark}>B</span>
          <div>
            <div style={styles.brand}>BTL<span style={{ color: '#F2701D' }}>bro</span></div>
            <div style={styles.sub}>One account for customers & team</div>
          </div>
        </div>

        <h2 style={styles.title}>{tab === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
        <p style={styles.hint}>
          {tab === 'signin'
            ? 'Sign in with your email — you will go straight to your dashboard.'
            : 'New customer? Register in seconds.'}
        </p>

        <div style={styles.tabs}>
          <button style={{ ...styles.tabBtn, ...(tab === 'signin' ? styles.tabActive : {}) }} onClick={() => { setTab('signin'); setError(''); }}>
            Sign in
          </button>
          <button style={{ ...styles.tabBtn, ...(tab === 'register' ? styles.tabActive : {}) }} onClick={() => { setTab('register'); setError(''); }}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {tab === 'register' && (
            <>
              <label style={styles.fieldLabel}>Full name</label>
              <input style={styles.input} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your name" required />
            </>
          )}
          <label style={styles.fieldLabel}>Email</label>
          <input style={styles.input} type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com" required />
          <label style={styles.fieldLabel}>Password</label>
          <input style={styles.input} type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••" required minLength={6} />

          {error && <div style={styles.error}>{error}</div>}
          {info && <div style={styles.info}>{info}</div>}

          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : tab === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={styles.foot}>
          <button style={styles.ghost} onClick={() => go('/')}>← Back to website</button>
          <span style={styles.footHint}>Internal team? Your role decides your dashboard.</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(180deg, #FAF9F7 0%, #F3EFE7 100%)',
    padding: 24, fontFamily: "'Inter', sans-serif",
  },
  card: {
    width: 400, maxWidth: '100%', background: '#fff', borderRadius: 18,
    padding: '34px 34px 26px', boxShadow: '0 24px 70px rgba(22,22,22,0.12)',
    border: '1px solid #E7E2D8',
  },
  logoRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 },
  logoMark: {
    width: 40, height: 40, borderRadius: 12, background: '#161616', color: '#fff',
    fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brand: { fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px' },
  sub: { fontSize: 11, color: '#949494', marginTop: 1 },
  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#161616' },
  hint: { margin: '6px 0 18px', fontSize: 13, color: '#656565', lineHeight: 1.5 },
  tabs: {
    display: 'flex', background: '#FAF9F7', border: '1px solid #E7E2D8',
    borderRadius: 10, padding: 4, marginBottom: 18,
  },
  tabBtn: {
    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'transparent',
    fontSize: 13, fontWeight: 600, color: '#949494', cursor: 'pointer',
  },
  tabActive: { background: '#F2701D', color: '#fff' },
  form: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: '#4A4A4A', marginTop: 8 },
  input: {
    padding: '11px 13px', borderRadius: 10, border: '1.5px solid #E7E2D8',
    fontSize: 14, color: '#161616', outline: 'none', background: '#fff',
  },
  error: {
    marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#FEE2E2',
    color: '#B91C1C', fontSize: 12.5, border: '1px solid #FECACA',
  },
  info: {
    marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#ECFDF5',
    color: '#047857', fontSize: 12.5, border: '1px solid #A7F3D0',
  },
  btn: {
    marginTop: 18, padding: '12px', borderRadius: 10, border: 'none',
    background: '#F2701D', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  foot: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' },
  ghost: { background: 'none', border: 'none', color: '#656565', fontSize: 12.5, cursor: 'pointer' },
  footHint: { fontSize: 11, color: '#949494' },
};