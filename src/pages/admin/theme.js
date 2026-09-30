// Admin design tokens — the single source of truth for the panel's look.
//
// The palette is "warm neutrals", not the cold generic grays you get from a
// default UI kit. Paper, not concrete: a cream page with a soft orange accent,
// so long admin sessions read as warm rather than clinical. Every tab should
// take its colours from here rather than hard-coding hex values — the whole
// point is that the panel can never drift into a second palette again.
//
// If you are adding a tab, import from this file. Do not add a new grey.

import React from 'react';

/** Colour tokens. Named by role, never by hue, so themes can change safely. */
export const c = {
  // Surfaces, lightest to darkest. `page` is the app background.
  page: '#FAF9F7',
  card: '#FFFFFF',
  sunken: '#F4F1EA',   // wells, table headers, inset areas
  overlay: '#FCFBF9',  // an expanded row sitting inside a striped row

  // Lines.
  border: '#E7E2D8',   // the default border. Use this.
  divider: '#F1EDE4',  // hairline between rows
  faint: '#C9C2B4',    // dashed borders, disabled strokes

  // Text. Four steps is enough; more than that and hierarchy stops being legible.
  text: '#161616',
  body: '#4A4A4A',
  muted: '#949494',
  disabled: '#B8AFA6',

  // Accent — actions, focus, brand.
  accent: '#F2701D',
  accentSoft: '#FFF4EC',
  accentDeep: '#C2410C',
  accentBorder: '#F2C9A8',

  // Status. Each pairs a tinted background with text that passes 4.5:1 on it.
  okBg: '#ECFDF5', okFg: '#047857', okBorder: '#A7F3D0',
  warnBg: '#FEF3C7', warnFg: '#B45309', warnBorder: '#FDE68A',
  infoBg: '#E0F2FE', infoFg: '#0369A1', infoBorder: '#B9DFFB',
  dangerBg: '#FEF2F2', dangerFg: '#B91C1C', dangerBorder: '#FECACA',
  purpleBg: '#F1E9FD', purpleFg: '#6D28D9', purpleBorder: '#DDD0F8',
};

/** Consistent status palettes, so a pill never invents its own colours. */
export const TONES = {
  ok:     { bg: c.okBg,     fg: c.okFg,     border: c.okBorder },
  warn:   { bg: c.warnBg,   fg: c.warnFg,   border: c.warnBorder },
  info:   { bg: c.infoBg,   fg: c.infoFg,   border: c.infoBorder },
  danger: { bg: c.dangerBg, fg: c.dangerFg, border: c.dangerBorder },
  accent: { bg: c.accentSoft, fg: c.accentDeep, border: c.accentBorder },
  purple: { bg: c.purpleBg, fg: c.purpleFg, border: c.purpleBorder },
  muted:  { bg: c.sunken,   fg: c.muted,    border: c.border },
};

export const radius = { sm: 8, md: 10, lg: 12, xl: 14 };
export const font = { sans: 'Inter, system-ui, sans-serif', mono: 'ui-monospace, SFMono-Regular, monospace' };

/**
 * One focus ring for the whole panel. Keyboard users currently get almost no
 * visible focus anywhere, because most controls are styled with `outline: none`
 * by default browser resets — this restores a clear accent ring.
 */
export const focusRing = '0 0 0 3px rgba(242,112,29,0.25)';

/**
 * Recurring shapes. Shared so a card in one tab is pixel-identical to a card in
 * another. Each takes overrides via spread: `{ ...ui.card, padding: 20 }`.
 */
export const ui = {
  page: {
    padding: '20px 24px 40px',
    fontFamily: font.sans,
    color: c.text,
  },

  h2: { margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' },
  sub: { margin: '4px 0 0', fontSize: 12.5, color: c.body },

  card: {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: radius.lg,
    padding: 16,
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '12px 16px',
    borderBottom: `1px solid ${c.border}`,
  },
  cardTitle: { fontSize: 13, fontWeight: 650, color: c.text },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: {
    textAlign: 'left',
    padding: '9px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: c.muted,
    background: c.sunken,
    borderBottom: `1px solid ${c.border}`,
    whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right',
    padding: '9px 14px',
    fontSize: 11,
    fontWeight: 600,
    color: c.muted,
    background: c.sunken,
    borderBottom: `1px solid ${c.border}`,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 14px', verticalAlign: 'top', borderBottom: `1px solid ${c.divider}` },
  tdRight: { padding: '10px 14px', verticalAlign: 'top', textAlign: 'right', borderBottom: `1px solid ${c.divider}`, whiteSpace: 'nowrap' },

  input: {
    padding: '7px 9px',
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: radius.sm,
    fontSize: 12,
    color: c.text,
    fontFamily: font.sans,
    fontWeight: 400,
    outline: 'none',
  },

  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: c.accent, color: '#fff', border: 'none',
    borderRadius: radius.sm, padding: '8px 13px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font.sans,
  },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: c.card, color: c.body, border: `1px solid ${c.border}`,
    borderRadius: radius.sm, padding: '8px 13px',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font.sans,
  },
  miniBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: c.card, color: c.body, border: `1px solid ${c.border}`,
    borderRadius: 6, padding: '4px 8px',
    fontSize: 11, cursor: 'pointer', fontFamily: font.sans, whiteSpace: 'nowrap',
  },

  pill: {
    display: 'inline-block', padding: '2px 7px', borderRadius: 999,
    fontSize: 10.5, fontWeight: 650, whiteSpace: 'nowrap',
  },

  // Every empty state gets an icon, a title and a hint. A bare grey sentence
  // reads as "broken"; this reads as "nothing here yet, here's why".
  empty: {
    padding: '40px 20px', textAlign: 'center', color: c.body, fontSize: 13,
    background: c.page, border: `1px dashed ${c.border}`, borderRadius: radius.lg,
  },
  emptyTitle: { marginTop: 8, fontSize: 13.5, fontWeight: 650, color: c.text },
  emptyHint: { marginTop: 4, fontSize: 12, color: c.muted, maxWidth: 460, margin: '4px auto 0', lineHeight: 1.5 },

  // Inline feedback. Prefer this to window.alert/confirm: it does not block the
  // page, does not lose the message on the next render, and can be styled.
  toast: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
    padding: '9px 12px', borderRadius: radius.sm, fontSize: 12.5,
    background: c.okBg, border: `1px solid ${c.okBorder}`, color: '#065F46',
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
    padding: '9px 12px', borderRadius: radius.sm, fontSize: 12.5,
    background: c.dangerBg, border: `1px solid ${c.dangerBorder}`, color: c.dangerFg,
  },
};

/** Money and dates, formatted the same way in every tab. */
export const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Compact form for tiles and table cells where two decimals is noise. */
export const inrShort = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * The panel's one empty state: icon, title, and a hint that says what to do
 * next. A bare centred grey sentence reads as a broken page; this reads as
 * "nothing here yet, and here is why".
 */
export function EmptyState({ icon, title, hint, action }) {
  const h = React.createElement;
  return h('div', { style: ui.empty },
    icon || null,
    h('div', { style: ui.emptyTitle }, title),
    hint ? h('div', { style: ui.emptyHint }, hint) : null,
    action ? h('div', { style: { marginTop: 14 } }, action) : null,
  );
}
