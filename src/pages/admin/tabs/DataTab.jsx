import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CheckSquare, Square, MapPin, RefreshCw, SlidersHorizontal, Download,
  Inbox, SearchX, UserCheck, ExternalLink,
} from 'lucide-react';
import { getRecords, editRecord, getTeam, assignRecords, setReceeStatus } from '../api.js';
import { useGlobalSearch, clearGlobalSearch } from '../useGlobalSearch.js';

// ---------- Helpers ----------

function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function humanize(type) {
  return String(type || 'Untitled')
    .split(/[\s_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isJunkType(type) {
  if (!type || typeof type !== 'string') return true;
  return /^[\d₹,\s.\-]+$/.test(type.trim());
}

function normKey(k) {
  return String(k).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const CORE_KEYS = new Set([
  'sheet_id', 'name', 'type', 'tab_name', 'sl_no', 'pin_code', 'has_pin_column',
  'distance_km', 'has_distance_column', 'lat', 'lng', 'gmap_link', 'gmap_query',
  'is_active', 'created_at', 'updated_at', 'source', 'edited_locally', 'edited_at', 'edited_by',
  'assigned_to', 'assigned_to_name', 'assigned_by', 'assigned_at', 'recee_status',
  'recee_status_at', 'recee_status_by', 'needs_recee', 'distance', 'apartment', 'id', 'row',
  'crm_backfill',
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

// A row's prices keyed by their normalized service name, so a price-column
// lookup during render is O(1) instead of a scan + regex per column per row.
// First spelling wins, mirroring the old `entries.find(...normKey === norm)`.
function normPricesOf(d) {
  const out = {};
  const prices = pricesOf(d);
  Object.keys(prices).forEach((k) => {
    const nk = normKey(k);
    if (!(nk in out)) out[nk] = prices[k];
  });
  return out;
}

// Every data row is a fixed single line (nowrap + ellipsis), so the window sees
// rows of exactly this height. Forced in the styles so the maths stays honest.
const ROW_H = 34;
const OVERSCAN = 8;

const TH_STYLE = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#949494', borderBottom: '1px solid #E7E2D8', whiteSpace: 'nowrap', background: '#FAF9F7' };
// Fixed height + box-sizing so every body row is exactly ROW_H tall — the
// windowing maths depends on it. Module-level so memoized rows keep one ref.
const TD_STYLE = { padding: '0 10px', height: ROW_H, boxSizing: 'border-box', verticalAlign: 'middle', borderBottom: '1px solid #F0EDE8', fontSize: 12.5, color: '#161616', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const RECEE_STYLES = {
  pending: { bg: '#FEF3C7', fg: '#B45309', label: 'Pending' },
  in_progress: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'In Progress' },
  done: { bg: '#ECFDF5', fg: '#059669', label: 'Done' },
};

function receeBadge(status) {
  return RECEE_STYLES[status] || { bg: '#EFEBE4', fg: '#949494', label: '—' };
}

const SOURCE_STYLE = {
  google: { bg: '#FEF3C7', fg: '#B45309', label: 'Google' },
  inhouse: { bg: '#ECFDF5', fg: '#059669', label: 'Inhouse' },
};

export default function DataTab() {
  const [records, setRecords] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const search = useGlobalSearch();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [receeOnly, setReceeOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [assignMember, setAssignMember] = useState('');
  const [editingCell, setEditingCell] = useState(null); // { recordId, field } | null
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(560);
  const scrollRef = useRef(null);
  const sigRef = useRef('');          // lightweight data signature, to skip no-op refreshes
  const lastLoadRef = useRef(0);      // throttle window-focus refetches
  const rafRef = useRef(0);

  // Debounce the (topbar-driven) search so a keystroke doesn't refilter 1,600
  // rows on every character.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // `silent` background refreshes don't flash the loading state, and a refresh
  // whose data is unchanged is dropped entirely so the (large) table doesn't
  // repaint for nothing.
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await getRecords({ limit: 2000, include_inactive: true });
      const rows = res.records || [];
      lastLoadRef.current = Date.now();
      const sig = `${rows.length}:${rows.reduce((m, r) => (!m || (r.updated_at || '') > m ? (r.updated_at || '') : m), '')}`;
      if (silent && sig === sigRef.current) return;
      sigRef.current = sig;
      setRecords(rows);
    } catch (e) {
      console.error('Failed to load records:', e);
      setNotice('Failed to load records');
      setTimeout(() => setNotice(''), 4000);
    }
    if (!silent) setLoading(false);
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const res = await getTeam();
      setMembers((res.members || []).filter((m) => m.is_active !== false));
    } catch (e) {
      console.error('Failed to load team:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadMembers();
    // Focus returns are common (switching windows) and each one used to refetch
    // and repaint the whole table; throttle them.
    const onFocus = () => { if (Date.now() - lastLoadRef.current > 15000) loadData(true); };
    window.addEventListener('focus', onFocus);
    const poll = setInterval(() => loadData(true), 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(poll); };
  }, [loadData, loadMembers]);

  // Measure the scroll viewport so the window size tracks the real box.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 560);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [loading]);

  // Scroll back to the top whenever the visible set changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [activeTab, debouncedSearch, receeOnly, showInactive]);

  function onScroll() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }

  // Per-record derived data, computed once per records change rather than on
  // every render/keystroke/selection. Keyed by record id.
  const metaById = useMemo(() => {
    const m = new Map();
    records.forEach((r) => {
      const d = r.data || {};
      const inactive = d.is_active === false;
      const rec = receeBadge(d.recee_status);
      const src = SOURCE_STYLE[String(d.source || 'inhouse').toLowerCase().includes('google') ? 'google' : 'inhouse'];
      m.set(r.id, { prices: normPricesOf(d), inactive, rec, src });
    });
    return m;
  }, [records]);

  // ---- Group records by catchment/tab ----
  const groups = useMemo(() => {
    const groupsMap = new Map();
    records.forEach((r) => {
      const type = r.data?.type || 'uncategorised';
      if (isJunkType(type)) return;
      if (!groupsMap.has(type)) groupsMap.set(type, []);
      groupsMap.get(type).push(r);
    });
    const list = [...groupsMap.entries()].map(([type, rows]) => {
      const activeRows = rows.filter((r) => r.data?.is_active !== false);
      const priceCols = [];
      const seen = new Set();
      activeRows.forEach((r) => {
        Object.keys(pricesOf(r.data)).forEach((k) => {
          const nk = normKey(k);
          if (!seen.has(nk)) { seen.add(nk); priceCols.push({ key: k, norm: nk }); }
        });
      });
      return { type, label: humanize(type), rows, active: activeRows.length, total: rows.length, priceCols };
    })
      .filter((g) => (showInactive ? g.total > 0 : g.active > 0))
      .sort((a, b) => b.active - a.active || a.label.localeCompare(b.label));
    return list;
  }, [records, showInactive]);

  // ---- Apply search + status filters per group, build tab data ----
  const tabsData = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const applyFilters = (rows) => rows.filter((r) => {
      const d = r.data || {};
      if (!showInactive && d.is_active === false) return false;
      if (receeOnly && !(d.needs_recee || d.recee_status === 'pending')) return false;
      if (q) {
        const hay = `${d.name || ''} ${d.apartment || ''} ${d.pin_code || ''} ${d.address || ''} ${d.sheet_id || ''} ${d.type || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const perGroup = groups.map((g) => ({ ...g, rows: applyFilters(g.rows) }));

    const allRows = perGroup.flatMap((g) => g.rows);
    const seen = new Set();
    const allPriceCols = [];
    perGroup.forEach((g) => g.priceCols.forEach((p) => {
      if (!seen.has(p.norm)) { seen.add(p.norm); allPriceCols.push(p); }
    }));

    const tabs = [
      {
        type: 'all', label: 'All', rows: allRows, priceCols: allPriceCols,
        pending: allRows.filter((r) => r.data?.recee_status === 'pending').length,
      },
      ...perGroup.map((g) => ({
        type: g.type, label: g.label, rows: g.rows, priceCols: g.priceCols,
        pending: g.rows.filter((r) => r.data?.recee_status === 'pending' && r.data?.is_active !== false).length,
      })),
    ];

    return { tabs, perGroup };
  }, [groups, debouncedSearch, receeOnly, showInactive]);

  const activeTabData = tabsData.tabs.find((t) => t.type === activeTab) || tabsData.tabs[0];
  const tableRows = activeTabData.rows;
  const allPriceCols = activeTabData.priceCols;
  const isAll = activeTabData.type === 'all';

  // ---- Windowing: render only the visible slice, with spacer rows standing in
  // for the rest so the scrollbar and scroll position stay honest. ----
  const colCount = 10 + (isAll ? 1 : 0) + allPriceCols.length;
  // Fixed layout needs explicit widths so columns don't jitter as different
  // rows pass through the window; minWidth keeps the horizontal scroll honest.
  const tableMinWidth = 30 + 44 + (isAll ? 120 : 0) + 220 + 90 + 70 + 90 + 100 + 120 + 130 + allPriceCols.length * 110 + 60;
  const totalRows = tableRows.length;
  // Clamp the scroll origin so a shrinking list can't push the window past its
  // end and strand a giant spacer row.
  const st = Math.min(scrollTop, Math.max(0, totalRows * ROW_H - viewportH));
  const winStart = Math.max(0, Math.floor(st / ROW_H) - OVERSCAN);
  const winEnd = Math.min(totalRows, Math.ceil((st + viewportH) / ROW_H) + OVERSCAN);
  const windowRows = tableRows.slice(winStart, winEnd);
  const topPad = winStart * ROW_H;
  const bottomPad = Math.max(0, (totalRows - winEnd) * ROW_H);

  // ---- Selection (stable callbacks so memoized rows don't all re-render) ----
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  function toggleAllVisible() {
    const ids = tableRows.map((r) => r.id);
    const allSel = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  }

  // ---- Inline edit (excel style) ----
  // Only which cell is open lives here; the text being typed lives in the
  // EditableCell itself, so keystrokes never re-render the table.
  const startEdit = useCallback((recordId, field) => {
    setEditingCell({ recordId, field });
  }, []);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  const commitEdit = useCallback(async (recordId, field, value) => {
    setEditingCell(null);
    setSaving(true);
    try {
      const res = await editRecord(recordId, field, value);
      setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, data: res.record.data } : r)));
      sigRef.current = ''; // force the next silent refresh to take the change
    } catch (err) {
      setNotice(err.message || 'Save failed');
      setTimeout(() => setNotice(''), 4000);
      console.error('Save failed:', err);
    }
    setSaving(false);
  }, []);

  // ---- Bulk actions ----
  async function handleAssign() {
    if (!assignMember) { setNotice('Pick a team member first'); setTimeout(() => setNotice(''), 4000); return; }
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await assignRecords(ids, Number(assignMember));
      setNotice(`Assigned ${res.assigned} location(s) to ${res.member.name}`);
      setSelected(new Set());
      setAssignMember('');
      await loadData();
      setTimeout(() => setNotice(''), 5000);
    } catch (err) {
      setNotice(err.message || 'Assign failed');
      setTimeout(() => setNotice(''), 5000);
    }
    setBusy(false);
  }

  async function handleRecee(status) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await setReceeStatus(ids, status);
      setNotice(`Marked ${res.updated} location(s) ${status.replace('_', ' ')}`);
      setSelected(new Set());
      await loadData();
      setTimeout(() => setNotice(''), 5000);
    } catch (err) {
      setNotice(err.message || 'Update failed');
      setTimeout(() => setNotice(''), 5000);
    }
    setBusy(false);
  }

  // ---- Suggested members based on selected records' area/pin vs member locations ----
  // Only the recee team can act on a location assignment, so they are the only
  // candidates offered here.
  const receeMembers = useMemo(
    () => members.filter((m) => ['recee', 'recee_manager'].includes(m.role)),
    [members],
  );

  const suggestedMembers = useMemo(() => {
    if (selected.size === 0 || receeMembers.length === 0) return [];
    const selRows = records.filter((r) => selected.has(r.id));
    const scored = receeMembers.map((m) => {
      const locs = (m.locations || '').toLowerCase();
      let score = 0;
      selRows.forEach((r) => {
        const d = r.data || {};
        const pin = String(d.pin_code || '');
        const area = pin.slice(0, 3);
        const name = String(d.name || d.apartment || '').toLowerCase();
        if (area && locs.includes(area)) score += 5;
        (locs.match(/[a-z][a-z0-9 ]{2,}/g) || []).forEach((tok) => {
          if (tok.trim().length > 3 && name.includes(tok.trim())) score += 2;
        });
      });
      return { member: m, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.member);
  }, [selected, receeMembers, records]);

  function memberOptions() {
    const sug = suggestedMembers.map((m) => m.id);
    const rest = receeMembers.filter((m) => !sug.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { sug: suggestedMembers, rest };
  }

  // ---- Export to Excel (.xls via HTML table) ----
  function exportExcel() {
    if (tableRows.length === 0) return;
    const priceKeys = allPriceCols.map((p) => p.key);
    const headers = ['S.No', 'Catchment', 'Location', 'PIN', 'Dist(km)', 'Source', 'Recee', 'Assigned', 'Edited By', ...priceKeys, 'Maps Link'];
    const bodyRows = tableRows.map((r, i) => {
      const d = r.data || {};
      const prices = pricesOf(d);
      const priceCells = priceKeys.map((k) => {
        const nk = normKey(k);
        const found = Object.entries(prices).find(([pk]) => normKey(pk) === nk);
        return found ? found[1] : '';
      });
      const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return [
        i + 1, esc(d.type || ''), esc(d.name || d.apartment || ''), esc(d.pin_code || ''), esc(d.distance_km ?? ''),
        esc(d.source || ''), esc(d.recee_status || ''), esc(d.assigned_to_name || ''), esc(d.edited_by || ''),
        ...priceCells.map(esc), esc(d.gmap_link || ''),
      ].map((c) => `<td>${c}</td>`).join('');
    });
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headers.map((h) => `<th style="background:#FFF4EC">${h}</th>`).join('')}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></body></html>`;
    const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `btlbro_${(isAll ? 'all' : activeTabData.type).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allVisibleSelected = tableRows.length > 0 && tableRows.every((r) => selected.has(r.id));
  const totalActive = records.filter((r) => r.data?.is_active !== false).length;

  const thStyle = TH_STYLE;
  const tdStyle = TD_STYLE;

  return (
    <div>
      {notice && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#FFF4EC', border: '1px solid #E7E2D8', color: '#C2410C', fontSize: 13, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ background: 'none', border: 'none', color: '#C2410C', cursor: 'pointer', fontSize: 15 }}>×</button>
        </div>
      )}

      {/* Tab bar: filter controls live behind one icon button, catchments are the tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {/* The "i"/filters button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            title="Filters, refresh & export"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 9, cursor: 'pointer',
              border: '1.5px solid #E7E2D8', background: filterOpen ? '#FFF4EC' : '#fff',
              color: filterOpen ? '#F2701D' : '#4A4A4A',
            }}
          >
            <SlidersHorizontal size={16} />
            {(receeOnly || showInactive) && <span style={{
              position: 'absolute', top: -4, right: -4, width: 9, height: 9, borderRadius: '50%', background: '#F2701D', border: '2px solid #fff',
            }} />}
          </button>
          {filterOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setFilterOpen(false)} />
              <div style={{
                position: 'absolute', top: 44, left: 0, zIndex: 30, width: 230,
                background: '#fff', borderRadius: 12, border: '1px solid #E7E2D8',
                boxShadow: '0 14px 40px rgba(17,17,17,0.14)', padding: 6, overflow: 'hidden',
              }}>
                <MenuItem
                  active={receeOnly}
                  onClick={() => setReceeOnly((v) => !v)}
                  label="Needs Recee"
                />
                <MenuItem
                  active={showInactive}
                  onClick={() => setShowInactive((v) => !v)}
                  label="Show Inactive"
                />
                {search && (
                  <MenuItem onClick={() => clearGlobalSearch()} label="Clear Search" icon={<SearchX size={15} />} />
                )}
                <div style={{ height: 1, background: '#F0EDE8', margin: '6px 8px' }} />
                <MenuItem onClick={() => { loadData(); setFilterOpen(false); }} label="Refresh Data" icon={<RefreshCw size={15} />} />
                <MenuItem onClick={() => { exportExcel(); setFilterOpen(false); }} label="Export to Excel" icon={<Download size={15} />} />
              </div>
            </>
          )}
        </div>

        {/* Catchment tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', flex: 1, scrollbarWidth: 'thin' }}>
          {tabsData.tabs.map((t) => {
            const active = activeTabData.type === t.type;
            return (
              <button
                key={t.type}
                onClick={() => setActiveTab(t.type)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
                  padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
                  border: active ? '1.5px solid #F2701D' : '1.5px solid #E7E2D8',
                  background: active ? '#FFF4EC' : '#fff',
                  color: active ? '#C2410C' : '#4A4A4A', fontWeight: active ? 700 : 600, fontSize: 12.5,
                }}
              >
                {t.type === 'all' ? <MapPin size={13} style={{ color: active ? '#F2701D' : '#949494' }} /> : null}
                {t.label}
                <span style={{ fontSize: 11, color: active ? '#F2701D' : '#949494', fontWeight: 700 }}>{t.rows.length}</span>
                {t.pending > 0 && <span title="Awaiting recee" style={{ width: 8, height: 8, borderRadius: '50%', background: '#B45309' }} />}
              </button>
            );
          })}
        </div>

        <span style={{ flexShrink: 0, fontSize: 12, color: '#949494', fontWeight: 600 }}>
          {tableRows.filter((r) => r.data?.is_active !== false).length} / {totalActive} active
        </span>
      </div>

      {/* Assign bar (appears when rows are selected) */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, flexWrap: 'wrap',
          background: '#FFF4EC', border: '1.5px solid #F2701D', marginBottom: 14, position: 'sticky', top: 8, zIndex: 20,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#C2410C', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckSquare size={15} /> {selected.size} selected
          </span>
          <select
            value={assignMember}
            onChange={(e) => setAssignMember(e.target.value)}
            disabled={receeMembers.length === 0}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #E7E2D8', fontSize: 12.5, background: '#fff', minWidth: 200 }}
          >
            <option value="">{receeMembers.length === 0 ? 'No recee team members' : 'Assign to recee…'}</option>
            {suggestedMembers.length > 0 && <optgroup label="Nearby (match by area/PIN)">{suggestedMembers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.locations ? ` · ${m.locations}` : ''}</option>)}</optgroup>}
            <optgroup label="Recee team">
              {memberOptions().rest.map((m) => <option key={m.id} value={m.id}>{m.name}{m.locations ? ` · ${m.locations}` : ''}</option>)}
            </optgroup>
          </select>
          <button onClick={handleAssign} disabled={busy || receeMembers.length === 0} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: receeMembers.length === 0 ? '#E7E2D8' : '#F2701D', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: receeMembers.length === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <UserCheck size={14} /> {busy ? 'Working…' : 'Assign'}
          </button>
          <span style={{ height: 22, width: 1, background: '#E7E2D8' }} />
          <span style={{ fontSize: 12, color: '#4A4A4A', fontWeight: 600 }}>Recee:</span>
          {[['pending', 'Pending'], ['in_progress', 'In Progress'], ['done', 'Done']].map(([val, label]) => (
            <button key={val} onClick={() => handleRecee(val)} disabled={busy} style={{
              padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E7E2D8', background: '#fff', color: '#4A4A4A', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{label}</button>
          ))}
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', padding: '8px 12px', borderRadius: 8, border: 'none', background: 'none', color: '#C2410C', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Clear ×
          </button>
        </div>
      )}

      {/* Loading / empty */}
      {loading ? (
        <div style={{ padding: 50, textAlign: 'center', color: '#949494' }}>Loading locations…</div>
      ) : tableRows.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#949494', background: '#fff', borderRadius: 14, border: '1px solid #E7E2D8' }}>
          <Inbox size={36} style={{ color: '#C7BFB2', marginBottom: 10 }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: '#161616', margin: 0 }}>No locations match</p>
          <p style={{ fontSize: 12.5, marginTop: 4 }}>Try clearing the top search or toggling the filters.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E7E2D8', overflow: 'hidden' }}>
          <div ref={scrollRef} onScroll={onScroll} style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: tableMinWidth, fontSize: 12.5, tableLayout: 'fixed' }} cellPadding="0" cellSpacing="0">
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 30 }}>
                    <button onClick={toggleAllVisible} style={{ background: 'none', border: 'none', cursor: 'pointer', color: allVisibleSelected ? '#F2701D' : '#949494', padding: 0 }}>
                      {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                  </th>
                  <th style={{ ...thStyle, width: 44 }}>#</th>
                  {isAll && <th style={{ ...thStyle, width: 120 }}>Catchment</th>}
                  <th style={thStyle}>Location</th>
                  <th style={{ ...thStyle, width: 90 }}>PIN</th>
                  <th style={{ ...thStyle, width: 70 }}>Dist</th>
                  <th style={{ ...thStyle, width: 90 }}>Source</th>
                  <th style={{ ...thStyle, width: 100 }}>Recee</th>
                  <th style={{ ...thStyle, width: 120 }}>Assigned</th>
                  <th style={{ ...thStyle, width: 130 }}>Edited</th>
                  {allPriceCols.map((p) => (
                    <th key={p.norm} style={{ ...thStyle, color: '#F2701D', width: 110 }}>{humanize(p.key)}</th>
                  ))}
                  <th style={{ ...thStyle, width: 60 }}>Maps</th>
                </tr>
              </thead>
              <tbody>
                {topPad > 0 && <tr aria-hidden="true"><td colSpan={colCount} style={{ height: topPad, padding: 0, border: 'none' }} /></tr>}
                {windowRows.map((r, i) => (
                  <DataRow
                    key={r.id}
                    row={r}
                    meta={metaById.get(r.id)}
                    index={winStart + i}
                    isAll={isAll}
                    priceCols={allPriceCols}
                    selected={selected.has(r.id)}
                    editingField={editingCell && editingCell.recordId === r.id ? editingCell.field : null}
                    saving={saving}
                    onToggleSelect={toggleSelect}
                    onStartEdit={startEdit}
                    onCommitEdit={commitEdit}
                    onCancelEdit={cancelEdit}
                    tdStyle={tdStyle}
                  />
                ))}
                {bottomPad > 0 && <tr aria-hidden="true"><td colSpan={colCount} style={{ height: bottomPad, padding: 0, border: 'none' }} /></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px',
        borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 600, color: active ? '#C2410C' : '#4A4A4A', textAlign: 'left',
      }}
    >
      <span style={{ color: active ? '#F2701D' : '#949494', display: 'inline-flex' }}>{icon || <CheckSquare size={15} />}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {active && <CheckSquare size={15} color="#F2701D" />}
    </button>
  );
}

function EditableCell({ initialValue, saving, onCommit, onCancel }) {
  const [value, setValue] = useState(initialValue ?? '');
  const ref = useRef(null);
  const doneRef = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(value);
  }
  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }
  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); }
  }
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKey}
      disabled={saving}
      style={{
        width: '100%', border: '2px solid #F2701D', borderRadius: 4,
        padding: '2px 6px', fontSize: 12.5, outline: 'none', background: '#fff',
        boxSizing: 'border-box', color: '#161616',
      }}
    />
  );
}

// One table row. Memoized, and given only primitives/stable refs, so selecting
// a row or opening a cell re-renders just that row — not the whole window.
const DataRow = React.memo(function DataRow({
  row, meta, index, isAll, priceCols, selected, editingField, saving,
  onToggleSelect, onStartEdit, onCommitEdit, onCancelEdit, tdStyle,
}) {
  const d = row.data || {};
  const inactive = meta?.inactive;
  const rec = meta?.rec || { bg: '#EFEBE4', fg: '#949494', label: '—' };
  const src = meta?.src || SOURCE_STYLE.inhouse;
  const prices = meta?.prices || {};
  const zebra = inactive ? '#F7F5F1' : (index % 2 === 0 ? '#fff' : '#FAF9F7');

  const editable = (field, display, value) => (
    editingField === field ? (
      <EditableCell initialValue={value} saving={saving} onCommit={(v) => onCommitEdit(row.id, field, v)} onCancel={onCancelEdit} />
    ) : display
  );

  return (
    <tr style={{ height: ROW_H, background: zebra, opacity: inactive ? 0.6 : 1 }}>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        <button onClick={() => onToggleSelect(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: selected ? '#F2701D' : '#949494', padding: 2 }}>
          {selected ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>
      </td>
      <td style={{ ...tdStyle, color: '#949494', fontSize: 11.5 }}>{index + 1}</td>
      {isAll && <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#F0EDE8', color: '#4A4A4A' }}>{humanize(d.type)}</span></td>}
      <td style={{ ...tdStyle, fontWeight: 650, cursor: 'pointer', color: inactive ? '#949494' : '#161616' }} onClick={() => editingField !== 'name' && onStartEdit(row.id, 'name')}>
        {editable('name', d.name || d.apartment || '—', d.name)}
      </td>
      <td style={{ ...tdStyle, cursor: 'pointer' }} onClick={() => editingField !== 'pin_code' && onStartEdit(row.id, 'pin_code')}>
        {editable('pin_code', d.pin_code || '—', d.pin_code)}
      </td>
      <td style={{ ...tdStyle, cursor: 'pointer' }} onClick={() => editingField !== 'distance_km' && onStartEdit(row.id, 'distance_km')}>
        {editable('distance_km', d.distance_km != null && d.distance_km !== '' ? `${d.distance_km} km` : '—', d.distance_km)}
      </td>
      <td style={tdStyle}>
        <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: src.bg, color: src.fg }}>{src.label}</span>
      </td>
      <td style={tdStyle}>
        <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: rec.bg, color: rec.fg }}>{rec.label}</span>
      </td>
      <td style={tdStyle} title={d.assigned_by && `Assigned by ${d.assigned_by}`}>{d.assigned_to_name || '—'}</td>
      <td style={{ ...tdStyle, fontSize: 11.5, color: '#949494' }} title={d.edited_by && `Edited by ${d.edited_by}`}>
        {d.edited_by ? `${d.edited_by}` : ''}
        {d.edited_at ? ` ${timeAgo(d.edited_at)}` : ''}
      </td>
      {priceCols.map((p) => {
        const found = prices[p.norm];
        return (
          <td key={p.norm} style={{ ...tdStyle, fontWeight: found != null ? 700 : 400, color: found != null ? '#C2410C' : '#C7BFB2' }}>
            {found != null ? fmtINR(found) : '—'}
          </td>
        );
      })}
      <td style={tdStyle}>
        {d.gmap_link ? (
          <a href={d.gmap_link} target="_blank" rel="noopener noreferrer" style={{ color: '#F2701D', display: 'inline-flex', alignItems: 'center' }}>
            <ExternalLink size={13} />
          </a>
        ) : '—'}
      </td>
    </tr>
  );
});