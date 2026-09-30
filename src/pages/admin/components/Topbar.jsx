import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, X, Check, ArrowDownLeft, ArrowUpRight, FileText, Package, Loader2 } from 'lucide-react';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../api.js';
import { useGlobalSearch, setGlobalSearch } from '../useGlobalSearch.js';

// An icon per event type, so the feed is scannable without reading every line.
const KIND = {
  payment_success: { Icon: ArrowDownLeft, color: '#059669', bg: '#ECFDF5' },
  payment_failed: { Icon: ArrowUpRight, color: '#B91C1C', bg: '#FEF2F2' },
  lead_created: { Icon: FileText, color: '#2563EB', bg: '#EFF6FF' },
  order_created: { Icon: Package, color: '#6D28D9', bg: '#F1E9FD' },
  bill_submitted: { Icon: FileText, color: '#B45309', bg: '#FEF3C7' },
};

function NotificationRow({ n, onOpen }) {
  const kind = KIND[n.type] || { Icon: Bell, color: '#4A4A4A', bg: '#F3F0EA' };
  const { Icon } = kind;
  return (
    <button
      style={{ ...styles.row, ...(n.read ? null : styles.rowUnread) }}
      onClick={async () => {
        if (!n.read) {
          // Optimistic: the dot clears immediately, the request follows.
          n.read = true;
          try { await markNotificationRead(n.id); } catch { /* reload will correct it */ }
        }
        if (n.target) onOpen(n.target.tab);
      }}
    >
      <span style={{ ...styles.rowIcon, background: kind.bg, color: kind.color }}>
        <Icon size={14} />
      </span>
      <span style={styles.rowText}>
        <span style={styles.rowTitle}>{n.title}</span>
        <span style={styles.rowBody}>{n.body}</span>
        <span style={styles.rowMeta}>
          {fmtWhen(n.created_at)}
          {n.target ? ` · ${n.target.label}` : ''}
          {n.read ? '' : ' · new'}
        </span>
      </span>
      {!n.read && <span style={styles.rowDot} />}
    </button>
  );
}

