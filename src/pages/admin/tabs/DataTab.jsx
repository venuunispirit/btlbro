import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Download, RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { getRecords, editRecord, getDriveFiles } from '../api.js';

export default function DataTab() {
  const [records, setRecords] = useState([]);
  const [files, setFiles] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 200, total: 0, pages: 1 });
  const [search, setSearch] = useState('');
  const [filterFile, setFilterFile] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState(null); // { recordId, field }
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const loadData = useCallback(async (page = 1, searchVal = search, fileVal = filterFile) => {
    setLoading(true);
    try {
      const opts = { page, limit: 200 };
      if (searchVal) opts.search = searchVal;
      if (fileVal) opts.file = fileVal;
      const res = await getRecords(opts);
      setRecords(res.records || []);
      setPagination(res.pagination || { page: 1, limit: 200, total: 0, pages: 1 });
    } catch (e) {
      console.error('Failed to load records:', e);
    }
    setLoading(false);
  }, [search, filterFile]);

  useEffect(() => {
    async function init() {
      try {
        const res = await getDriveFiles();
        setFiles(res.files || []);
      } catch {}
      loadData(1);
    }
    init();
  }, []);

  function startEdit(recordId, field, currentValue) {
    setEditingCell({ recordId, field });
    setEditValue(currentValue ?? '');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function saveEdit() {
    if (!editingCell) return;
    setSaving(true);
    try {
      const res = await editRecord(editingCell.recordId, editingCell.field, editValue);
      setRecords(prev => prev.map(r => r.id === editingCell.recordId ? { ...r, data: res.record.data } : r));
    } catch (err) {
      console.error('Save failed:', err);
    }
    setSaving(false);
    setEditingCell(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') setEditingCell(null);
    // Tab to next cell
    if (e.key === 'Tab') {
      e.preventDefault();
      saveEdit();
    }
  }

  function handleSearch(e) {
    const val = e.target.value;
    setSearch(val);
    // Debounce
    clearTimeout(window.__dataSearchTimer);
    window.__dataSearchTimer = setTimeout(() => loadData(1, val, filterFile), 400);
  }

  function handleFilterFile(e) {
    const val = e.target.value;
    setFilterFile(val);
    loadData(1, search, val);
  }

  function handleExport() {
    if (records.length === 0) return;
    const headers = [...new Set(records.flatMap(r => Object.keys(r.data || {})))];
    const csv = [
      headers.join(','),
      ...records.map(r => headers.map(h => {
        const val = r.data?.[h] ?? '';
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'btlbro_data.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Collect all unique column names across all visible records
  const allColumns = [...new Set(records.flatMap(r => Object.keys(r.data || {})))];
  // Show key columns first
  const keyCols = ['name', 'type', 'pin_code', 'sheet_id', 'lat', 'lng'];
  const sortedCols = [...keyCols.filter(c => allColumns.includes(c)), ...allColumns.filter(c => !keyCols.includes(c))];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
          <input
            value={search}
            onChange={handleSearch}
            placeholder="Search records…"
            style={{
              width: '100%', padding: '9px 12px 9px 36px', borderRadius: 8,
              border: '1.5px solid #E0E0E0', fontSize: 13, boxSizing: 'border-box',
            }}
          />
        </div>
        <select value={filterFile} onChange={handleFilterFile} style={{
          padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, minWidth: 180,
        }}>
          <option value="">All Files</option>
          {files.map(f => (
            <option key={f.id} value={f.id}>{f.file_name} ({f.records_count})</option>
          ))}
        </select>
        <button onClick={() => loadData(pagination.page)} style={{
          padding: '9px 14px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff',
          fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
        }}><RefreshCw size={14} /> Refresh</button>
        <button onClick={handleExport} style={{
          padding: '9px 14px', borderRadius: 8, border: 'none', background: '#111',
          color: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
        }}><Download size={14} /> Export CSV</button>
        <span style={{ fontSize: 12, color: '#888' }}>{pagination.total} records</span>
      </div>

      {/* Spreadsheet */}
      <div style={{
        background: '#fff', borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E8E8E8',
      }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F8F8F8', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={thStyle}>#</th>
                {sortedCols.map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={sortedCols.length + 1} style={{ padding: 30, textAlign: 'center', color: '#999' }}>Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={sortedCols.length + 1} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No records found</td></tr>
              ) : (
                records.map((r, ri) => (
                  <tr key={r.id} style={{ background: ri % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                    <td style={tdStyleNum}>{ri + 1 + (pagination.page - 1) * pagination.limit}</td>
                    {sortedCols.map(col => {
                      const isEditing = editingCell?.recordId === r.id && editingCell?.field === col;
                      const val = r.data?.[col] ?? '';
                      return (
                        <td
                          key={col}
                          style={{
                            ...tdStyle,
                            background: isEditing ? '#FFF7ED' : 'transparent',
                            cursor: 'pointer',
                            maxWidth: 200,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          onClick={() => !isEditing && startEdit(r.id, col, val)}
                          title={String(val)}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={saveEdit}
                              onKeyDown={handleKeyDown}
                              disabled={saving}
                              style={{
                                width: '100%', border: '2px solid #F2701D', borderRadius: 3,
                                padding: '2px 6px', fontSize: 13, outline: 'none', background: '#fff',
                                boxSizing: 'border-box',
                              }}
                            />
                          ) : (
                            <span style={{
                              color: typeof val === 'number' ? '#2563EB' : '#111',
                              fontWeight: col === 'name' ? 600 : 400,
                            }}>{String(val)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button
            onClick={() => loadData(pagination.page - 1)}
            disabled={pagination.page <= 1}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', cursor: 'pointer', opacity: pagination.page <= 1 ? 0.4 : 1 }}
          ><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 13, color: '#666' }}>Page {pagination.page} of {pagination.pages}</span>
          <button
            onClick={() => loadData(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', cursor: 'pointer', opacity: pagination.page >= pagination.pages ? 0.4 : 1 }}
          ><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.6, color: '#888',
  borderBottom: '1px solid #E8E8E8', whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '8px 12px', borderBottom: '1px solid #F0F0F0',
  fontSize: 13, color: '#333',
};

const tdStyleNum = {
  ...tdStyle, color: '#AAA', fontSize: 12, width: 40, textAlign: 'center',
};
