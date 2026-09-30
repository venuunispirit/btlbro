import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, TrendingUp, Users, Lightbulb, CalendarDays, Clock } from 'lucide-react';
import {
  pct, formatDuration, formatNumber, formatINR, formatDate,
  buildProgression, formatAxisNumber,
} from '../utils/campaignMath.js';

/* ============================================================
   CampaignModal — Campaign Performance popup (glassmorphism).

   The uploaded campaign image is the popup BACKGROUND (single
   image source — no extra upload / duplicate image in here).
   LEFT  : glass info column — title, category badge, description,
           performance metric cards, HR utilisation pills.
   RIGHT : translucent graph panel — Start/End date chips on top,
           performance graph below, orange "Campaign Insights"
           pill button → opens the second popup on top.

   Graph: hand-rolled responsive SVG.
   BLUE line   = ACTUAL values (what the campaign achieved).
   ORANGE line = ESTIMATED target (ramp ending exactly at the
                 estimated reach entered in admin).
   Orange filled area = the estimated target zone.
   Uses the campaign's real Achievement Data Points when present.
   ============================================================ */

const ACTUAL_COLOR = '#2563EB';   // blue — actual
const ESTIMATED_COLOR = '#F97316'; // orange — estimated target

/* ---------- Actual vs Estimated line chart (SVG) ---------- */
function AchievementChart({ points, autoSource }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 560, h: 300 });
  const [hover, setHover] = useState(null); // index into the ACTUAL series

  const src = autoSource || {};

  // BLUE = ACTUAL: manual admin-entered data points when present, otherwise
  // an auto progression ending exactly at the entered ACTUAL reach
  // (falls back to the estimated reach when no actual was recorded yet).
  const actual = useMemo(() => {
    const manual = [...(points || [])]
      .map((p) => ({ date: p.date, label: p.label, reach: Number(p.reach) || 0, returns: Number(p.returns) || 0 }))
      .filter((p) => p.date || p.label)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (manual.length > 0) return manual;
    const end = Number(src.actual_reach) > 0 ? Number(src.actual_reach) : Number(src.estimated_reach) || 0;
    return buildProgression(end, src).map((p) => ({ ...p, reach: p.value }));
  }, [points, src]);

  // ORANGE = ESTIMATED target ramp — ends exactly at the ESTIMATED reach.
  const estimated = useMemo(
    () => buildProgression(Number(src.estimated_reach) > 0 ? Number(src.estimated_reach) : 0, src),
    [src],
  );

  // Returns (₹) ramp — used for the tooltip when no manual points exist.
  const returnsRamp = useMemo(() => {
    const end = Number(src.actual_return) > 0 ? Number(src.actual_return) : Number(src.estimated_return) || 0;
    return buildProgression(end, src);
  }, [src]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const H = Math.max(230, Math.min(420, size.h || 300));
  const W = Math.max(280, size.w || 560);
  const pad = { top: 24, right: 26, bottom: 30, left: 62 };
  const innerW = Math.max(60, W - pad.left - pad.right);
  const innerH = Math.max(60, H - pad.top - pad.bottom);

  if (actual.length === 0 && estimated.length === 0) {
    return (
      <div className="cmod-chart" ref={wrapRef}>
        <div className="cmod-chart-empty">
          No data to plot yet — enter estimated/actual reach in the admin.
        </div>
      </div>
    );
  }

  // X position: by date fraction across the campaign period when possible,
  // otherwise evenly spaced by index (P1..Pn labels).
  const startD = src.start_date ? new Date(src.start_date) : null;
  const endD = src.end_date ? new Date(src.end_date) : null;
  const hasRange = startD && endD && !isNaN(startD.getTime()) && !isNaN(endD.getTime()) && endD > startD;
  const frac = (it, idx, len) => {
    if (hasRange && it.date) {
      const t = (new Date(it.date).getTime() - startD.getTime()) / (endD.getTime() - startD.getTime());
      return Math.min(1, Math.max(0, t));
    }
    return len === 1 ? 0.5 : idx / (len - 1);
  };

  const aPts = actual.map((it, i) => ({ fx: frac(it, i, actual.length), v: it.reach, it }));
  const ePts = estimated.map((it, i) => ({ fx: frac(it, i, estimated.length), v: it.value, it }));

  const maxY = Math.max(...aPts.map((p) => p.v), ...ePts.map((p) => p.v), 0);
  if (!(maxY > 0)) {
    return (
      <div className="cmod-chart" ref={wrapRef}>
        <div className="cmod-chart-empty">
          No data to plot yet — enter estimated/actual reach in the admin.
        </div>
      </div>
    );
  }

  const X = (f) => f * innerW;
  const Y = (v) => innerH - (v / maxY) * innerH;

  // Catmull-Rom → cubic bezier for smooth modern curves.
  const smooth = (pts) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const linePath = (pts) => smooth(pts.map((p) => ({ x: X(p.fx), y: Y(p.v) })));
  const areaPath = (pts) => `${linePath(pts)} L${X(pts[pts.length - 1].fx).toFixed(1)},${innerH} L${X(pts[0].fx).toFixed(1)},${innerH} Z`;

  const ticks = (max) => {
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    const out = [];
    for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
    return out;
  };

  const hp = hover != null ? aPts[hover] : null;
  const estAt = (f) => (ePts.length ? ePts[Math.round(f * (ePts.length - 1))].v : null);
  const returnsAt = (f, it) => {
    if (it && it.returns) return it.returns;
    if (returnsRamp.length) return returnsRamp[Math.round(f * (returnsRamp.length - 1))].value;
    return null;
  };

  const xLabelSeries = aPts.length > 0 ? aPts : ePts;

  return (
    <div className="cmod-chart" ref={wrapRef}>
      <svg
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        role="img" aria-label="Campaign performance: Actual reach (blue) vs Estimated target (orange)"
        onMouseLeave={() => setHover(null)}
      >
        {/* axis title */}
        <text x={pad.left - 4} y={11} fontSize="10" fontWeight="600" fill="#64748B">Reach</text>

        {/* clean VERTICAL grid lines at every actual data point */}
        {aPts.map((p, i) => (
          <line key={`v${i}`} x1={pad.left + X(p.fx)} x2={pad.left + X(p.fx)} y1={pad.top} y2={pad.top + innerH} stroke="#DDE4EE" strokeWidth="1" />
        ))}

        {/* y-axis tick labels (compact: Cr / L / K) */}
        {ticks(maxY).map((v, i) => (
          <text key={`y${i}`} x={pad.left - 8} y={pad.top + Y(v) + 3} textAnchor="end" fontSize="9.5" fill="#64748B">{formatAxisNumber(v)}</text>
        ))}

        {/* x labels — dates when available, period labels otherwise */}
        {xLabelSeries.map((p, i) => {
          const every = Math.ceil(xLabelSeries.length / 8);
          if (i % every !== 0 && i !== xLabelSeries.length - 1) return null;
          return (
            <text key={`x${i}`} x={pad.left + X(p.fx)} y={H - 10} textAnchor="middle" fontSize="9.5" fill="#64748B">
              {p.it.date ? formatDate(p.it.date).replace(/ \d{4}$/, '') : (p.it.label || '')}
            </text>
          );
        })}

        <defs>
          <linearGradient id="cmodEstFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ESTIMATED_COLOR} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ESTIMATED_COLOR} stopOpacity="0.06" />
          </linearGradient>
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
          {/* axis baselines */}
          <line x1={0} x2={0} y1={0} y2={innerH} stroke="#CBD5E1" strokeWidth="1" />
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#CBD5E1" strokeWidth="1" />

          {/* orange filled area under the ESTIMATED target line */}
          {ePts.length > 0 && <path d={areaPath(ePts)} fill="url(#cmodEstFill)" />}

          {/* performance lines — orange = estimated target, blue = actual */}
          {ePts.length > 0 && (
            <path d={linePath(ePts)} fill="none" stroke={ESTIMATED_COLOR} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          )}
          <path d={linePath(aPts)} fill="none" stroke={ACTUAL_COLOR} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />

          {/* circular data points + fat invisible hit areas */}
          {ePts.map((p, i) => (
            <circle key={`e${i}`} cx={X(p.fx)} cy={Y(p.v)} r={3.4} fill="#fff" stroke={ESTIMATED_COLOR} strokeWidth="2.2" />
          ))}
          {aPts.map((p, i) => (
            <g key={`a${i}`}>
              <circle cx={X(p.fx)} cy={Y(p.v)} r={hover === i ? 5 : 3.6} fill="#fff" stroke={ACTUAL_COLOR} strokeWidth="2.2" />
              <rect
                x={X(p.fx) - innerW / Math.max(1, aPts.length * 2)} y={-pad.top}
                width={innerW / Math.max(1, aPts.length)} height={innerH + pad.bottom + pad.top}
                fill="transparent" onMouseEnter={() => setHover(i)}
              />
            </g>
          ))}

          {hp && (
            <line x1={X(hp.fx)} x2={X(hp.fx)} y1={0} y2={innerH} stroke="#94A3B8" strokeDasharray="3 3" />
          )}
        </g>
      </svg>

      {hp && (
        <div className="cmod-tooltip">
          <div className="cmod-tooltip-date">{hp.it.date ? formatDate(hp.it.date) : (hp.it.label || '')}</div>
          <div className="cmod-tooltip-row"><span className="cmod-dot" style={{ background: ACTUAL_COLOR }} /> Actual: {formatNumber(hp.v)}</div>
          {ePts.length > 0 && (
            <div className="cmod-tooltip-row"><span className="cmod-dot" style={{ background: ESTIMATED_COLOR }} /> Estimated: {formatNumber(estAt(hp.fx))}</div>
          )}
          {returnsAt(hp.fx, hp.it) != null && (
            <div className="cmod-tooltip-row"><span className="cmod-dot" style={{ background: '#0B915F' }} /> Returns: {formatINR(returnsAt(hp.fx, hp.it))}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Small building blocks ---------- */
function MetricCard({ label, value, variant }) {
  return (
    <div className={`cmod-metric${variant ? ` cmod-metric-${variant}` : ''}`}>
      <div className="cmod-metric-label">{label}</div>
      <div className="cmod-metric-value">{value}</div>
    </div>
  );
}

function HrPill({ label, value, accent }) {
  return (
    <div className={`cmod-pill${accent ? ' cmod-pill-accent' : ''}`}>
      <div className="cmod-pill-label">{label}</div>
      <div className="cmod-pill-value">{value}</div>
    </div>
  );
}

/* ============================================================
   InsightsModal — the SECOND popup, opened on top of the
   performance popup by the "Campaign Insights" button.
   Same campaign image reused as a subtle background.
   ============================================================ */
function InsightsModal({ campaign, onClose }) {
  const closeRef = useRef(null);

  // Capture-phase Escape → close THIS popup first (main popup stays open).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const c = campaign;
  const reachAchv = pct(c.actual_reach, c.estimated_reach);
  const returnAchv = pct(c.actual_return, c.estimated_return);
  const util = pct(c.resources_utilized, c.total_resources);

  const CmpRow = ({ label, est, act, achv, color }) => (
    <div className="cmod-ins-row">
      <div className="cmod-ins-row-head">
        <span>{label}</span>
        <b>{typeof achv === 'number' ? `${achv}%` : achv}</b>
      </div>
      {typeof achv === 'number' && (
        <div className="cmod-ins-bar">
          <div className="cmod-ins-bar-fill" style={{ width: `${Math.min(100, Math.max(0, achv))}%`, background: color }} />
        </div>
      )}
      <div className="cmod-ins-vals">
        <span>Estimated: <b>{est}</b></span>
        <span>Actual: <b>{act}</b></span>
      </div>
    </div>
  );

  return (
    <div className="cmod-ins-backdrop" role="presentation" onMouseDown={(e) => e.stopPropagation()}>
      <div
        className={`cmod-ins${c.image ? '' : ' cmod-nobg'}`}
        style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`Campaign insights: ${c.title || 'Campaign'}`}
      >
        <div className="cmod-ins-overlay" aria-hidden="true" />
        <button ref={closeRef} className="cmod-ins-close" onClick={onClose} aria-label="Close campaign insights">
          <X size={17} />
        </button>

        <div className="cmod-ins-body">
          <div className="cmod-title-row">
            <h3 className="cmod-ins-title">{c.title || 'Untitled Campaign'}</h3>
            {c.category ? <span className={`cmod-badge cmod-badge-${c.category.toLowerCase()}`}>{c.category}</span> : null}
          </div>

          <div className="cmod-ins-period">
            <CalendarDays size={14} />
            <span>{formatDate(c.start_date) || '—'} → {formatDate(c.end_date) || '—'}</span>
            <Clock size={13} />
            <span>{formatDuration(c.start_date, c.end_date)}</span>
          </div>

          <div className="cmod-ins-chips">
            <div className="cmod-ins-chip">
              <div className="cmod-ins-chip-value">{typeof reachAchv === 'number' ? `${reachAchv}%` : reachAchv}</div>
              <div className="cmod-ins-chip-label">Reach Achievement</div>
            </div>
            <div className="cmod-ins-chip">
              <div className="cmod-ins-chip-value">{typeof returnAchv === 'number' ? `${returnAchv}%` : returnAchv}</div>
              <div className="cmod-ins-chip-label">Return Achievement</div>
            </div>
            <div className="cmod-ins-chip">
              <div className="cmod-ins-chip-value">{typeof util === 'number' ? `${util}%` : util}</div>
              <div className="cmod-ins-chip-label">Resource Utilization</div>
            </div>
          </div>

          <div className="cmod-ins-sec">Estimated vs Actual</div>
          <div className="cmod-ins-cmp">
            <CmpRow
              label="Reach"
              est={formatNumber(c.estimated_reach)}
              act={formatNumber(c.actual_reach)}
              achv={reachAchv}
              color="linear-gradient(90deg, #2563EB, #5B8DEF)"
            />
            <CmpRow
              label="Return ₹"
              est={formatINR(c.estimated_return)}
              act={formatINR(c.actual_return)}
              achv={returnAchv}
              color="linear-gradient(90deg, #F97316, #FB9A4B)"
            />
          </div>

          <div className="cmod-ins-sec">Human Resources</div>
          <div className="cmod-ins-row">
            <div className="cmod-ins-row-head">
              <span>HR Utilized</span>
              <b>{formatNumber(c.resources_utilized)} / {formatNumber(c.total_resources)}</b>
            </div>
            {typeof util === 'number' && (
              <div className="cmod-ins-bar">
                <div className="cmod-ins-bar-fill" style={{ width: `${Math.min(100, Math.max(0, util))}%`, background: 'linear-gradient(90deg, #0B915F, #10B981)' }} />
              </div>
            )}
            <div className="cmod-ins-vals">
              <span>Utilization: <b>{typeof util === 'number' ? `${util}%` : util}</b></span>
            </div>
          </div>

          <button className="cmod-ins-btn" onClick={onClose}>
            <X size={15} /> Close Insights
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CampaignModal — the main Campaign Performance popup.
   ============================================================ */
export default function CampaignModal({ campaign, onClose }) {
  const [showInsights, setShowInsights] = useState(false);
  const showInsightsRef = useRef(false);
  useEffect(() => { showInsightsRef.current = showInsights; }, [showInsights]);

  // Escape closes; while the insights popup is open, Escape closes THAT one
  // first (it has its own capture-phase handler) — this is the fallback.
  useEffect(() => {
    if (!campaign) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !showInsightsRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [campaign, onClose]);

  // Reset the insights popup whenever the campaign closes/changes.
  useEffect(() => { if (!campaign) setShowInsights(false); }, [campaign]);

  const closeBtnRef = useRef(null);
  useEffect(() => {
    if (campaign) closeBtnRef.current?.focus();
  }, [campaign]);

  const dialogRef = useRef(null);
  const onMouseDown = useCallback((e) => {
    // While the Insights popup is open, every click belongs to IT — never
    // close the main performance popup from here (its own X / Close button
    // handles going back one step only).
    if (showInsightsRef.current) return;
    if (e.target?.closest?.('.cmod-ins-backdrop')) return;
    if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose();
  }, [onClose]);

  if (!campaign) return null;

  const c = campaign;
  const util = pct(c.resources_utilized, c.total_resources);

  return (
    <div className="cmod-backdrop" onMouseDown={onMouseDown} role="presentation">
      <div
        className={`cmod-dialog${c.image ? '' : ' cmod-nobg'}`}
        style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={c.title ? `Campaign performance: ${c.title}` : 'Campaign performance'}
      >
        {/* dark→light translucent overlay: dark behind the info column,
            light behind the graph panel — keeps text & graph readable */}
        <div className="cmod-bg-overlay" aria-hidden="true" />

        <button ref={closeBtnRef} className="cmod-close" onClick={onClose} aria-label="Close campaign details">
          <X size={18} />
        </button>

        <div className="cmod-main">
          {/* LEFT — campaign information over the uploaded image */}
          <div className="cmod-left">
            <div className="cmod-title-row">
              <h3 className="cmod-title">{c.title || 'Untitled Campaign'}</h3>
              {c.category ? <span className={`cmod-badge cmod-badge-${c.category.toLowerCase()}`}>{c.category}</span> : null}
            </div>

            {c.desc ? <p className="cmod-desc">{c.desc}</p> : null}

            {/* margin-top:auto pushes Performance + HR sections to the
                bottom of the left panel (photo stays visible up top) */}
            <div className="cmod-sec-label" style={{ marginTop: 'auto', paddingTop: 14 }}><TrendingUp size={16} /> Campaign Performance</div>
            <div className="cmod-grid">
              <MetricCard label="Estimated Reach" value={formatNumber(c.estimated_reach)} />
              <MetricCard label="Actual Reach" value={formatNumber(c.actual_reach)} variant="blue" />
              <MetricCard label="Estimated Return ₹" value={formatINR(c.estimated_return)} />
              <MetricCard label="Actual Return ₹" value={formatINR(c.actual_return)} variant="orange" />
            </div>

            <div className="cmod-sec-label"><Users size={16} /> Human Resource Utilisation</div>
            <div className="cmod-hr-grid">
              <HrPill label="Total Human Resources" value={formatNumber(c.total_resources)} />
              <HrPill label="HR Utilized" value={formatNumber(c.resources_utilized)} />
              <HrPill label="Resource Utilization %" value={typeof util === 'number' ? `${util}%` : util} accent />
            </div>
          </div>

          {/* RIGHT — translucent performance graph panel */}
          <div className="cmod-right">
            <div className="cmod-range">
              <span className="cmod-range-chip">
                <span className="cmod-range-chip-label">Start Date</span>
                <span className="cmod-range-chip-value">{formatDate(c.start_date) || '—'}</span>
              </span>
              <span className="cmod-range-arrow" aria-hidden="true">→</span>
              <span className="cmod-range-chip">
                <span className="cmod-range-chip-label">End Date</span>
                <span className="cmod-range-chip-value">{formatDate(c.end_date) || '—'}</span>
              </span>
              <span className="cmod-range-spacer" />
              <div className="cmod-legend">
                <span className="cmod-legend-item"><span className="cmod-dot" style={{ background: ACTUAL_COLOR }} /> Actual</span>
                <span className="cmod-legend-item"><span className="cmod-dot" style={{ background: ESTIMATED_COLOR }} /> Estimated</span>
              </div>
            </div>

            <AchievementChart
              points={c.analytics || []}
              autoSource={{
                start_date: c.start_date, end_date: c.end_date,
                estimated_reach: c.estimated_reach, actual_reach: c.actual_reach,
                estimated_return: c.estimated_return, actual_return: c.actual_return,
              }}
            />

            <button className="cmod-btn-insights" onClick={() => setShowInsights(true)}>
              <Lightbulb size={17} /> Campaign Insights
            </button>
          </div>
        </div>
      </div>

      {/* SECOND popup — opens on top of the performance popup */}
      {showInsights && <InsightsModal campaign={c} onClose={() => setShowInsights(false)} />}
    </div>
  );
}
