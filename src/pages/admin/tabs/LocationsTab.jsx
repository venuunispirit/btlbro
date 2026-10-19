import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, RefreshCw, Download, X, ExternalLink, Layers, Clock, ChevronRight, Inbox, SlidersHorizontal, Search } from 'lucide-react';
import { useGlobalSearch } from '../useGlobalSearch.js';

// ---------- Helpers ----------

function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

// Price-like types (e.g. "₹5,000" — a broken parse artifact) are junk, not catchments.
function isJunkType(type) {
  if (!type || typeof type !== 'string') return true;
  return /^[\d₹,\s.\-]+$/.test(type.trim());
}

function humanize(type) {
  return String(type || 'Untitled')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Normalize a record's data into a { service: price } object. New multi-tab sheets
// store a `services` map with numeric prices; old flat-price columns fold in too.
const CORE_KEYS = new Set([
  'sheet_id', 'name', 'type', 'tab_name', 'sl_no', 'pin_code', 'has_pin_column',
  'distance_km', 'has_distance_column', 'lat', 'lng', 'gmap_link', 'gmap_query',
  'is_active', 'created_at', 'updated_at', 'source', 'edited_locally', 'edited_at',
  'distance', 'apartment', 'id', 'row',
]);

function pricesOf(d) {
  if (!d) return {};
  if (d.services && typeof d.services === 'object') {
    const out = {};
    Object.entries(d.services).forEach(([k, v]) => {
      const key = String(k).toLowerCase().trim();
      if (key) out[key] = Number(v) || 0;
    });
    return out;
  }
  const legacy = ['digital_promotion', 'lift_promotion', 'stall_space', 'digital_screen', 'notice_board'];
  const out = {};
  legacy.forEach((k) => {
    if (d[k] !== undefined && d[k] !== null && d[k] !== '') out[k.replace(/_/g, ' ')] = Number(String(d[k]).replace(/[₹,\s]/g, '')) || 0;
  });
  Object.entries(d).forEach(([k, v]) => {
    if (CORE_KEYS.has(k) || k === 'services' || k.endsWith('_promotion') || k.endsWith('_space') || k.endsWith('_screen')) return;
    if (v === null || v === undefined || v === '') return;
    const clean = String(v).replace(/[₹,\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(clean)) out[k] = Number(clean);
  });
  return out;
}

function normKey(k) {
  return String(k).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const now = new Date();
  const d = new Date(dateStr);
  const mins = Math.floor((now - d) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PALETTE = ['#F2701D', '#8A2BE2', '#10B981', '#2563EB', '#D97706', '#DC2626', '#0D9488', '#7C3AED', '#4F46E5', '#BE185D'];

// ---------- Component ----------

export default function LocationsTab() {
  const [records, setRecords] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const search = useGlobalSearch();
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState(null); // { type, rows, counts, priceCols, updatedAt, files }
  const [modalSearch, setModalSearch] = useState('');
  const [modalShowInactive, setModalShowInactive] = useState(false);
  async function loadAll() {
    try {
      setLoading(true);
      const recRes = await fetch('/api/admin/records?limit=2000&include_inactive=true');
      const recData = await recRes.json().catch(() => ({}));
      const recs = recData.records || [];
      setRecords(recs);
      try {
        const fileRes = await fetch('/api/admin/google-drive/files');
        const fileData = await fileRes.json().catch(() => ({}));
        setFiles(fileData.files || []);
      } catch { setFiles([]); }
    } catch (err) {
      console.error('[LocationsTab] loadAll failed:', err);
      setRecords([]);
      setFiles([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    const onFocus = () => loadAll();
    window.addEventListener('focus', onFocus);
    const poll = setInterval(() => loadAll(), 45000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(poll); };
  }, []);

  // ---- Group records into catchments ----
  const catchments = useCallback(() => {
    const groups = new Map();
    records.forEach((r) => {
      const type = r.data?.type;
      if (isJunkType(type)) return;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(r);
    });
    const list = [...groups.entries()]
      .map(([type, rows]) => {
        const activeRows = rows.filter((r) => r.data?.is_active !== false);
        const priceCols = [];
        const seen = new Set();
        [...activeRows, ...(activeRows.length === 0 ? rows : [])].forEach((r) => {
          Object.keys(pricesOf(r.data)).forEach((k) => {
            const nk = normKey(k);
            if (!seen.has(nk)) { seen.add(nk); priceCols.push({ key: k, norm: nk }); }
          });
        });
        const prices = activeRows.flatMap((r) => Object.values(pricesOf(r.data)));
        const minPrice = prices.length ? Math.min(...prices) : null;
        const googleCount = rows.filter((r) => String(r.data?.source || '').toLowerCase().includes('google')).length;
        const updatedAt = rows.reduce((acc, r) => {
          const t = r.data?.updated_at || r.updated_at;
          return t && (!acc || new Date(t) > new Date(acc)) ? t : acc;
        }, null);
        const fileIds = new Set(rows.map((r) => r.file_id).filter(Boolean));
        return {
          type,
          label: humanize(type),
          rows,
          active: activeRows.length,
          total: rows.length,
          priceCols,
          minPrice,
          googleCount,
          updatedAt,
          files: [...fileIds].map((id) => files.find((f) => f.id === Number(id))).filter(Boolean),
        };
      })
      .sort((a, b) => b.active - a.active || a.label.localeCompare(b.label));
    return list;
  }, [records, files]);

  const grouped = catchments();

  const filtered = grouped.filter((c) => {
    if (!showInactive && c.active === 0) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.label.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      c.priceCols.some((p) => p.key.toLowerCase().includes(q));
  });

  const totalActive = grouped.reduce((n, c) => n + c.active, 0);
  const totalRecords = records.length;

  // ---- Build the sheet modal ----
  function openCatchment(c) {
    const ordered = [...c.rows].sort((a, b) => Number(b.data?.is_active !== false) - Number(a.data?.is_active !== false));
    setSelected({ ...c, ordered });
    setModalSearch('');
    setModalShowInactive(false);
  }

  const modalRows = selected
    ? selected.ordered.filter((r) => {
        if (!modalShowInactive && r.data?.is_active === false) return false;
        if (!modalSearch.trim()) return true;
        const q = modalSearch.toLowerCase();
        return JSON.stringify(r.data || {}).toLowerCase().includes(q);
      })
    : [];

  function csvValue(v) {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCatchment() {
    if (!selected) return;
    const priceKeys = selected.priceCols.map((p) => p.key);
    const headers = ['#', 'name', 'pin_code', 'distance_km', ...priceKeys, 'source', 'status'];
    const lines = [headers.join(',')];
    selected.ordered.forEach((r, i) => {
      const d = r.data || {};
      const prices = pricesOf(d);
      const row = [
        i + 1,
        csvValue(d.name || d.apartment || ''),
        csvValue(d.pin_code || ''),
        csvValue(d.distance_km ?? d.distance ?? ''),
        ...priceKeys.map((k) => {
          const nk = normKey(k);
          const found = Object.entries(prices).find(([pk]) => normKey(pk) === nk);
          return csvValue(found ? found[1] : '');
        }),
        csvValue(d.source || ''),
        d.is_active === false ? 'inactive' : 'active',
      ];
      lines.push(row.join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.type || 'catchment'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowInactive((v) => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
            border: showInactive ? '1.5px solid #F2701D' : '1.5px solid #E7E2D8',
            background: showInactive ? '#FFF4EC' : '#fff',
            color: showInactive ? '#F2701D' : '#4A4A4A', fontSize: 12.5, fontWeight: 600,
          }}
        >
          <SlidersHorizontal size={14} /> Show inactive
        </button>
        <button onClick={loadAll} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 14px', borderRadius: 10, border: '1.5px solid #E7E2D8', background: '#fff',
          fontSize: 12.5, fontWeight: 600, color: '#4A4A4A', cursor: 'pointer',
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 12.5, color: '#949494' }}>
          <strong style={{ color: '#161616' }}>{filtered.length}</strong> catchments ·{' '}
          <strong style={{ color: '#10B981' }}>{totalActive}</strong> active / {totalRecords} records
        </span>
      </div>
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#949494' }}>Loading catchments…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#949494', border: '1px dashed #E7E2D8', borderRadius: 14, background: '#FAF9F7' }}>
          <Inbox size={36} style={{ margin: '0 auto 12px', color: '#C7BFB2' }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: '#4A4A4A' }}>No catchments found</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>{search ? 'Try a different search.' : 'Sync from Google Sheet — every tab becomes a catchment card automatically.'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
          {filtered.map((c) => {
            const color = PALETTE[Math.abs(normKey(c.type).length + c.type.length) % PALETTE.length];
            return (
              <button
                key={c.type}
                onClick={() => openCatchment(c)}
                style={{
                  textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                  background: '#fff', borderRadius: 14, padding: 18,
                  border: c.active > 0 ? '1px solid #E7E2D8' : '1px dashed #D8D2C6',
                  boxShadow: '0 1px 3px rgba(22,22,22,0.04)', fontFamily: "'Inter', sans-serif",
                  transition: 'box-shadow .15s ease, transform .15s ease, border-color .15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(22,22,22,0.08)'; e.currentTarget.style.borderColor = '#F2701D'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(22,22,22,0.04)'; e.currentTarget.style.borderColor = c.active > 0 ? '#E7E2D8' : '#D8D2C6'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                    background: color + '1A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Layers size={20} color={color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#161616', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
                    <div style={{ fontSize: 11, color: '#949494', textTransform: 'capitalize' }}>{c.type}{c.active === 0 ? ' · inactive' : ''}</div>
                  </div>
                  <span style={{
                    padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, flexShrink: 0,
                    background: c.active > 0 ? '#ECFDF5' : '#EFEBE4', color: c.active > 0 ? '#059669' : '#949494',
                  }}>{c.active} / {c.total}</span>
                </div>

                {/* Service chips */}
                {c.priceCols.length > 0 ? (
                  <div style={{ marginTop: 12, minHeight: 20 }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {c.priceCols.slice(0, 4).map((p) => (
                        <span key={p.key} style={{ padding: '3px 9px', borderRadius: 6, background: '#FAF9F7', border: '1px solid #F0EDE8', fontSize: 10.5, fontWeight: 600, color: '#4A4A4A', textTransform: 'capitalize' }}>
                          {humanize(p.key)}
                        </span>
                      ))}
                      {c.priceCols.length > 4 && <span style={{ fontSize: 10.5, color: '#949494', padding: '3px 2px' }}>+{c.priceCols.length - 4}</span>}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, fontSize: 11, color: '#949494' }}>No pricing columns</div>
                )}

                {/* Card footer */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #F0EDE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#949494' }}>
                    {c.minPrice !== null && <span style={{ fontWeight: 700, color: '#F2701D' }}>from {fmtINR(c.minPrice)}</span>}
                    {c.googleCount > 0 && <span style={{ padding: '2px 7px', borderRadius: 5, background: '#FEF3C7', color: '#B45309', fontWeight: 700, fontSize: 10 }}>{c.googleCount} Google</span>}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {timeAgo(c.updatedAt)}</span>
                  </div>
                  <ChevronRight size={15} color="#F2701D" style={{ flexShrink: 0 }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ===== CATCHMENT MODAL ===== */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, maxWidth: 1180, width: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', border: '1px solid #E7E2D8', boxShadow: '0 24px 60px rgba(0,0,0,0.28)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #E7E2D8', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FFF4EC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={19} color="#F2701D" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#161616', margin: 0 }}>{selected.label}</h3>
                  <p style={{ fontSize: 12, color: '#949494', marginTop: 2 }}>
                    {selected.type} · {selected.active} active / {selected.total} records
                    {selected.files.length > 0 && ` · ${selected.files.map((f) => f.file_name).join(', ')}`}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} title="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A4A4A', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Summary strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid #F0EDE8', background: '#FAF9F7', flexWrap: 'wrap' }}>
              {[
                { label: 'Locations', value: `${selected.active} active` },
                { label: 'Services', value: String(selected.priceCols.length) },
                { label: 'Starting price', value: selected.minPrice !== null ? fmtINR(selected.minPrice) : '—' },
                { label: 'Last updated', value: fmtDate(selected.updatedAt) },
              ].map((s) => (
                <span key={s.label} style={{ fontSize: 12, color: '#4A4A4A', padding: '4px 10px', background: '#fff', border: '1px solid #F0EDE8', borderRadius: 7 }}>
                  {s.label}: <strong style={{ color: '#161616' }}>{s.value}</strong>
                </span>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderBottom: '1px solid #E7E2D8', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1.5px solid #E7E2D8', borderRadius: 8, background: '#FAF9F7' }}>
                  <Search size={14} color="#949494" />
                  <input
                    type="text"
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    placeholder="Search inside catchment…"
                    style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, fontFamily: "'Inter', sans-serif", width: 220, color: '#161616' }}
                  />
                </div>
                {selected && selected.ordered.some((r) => r.data?.is_active === false) && (
                  <button
                    onClick={() => setModalShowInactive(!modalShowInactive)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: modalShowInactive ? '1.5px solid #F2701D' : '1.5px solid #E7E2D8',
                      background: modalShowInactive ? '#FFF4EC' : '#FAF9F7',
                      color: modalShowInactive ? '#F2701D' : '#4A4A4A', fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    <SlidersHorizontal size={13} /> Inactive ({selected.ordered.filter((r) => r.data?.is_active === false).length})
                  </button>
                )}
              </div>
              <button onClick={exportCatchment} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', background: '#F2701D', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              }}>
                <Download size={14} /> Export CSV
              </button>
            </div>

            {/* Sheet table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Location</th>
                    <th style={thStyle}>PIN</th>
                    <th style={thStyle}>Dist</th>
                    {selected.priceCols.map((p) => (
                      <th key={p.norm} style={{ ...thStyle, color: '#F2701D' }}>{humanize(p.key)}</th>
                    ))}
                    <th style={thStyle}>Maps</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows.length === 0 ? (
                    <tr><td colSpan={selected.priceCols.length + 7} style={{ padding: 36, textAlign: 'center', color: '#949494', fontSize: 13 }}>No matching locations</td></tr>
                  ) : modalRows.map((r, i) => {
                    const d = r.data || {};
                    const prices = pricesOf(d);
                    const inactive = d.is_active === false;
                    return (
                      <tr key={r.id} style={{ background: inactive ? '#F7F5F1' : (i % 2 === 0 ? '#fff' : '#FAF9F7'), opacity: inactive ? 0.75 : 1 }}>
                        <td style={tdStyleNum}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {d.name || d.apartment || '—'}
                          {d.distance && !d.distance_km && <span style={{ display: 'block', fontSize: 10, color: '#949494' }}>{d.distance}</span>}
                        </td>
                        <td style={tdStyle}>{d.pin_code || '—'}</td>
                        <td style={tdStyle}>{d.distance_km != null && d.distance_km !== '' ? `${d.distance_km} km` : '—'}</td>
                        {selected.priceCols.map((p) => {
                          const found = Object.entries(prices).find(([pk]) => normKey(pk) === p.norm);
                          return (
                            <td key={p.norm} style={{ ...tdStyle, fontWeight: found ? 700 : 400, color: found ? '#C2410C' : '#C7BFB2' }}>
                              {found ? fmtINR(found[1]) : '—'}
                            </td>
                          );
                        })}
                        <td style={tdStyle}>
                          {d.gmap_link ? (
                            <a href={d.gmap_link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#F2701D', display: 'inline-flex', alignItems: 'center' }}>
                              <ExternalLink size={14} />
                            </a>
                          ) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                            background: String(d.source || '').toLowerCase().includes('google') ? '#FEF3C7' : '#ECFDF5',
                            color: String(d.source || '').toLowerCase().includes('google') ? '#B45309' : '#059669',
                          }}>
                            {String(d.source || '').toLowerCase().includes('google') ? 'Google' : 'Inhouse'}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, textTransform: 'capitalize',
                            background: inactive ? '#EFEBE4' : '#ECFDF5',
                            color: inactive ? '#949494' : '#0F766E',
                          }}>
                            {inactive ? 'Inactive' : 'Active'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #E7E2D8', background: '#FAF9F7', fontSize: 12, color: '#949494' }}>
              <span>Showing {modalRows.length} of {selected.total} locations · pricing mirrors the Google Sheet (₹)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin size={13} color="#F2701D" /> {selected.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: '#949494', borderBottom: '1px solid #E7E2D8', background: '#FAF9F7',
  position: 'sticky', top: 0, whiteSpace: 'nowrap', zIndex: 1,
};

const tdStyle = {
  padding: '9px 14px', fontSize: 13, color: '#4A4A4A', borderBottom: '1px solid #F0EDE8', whiteSpace: 'nowrap',
};

const tdStyleNum = {
  ...tdStyle, color: '#B8AFA6', fontSize: 11, width: 34, textAlign: 'center',
};