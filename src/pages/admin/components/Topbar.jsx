import React, { useState } from 'react';
import { Search, Bell } from 'lucide-react';

const ROLES = {
  member: { label: 'Member', color: '#F2701D' },
  manager: { label: 'Manager', color: '#8A2BE2' },
  super_admin: { label: 'Super Admin', color: '#111' },
};

export default function Topbar({ staff, activeLabel }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const role = staff?.role || 'member';
  const roleMeta = ROLES[role] || ROLES.member;

  return (
    <header style={styles.topbar}>
      <div style={styles.titleRow}>
        <h1 style={styles.pageTitle}>{activeLabel || 'Dashboard'}</h1>
        <div style={styles.badgeRow}>
          <span style={{ ...styles.roleBadge, background: roleMeta.color }}>{roleMeta.label}</span>
        </div>
      </div>
      <div style={styles.topActions}>
        {searchOpen && (
          <input autoFocus style={styles.topSearch} placeholder="Search…"
            onBlur={() => setSearchOpen(false)} />
        )}
        <button style={styles.iconBtn} onClick={() => setSearchOpen((v) => !v)}>
          <Search size={18} />
        </button>
        <button style={styles.iconBtn}>
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}

const styles = {
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 26px', background: '#fff', borderBottom: '1px solid #EAEAEA',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  pageTitle: { fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' },
  badgeRow: { display: 'flex', gap: 8 },
  roleBadge: {
    fontSize: 11, fontWeight: 700, color: '#fff', padding: '4px 10px',
    borderRadius: 999, textTransform: 'capitalize',
  },
  topActions: { display: 'flex', alignItems: 'center', gap: 8 },
  topSearch: {
    height: 34, borderRadius: 9, border: '1.5px solid #DDD',
    padding: '0 12px', fontSize: 13, width: 200, outline: 'none',
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 9, border: '1.5px solid #ECECEC',
    background: '#fff', color: '#555',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
};
