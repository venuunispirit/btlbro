import React, { useState, useMemo } from 'react';
import { formatNumber, formatINR, formatDate, buildAutoAnalytics } from '../../../utils/campaignMath.js';

/* ============================================================
   CampaignMiniChart — small read-only preview of the blue
   (Reach) / orange (Returns) dual-axis graph inside the admin
   Campaign Analytics panel. Shows exactly what the frontend
   popup will render for the same data. Data point editing lives
   in the panel; this is the live visual preview.
   ============================================================ */

const REACH_COLOR = '#2563EB';
const RETURN_COLOR = '#F2701D';

export default function CampaignMiniChart({ points, autoSource, height = 190 }) {
  const [hover, setHover] = useState(null);

  // Manual points first; otherwise auto-build from the live metric fields so
  // the preview graph updates the moment admin edits reach/returns/dates.
  const data = useMemo(() => {
    const manual = [...(points || [])]
      .map((p) => ({ date: p.date, label: p.label, reach: Number(p.reach) || 0, returns: Number(p.returns) || 0 }))
      .filter((p) => p.date || p.label)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (manual.length > 0) return manual;
    return buildAutoAnalytics(autoSource || {});
  }, [points, autoSource]);

  if (data.length === 0) {
    return (
      <div style={{ border: '1.5px dashed #E7E2D8', borderRadius: 10, padding: '22px 14px', textAlign: 'center', color: '#949494', fontSize: 12 }}>
        Nothing to plot yet — enter estimated/actual reach or returns above.
      </div>
    );
  }

  const W = 520;
  const H = height;
  const pad = { top: 14, right: 52, bottom: 26, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxReach = Math.max(...data.map((d) => d.reach), 0);
  const maxReturn = Math.max(...data.map((d) => d.returns), 0);
  const x = (i) => (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yReach = (v) => innerH - (maxReach > 0 ? (v / maxReach) * innerH : 0);
  const yReturn = (v) => innerH - (maxReturn > 0 ? (v / maxReturn) * innerH : 0);

  const linePath = (getter) => data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${getter(d).toFixed(1)}`)
    .join(' ');

  const ticks = (max) => {
    if (max <= 0) return [0];
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    const out = [];
    for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
    return out;
  };

  const hp = hover != null ? data[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Campaign performance preview: Reach (blue) and Returns (orange)" onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {ticks(maxReach).map((v, i) => (
          <g key={`r${i}`}>
            <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + yReach(v)} y2={pad.top + yReach(v)} stroke="#E7E2D8" strokeWidth="1" />
            <text x={pad.left - 6} y={pad.top + yReach(v) + 3} textAnchor="end" fontSize="8.5" fill='#949494'>{formatNumber(v)}</text>
          </g>
        ))}
        {ticks(maxReturn).map((v, i) => (
          <text key={`t${i}`} x={pad.left + innerW + 6} y={pad.top + yReturn(v) + 3} textAnchor="start" fontSize="8.5" fill="#B45309">{formatNumber(v)}</text>
        ))}
        {data.map((d, i) => {
          const every = Math.ceil(data.length / 7);
          if (i % every !== 0 && i !== data.length - 1) return null;
          return (
            <text key={`x${i}`} x={pad.left + x(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill='#949494'>
              {d.date ? formatDate(d.date).replace(/ \d{4}$/, '') : (d.label || '')}
            </text>
          );
        })}

        <g transform={`translate(${pad.left},${pad.top})`}>
          <path d={linePath((d) => yReturn(d.returns))} fill="none" stroke={RETURN_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath((d) => yReach(d.reach))} fill="none" stroke={REACH_COLOR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <g key={`p${i}`}>
              <circle cx={x(i)} cy={yReach(d.reach)} r={hover === i ? 4.5 : 3} fill="#fff" stroke={REACH_COLOR} strokeWidth="2" />
              <circle cx={x(i)} cy={yReturn(d.returns)} r={hover === i ? 4.5 : 3} fill="#fff" stroke={RETURN_COLOR} strokeWidth="2" />
              <rect
                x={x(i) - innerW / Math.max(1, data.length * 2)} y={-pad.top}
                width={innerW / Math.max(1, data.length)} height={innerH + pad.bottom + pad.top}
                fill="transparent" onMouseEnter={() => setHover(i)}
              />
            </g>
          ))}
          {hp && <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} stroke="#E7E2D8" strokeDasharray="3 3" />}
        </g>
      </svg>

      {hp && (
        <div style={{
          position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(20,20,20,.92)', color: '#fff', borderRadius: 8, padding: '6px 11px',
          fontSize: 11, lineHeight: 1.5, boxShadow: '0 8px 22px rgba(0,0,0,.25)', zIndex: 4, whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700 }}>{formatDate(hp.date)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 50, background: REACH_COLOR }} /> Reach: {formatNumber(hp.reach)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 50, background: RETURN_COLOR }} /> Returns: {formatINR(hp.returns)}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6, fontSize: 11, fontWeight: 600, color: '#4A4A4A' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 50, background: REACH_COLOR }} /> Reach</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 50, background: RETURN_COLOR }} /> Returns</span>
      </div>
    </div>
  );
}
