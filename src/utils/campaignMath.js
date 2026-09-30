/* ============================================================
   campaignMath.js — shared helpers for the campaign feature.
   Single source of truth for the automatic calculations and
   formatting used by the admin editors AND the frontend popup,
   so numbers can never diverge between admin and site.
   ============================================================ */

export const CAMPAIGN_CATEGORIES = ['BTL', 'TTL', 'ATL', 'Gamified'];

/** A campaign may only appear on the site when ALL required fields are
 *  filled: Title, Category, Start Date, End Date (end not before start).
 *  Anything incomplete is hidden from the frontend everywhere. */
export function isCompleteCampaign(it = {}) {
  const title = String(it.title || '').trim();
  return !!(
    title &&
    it.category &&
    it.start_date &&
    it.end_date &&
    !(String(it.end_date) < String(it.start_date))
  );
}

/** Safe percentage: (part / total) * 100, rounded to 1 decimal, 'N/A' on
 *  missing/zero totals or NaN/Infinity (division-by-zero safety, req #24). */
export function pct(part, total) {
  const p = Number(part);
  const t = Number(total);
  if (!isFinite(p) || !isFinite(t) || t <= 0 || p < 0) return 'N/A';
  const v = (p / t) * 100;
  if (!isFinite(v)) return 'N/A';
  return Math.round(v * 10) / 10;
}

/** Duration in whole days between two ISO dates (end - start). 0 when invalid. */
export function campaignDurationDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  const ms = e.setHours(0, 0, 0, 0) - new Date(s).setHours(0, 0, 0, 0);
  return Math.max(0, Math.round(ms / 86400000));
}

/** "30 Days" — "1 Day" — "N/A" */
export function formatDuration(start, end) {
  const d = campaignDurationDays(start, end);
  if (d <= 0) return 'N/A';
  return `${d} ${d === 1 ? 'Day' : 'Days'}`;
}

/** 250000 → "250,000" (Indian grouping); 'N/A' when not a finite number ≥ 0. */
export function formatNumber(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return 'N/A';
  return v.toLocaleString('en-IN');
}

/** 500000 → "₹5,00,000" (Indian grouping); 'N/A' when not a finite number ≥ 0. */
export function formatINR(n) {
  const v = Number(n);
  if (!isFinite(v) || v < 0) return 'N/A';
  return `₹${v.toLocaleString('en-IN')}`;
}

/** ISO date → "01 Sep 2026"; '' when invalid. */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Build a smooth 0 → `end` progression across the campaign period
 * (smoothstep ease: slow start → fast middle → settle at the end).
 * Used by the popup chart for the Actual (blue) and Estimated (orange)
 * ramps — the curve always ends EXACTLY at the entered number.
 * Returns [] when `end` is not a positive number.
 */
export function buildProgression(end, c = {}) {
  const target = Number(end);
  if (!isFinite(target) || target <= 0) return [];

  const steps = 6;
  const start = c.start_date ? new Date(c.start_date) : null;
  const stop = c.end_date ? new Date(c.end_date) : null;
  const hasRange = start && stop && !isNaN(start.getTime()) && !isNaN(stop.getTime()) && stop > start;

  // smoothstep: t²(3−2t) — a believable campaign ramp, not a ruler-straight line
  const ease = (t) => t * t * (3 - 2 * t);

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { value: Math.round(target * ease(t)) };
    if (hasRange) {
      p.date = new Date(start.getTime() + (stop.getTime() - start.getTime()) * t).toISOString().slice(0, 10);
    } else {
      p.label = `P${i + 1}`;
    }
    points.push(p);
  }
  return points;
}

/**
 * Auto-generate a realistic 0 → result progression for the achievements graph
 * when the admin hasn't entered manual Date/Reach/Returns data points.
 * Uses ACTUAL reach/returns when present, otherwise the ESTIMATED targets,
 * spread across the campaign duration (or generic P1..Pn labels without dates).
 * Shape: smoothstep ease (slow start → fast middle → settle at the end), so
 * the curve responds to the entered numbers instead of a flat default line.
 * Returns [] when there is truly nothing to plot.
 */
export function buildAutoAnalytics(c = {}) {
  const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const endReach = num(c.actual_reach) || num(c.estimated_reach);
  const endReturn = num(c.actual_return) || num(c.estimated_return);
  if (!endReach && !endReturn) return [];

  const steps = 6;
  const start = c.start_date ? new Date(c.start_date) : null;
  const end = c.end_date ? new Date(c.end_date) : null;
  const hasRange = start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start;

  // smoothstep: t²(3−2t) — a believable campaign ramp, not a ruler-straight line
  const ease = (t) => t * t * (3 - 2 * t);

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { reach: Math.round(endReach * ease(t)), returns: Math.round(endReturn * ease(t)) };
    if (hasRange) {
      p.date = new Date(start.getTime() + (end.getTime() - start.getTime()) * t).toISOString().slice(0, 10);
    } else {
      p.label = `P${i + 1}`;
    }
    points.push(p);
  }
  return points;
}

/** Compact axis label: 54363456 → "5.4 Cr", 453000 → "4.5 L", 4200 → "4.2 K". */
export function formatAxisNumber(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '0';
  if (v >= 1e7) return `${trim1(v / 1e7)} Cr`;
  if (v >= 1e5) return `${trim1(v / 1e5)} L`;
  if (v >= 1e3) return `${trim1(v / 1e3)} K`;
  return String(Math.round(v));
}
function trim1(x) {
  const s = x >= 100 ? String(Math.round(x)) : x.toFixed(1);
  return s.replace(/\.0$/, '');
}

/** Tighten/normalize a marquee item's campaign payload (numbers as numbers). */
export function normalizeCampaignMetrics(it = {}) {
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    category: CAMPAIGN_CATEGORIES.includes(String(it.category || '').toUpperCase()) ? String(it.category).toUpperCase() : '',
    start_date: it.start_date || '',
    end_date: it.end_date || '',
    estimated_reach: num(it.estimated_reach),
    actual_reach: num(it.actual_reach),
    estimated_return: num(it.estimated_return),
    actual_return: num(it.actual_return),
    total_resources: num(it.total_resources),
    resources_utilized: num(it.resources_utilized),
    analytics: Array.isArray(it.analytics) ? it.analytics : [],
  };
}