function fmtWhen(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return then.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function Topbar({ staff, activeLabel, subtitle, onNavigate }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef(null);
  const search = useGlobalSearch();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [panel, setPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus();
  }, [searchOpen]);

  // Poll rather than subscribe. There is no socket in this app, and a payment
  // landing is the one event where a 30s-old bell is worse than none.
  useEffect(() => {
    let alive = true;
    const load = async (showSpinner) => {
      if (showSpinner) setLoading(true);
      try {
        const data = await getNotifications();
        if (!alive) return;
        setItems(data.notifications || []);
        setUnread(data.unread || 0);
      } catch { /* a failed poll must not break the topbar */ }
      finally { if (alive && showSpinner) setLoading(false); }
    };
    load(true);
    const t = setInterval(() => load(false), 30000);
    const onFocus = () => load(false);
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);

  // Re-read when the panel opens so a click-through cannot show a stale list.
  useEffect(() => { if (panel) getNotifications().then((d) => { setItems(d.notifications || []); setUnread(d.unread || 0); }).catch(() => {}); }, [panel]);

  async function markAllRead() {
    setBusy(true);
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try { await markAllNotificationsRead(); } catch { /* poll will correct */ }
    finally { setBusy(false); }
  }

  return (
    <header style={styles.topbar}>
      {/* Col 1 — Page heading. The optional subtitle sits under the name so
          tabs can orient the page without spending a row of their own. */}
      <div style={styles.pageHeading}>
        <h1 style={styles.pageTitle}>{activeLabel || 'Dashboard'}</h1>
        {subtitle && <p style={styles.pageSubtitle}>{subtitle}</p>}
      </div>

      {/* Col 2 — Search pill + Notification (centred) */}
      <div style={styles.actionsCenter}>
        <div
          style={{
            ...styles.searchWrap,
            width: searchOpen ? 240 : 110,
            cursor: searchOpen ? 'text' : 'pointer',
            // The background stays white when open. Tinting it peach on focus
            // made a small white control read as a filled block, and the pill
            // is already unmistakable from its border and ring.
            borderColor: searchOpen ? '#F2701D' : '#E7E2D8',
            boxShadow: searchOpen ? '0 0 0 3px rgba(242,112,29,0.12)' : 'none',
          }}
          onClick={() => { if (!searchOpen) setSearchOpen(true); }}
        >
          <Search size={15} style={{ flexShrink: 0, color: searchOpen ? '#F2701D' : '#949494', transition: 'color .2s' }} />
          {searchOpen ? (
            <input
              ref={inputRef}
              className="bare-input"
              style={styles.searchInput}
              placeholder={`Search ${String(activeLabel || '').toLowerCase()}…`}
              value={search}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSearchOpen(false); }}
              onBlur={() => setSearchOpen(false)}
            />
          ) : (
            <span style={styles.searchLabel}>{search || 'Search'}</span>
          )}
          {searchOpen && (
            <button
              style={styles.clearBtn}
              onMouseDown={(e) => { e.preventDefault(); setGlobalSearch(''); inputRef.current?.focus(); }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Col 3 — notifications, pinned to the far right so the search pill can
          sit truly centred instead of being pushed off-axis by the bell. */}
      <div style={styles.actionsRight}>
        <button
          style={{ ...styles.iconBtn, position: 'relative' }}
          onClick={() => setPanel((p) => !p)}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell size={18} />
          {unread > 0 && (
            <span style={styles.badge}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>

        {/* Hangs off the bell itself, so it stays glued to the button no
            matter how tall the heading (title + subtitle) makes the bar. */}
        {panel && (
          <div style={styles.panel}>
            <div style={styles.panelHead}>
              <span style={styles.panelTitle}>Notifications</span>
              {unread > 0 && (
                <button style={styles.markAll} onClick={markAllRead} disabled={busy}>
                  <Check size={12} /> Mark all read
                </button>
              )}
            </div>

            <div style={styles.panelBody}>
              {loading && <div style={styles.state}><Loader2 size={15} className="spin" /> Loading…</div>}
              {!loading && items.length === 0 && (
                <div style={styles.state}>
                  <Bell size={20} color="#C9C2B4" />
                  <div style={{ marginTop: 6 }}>Nothing to report yet.</div>
                  <div style={styles.stateHint}>
                    New leads, new orders and every payment that settles will show up here.
                  </div>
                </div>
              )}
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={(tab) => { onNavigate?.(tab); setPanel(false); }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {panel && <div style={styles.backdrop} onClick={() => setPanel(false)} />}
    </header>
  );
}

// Admin layer scale, so ordering is decided here rather than by whichever
// file happens to use the biggest number:
//
//   9998–9999   tab modals (Team, Leads, Departments, MemberForm, SiteSurveys)
//   10000       toast stack
//   10001       feedback scrim
//   10002       Accounts collect dialog
//   10100+      the notification feed — the top of the scale on purpose.
//               Nothing in the admin is allowed to cover the bell or its
//               panel, so these two must sit above whatever is added next.
const Z_BACKDROP = 10100;
const Z_PANEL = 10101;

const styles = {
  topbar: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    padding: '18px 26px',
    background: 'transparent',
  },
  pageHeading: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  // Capped so a long line wraps inside the left column instead of running
  // under the centred search pill.
  pageSubtitle: {
    fontSize: 12.5,
    color: '#949494',
    margin: 0,
    lineHeight: 1.45,
    maxWidth: 460,
  },
  // Right-hand column. The bell lives here rather than beside the search so the
  // search pill can be centred on the true middle of the bar. Both are pinned
  // to the vertical centre instead of a fixed offset, so a two-line heading
  // (title + subtitle) doesn't leave them clinging to the top edge.
  actionsRight: {
    position: 'absolute',
    right: 26,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    position: 'absolute', top: -4, right: -5,
    minWidth: 17, height: 17, padding: '0 4px',
    borderRadius: 999, background: '#F2701D', color: '#fff',
    fontSize: 10, fontWeight: 700, lineHeight: '17px', textAlign: 'center',
    border: '2px solid #FAF9F7', boxSizing: 'content-box',
  },
  backdrop: { position: 'fixed', inset: 0, zIndex: Z_BACKDROP },
  // `top: 100%` drops the panel just below the bell wrapper, which is itself
  // vertically centred in the bar — so it follows the button rather than a
  // hard-coded offset that breaks when a subtitle makes the bar taller.
  panel: {
    position: 'absolute', right: 0, top: 'calc(100% + 10px)', zIndex: Z_PANEL,
    width: 400, maxWidth: '92vw',
    background: '#fff', border: '1px solid #E7E2D8', borderRadius: 12,
    boxShadow: '0 18px 50px rgba(0,0,0,0.16)', overflow: 'hidden',
  },
  panelHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '12px 14px', borderBottom: '1px solid #E7E2D8', background: '#FAF9F7',
  },
  panelTitle: { fontSize: 13, fontWeight: 700, color: '#161616' },
  markAll: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none',
    border: 'none', padding: 0, cursor: 'pointer', color: '#F2701D',
    fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
  },
  panelBody: { maxHeight: 420, overflowY: 'auto' },
  state: { padding: '28px 20px', textAlign: 'center', color: '#949494', fontSize: 12.5, lineHeight: 1.5 },
  stateHint: { marginTop: 4, fontSize: 11.5, color: '#B0A99C' },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
    padding: '11px 14px', background: 'none', border: 'none',
    borderBottom: '1px solid #F1EDE4', textAlign: 'left', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rowUnread: { background: '#FFFBF7' },
  rowIcon: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  rowTitle: { fontSize: 12.5, fontWeight: 650, color: '#161616' },
  rowBody: { fontSize: 11.5, color: '#4A4A4A', lineHeight: 1.45 },
  rowMeta: { fontSize: 10.5, color: '#949494' },
  rowDot: { width: 7, height: 7, borderRadius: 999, background: '#F2701D', marginTop: 6, flexShrink: 0 },
  actionsCenter: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 14px',
    borderRadius: 999,
    border: '1.5px solid #E7E2D8',
    background: '#fff',
    cursor: 'text',
    transition: 'width 0.25s ease, border-color 0.2s, background 0.2s, box-shadow 0.2s',
    overflow: 'hidden',
  },
  searchLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: '#949494',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: '#161616',
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: 'none',
    background: '#F1EDE4',
    color: '#4A4A4A',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    border: '1.5px solid #E7E2D8',
    background: '#fff',
    color: '#4A4A4A',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
};
