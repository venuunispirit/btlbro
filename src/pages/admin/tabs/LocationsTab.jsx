import React, { useState, useEffect } from 'react';
import { MapPin, RefreshCw, Filter, ExternalLink } from 'lucide-react';
import { getRecords, getDriveFiles } from '../api.js';

export default function LocationsTab() {
  const [records, setRecords] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterFile, setFilterFile] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [recRes, fileRes] = await Promise.allSettled([getRecords({ limit: 500 }), getDriveFiles()]);
      setRecords(recRes.status === 'fulfilled' ? recRes.value.records || [] : []);
      setFiles(fileRes.status === 'fulfilled' ? fileRes.value.files || [] : []);
    } catch {}
    setLoading(false);
  }

  // Extract unique types
  const types = [...new Set(records.map(r => r.data?.type).filter(Boolean))].sort();

  const filtered = records.filter(r => {
    if (filterType && r.data?.type !== filterType) return false;
    return true;
  });

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, minWidth: 160 }}>
          <option value="">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterFile} onChange={e => setFilterFile(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0', fontSize: 13, minWidth: 180 }}>
          <option value="">All Files</option>
          {files.map(f => <option key={f.id} value={f.id}>{f.file_name}</option>)}
        </select>
        <button onClick={load} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #E0E0E0', background: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={14} /> Refresh
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>{filtered.length} locations</span>
      </div>

      {/* Location cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading locations…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#999' }}>
          <MapPin size={40} style={{ color: '#DDD', marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600 }}>No locations found</p>
          <p style={{ fontSize: 13 }}>Sync from Google Sheet to import locations</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {filtered.map(r => {
            const d = r.data || {};
            return (
              <div key={r.id} style={{
                background: '#fff', borderRadius: 12, padding: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid #F0F0F0',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <MapPin size={16} style={{ color: '#F2701D', marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{d.name || 'Unnamed'}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{d.type || 'Unknown type'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#666' }}>
                  {d.lat && d.lng && <span>📍 {Number(d.lat).toFixed(4)}, {Number(d.lng).toFixed(4)}</span>}
                  {d.pin_code && <span>📮 {d.pin_code}</span>}
                  {d.distance_km && <span>📏 {d.distance_km}km</span>}
                </div>
                {d.services && Object.keys(d.services).length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {Object.entries(d.services).map(([k, v]) => (
                      <span key={k} style={{ padding: '2px 8px', borderRadius: 999, background: '#F5F5F5', fontSize: 11 }}>
                        {k}: ₹{v}
                      </span>
                    ))}
                  </div>
                )}
                {d.gmap_link && (
                  <a href={d.gmap_link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, color: '#F2701D', textDecoration: 'none' }}>
                    View on Maps <ExternalLink size={11} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
