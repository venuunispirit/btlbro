import React, { useState, useEffect, useCallback } from "react";
import {
  FileSpreadsheet,
  Link,
  RefreshCw,
  Download,
  Eye,
  CheckCircle,
  AlertTriangle,
  Clock,
  Server,
  Database,
  Zap,
  Settings,
  ToggleLeft,
  ToggleRight,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Cloud,
  CloudOff,
  Search,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

const API_BASE = "/api/admin/google-drive";
const SYNC_API = "/api/admin";

const GoogleDriveTab = () => {
  // Connection state
  const [driveUrl, setDriveUrl] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [preview, setPreview] = useState(null);

  // Files state
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileRecords, setFileRecords] = useState([]);
  const [filePagination, setFilePagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [fileSearch, setFileSearch] = useState("");

  // Sync history
  const [syncHistory, setSyncHistory] = useState([]);

  // Settings
  const [autoSync, setAutoSync] = useState(false);
  const [syncFrequency, setSyncFrequency] = useState("15");

  // Sheet sync status
  const [sheetStatus, setSheetStatus] = useState(null);

  // Sheet backfill (two-way sync: customer selections → Google Sheet)
  const [backfill, setBackfill] = useState(null);
  const [flushing, setFlushing] = useState(false);

  const fetchBackfill = useCallback(async () => {
    try {
      const res = await fetch(`${SYNC_API}/sheet-backfill`);
      const data = await res.json();
      setBackfill(data);
    } catch (err) { /* backfill optional */ }
  }, []);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      const data = await res.json();
      setStatus(data);
      setAutoSync(data.autoSyncEnabled);
      setSyncFrequency(data.syncFrequency);
      if (data.driveUrl) setDriveUrl(data.driveUrl);
    } catch (err) {
      console.error("Failed to fetch status:", err);
    }
    try {
      const res = await fetch(`${SYNC_API}/sheet-sync/status`);
      const data = await res.json();
      setSheetStatus(data);
    } catch (err) { /* sheet status optional */ }
  }, []);

  // Fetch files
  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err) {
      console.error("Failed to fetch files:", err);
    }
  }, []);

  // Fetch sync history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sync-history`);
      const data = await res.json();
      setSyncHistory(data.history || []);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  }, []);

  // Fetch file records
  const fetchFileData = useCallback(async (fileDbId, page = 1, search = "") => {
    try {
      const res = await fetch(`${API_BASE}/data/${fileDbId}?page=${page}&limit=50&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      setFileRecords(data.records || []);
      setFilePagination(data.pagination);
      setSelectedFile(data.file);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    }
  }, []);

  // Load all data on mount
  useEffect(() => {
    fetchStatus();
    fetchFiles();
    fetchHistory();
    fetchBackfill();
  }, [fetchStatus, fetchFiles, fetchHistory, fetchBackfill]);

  // Push queued selections to the Google Sheet now
  const handleFlushBackfill = async () => {
    setFlushing(true);
    try {
      const res = await fetch(`${SYNC_API}/sheet-backfill/flush`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(
          !data.configured
            ? { type: "error", text: "Webhook not configured yet — set SHEET_BACKFILL_WEBHOOK_URL in server/.env (see server/apps-script/SheetBackfill.gs). Rows stay queued; export CSV below." }
            : data.pushed > 0
              ? { type: "success", text: `Pushed ${data.pushed} row(s) to the Google Sheet${data.failed ? `, ${data.failed} failed` : ""}.` }
              : { type: "success", text: "Nothing pending — queue is empty." }
        );
      } else {
        setMessage({ type: "error", text: data.error || "Flush failed" });
      }
      fetchBackfill();
    } catch (err) {
      setMessage({ type: "error", text: "Could not reach the API server" });
    }
    setFlushing(false);
  };

  // Connect to Drive
  const handleConnect = async () => {
    if (!driveUrl.trim()) {
      setMessage({ type: "error", text: "Please enter a Google Drive URL" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: driveUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Connected successfully!" });
        fetchStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Connection failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Server not running. Start the backend server first." });
    }
    setLoading(false);
  };

  // Sync now (with confirmation per production-safety requirement)
  const handleSync = async () => {
    if (!window.confirm("Are you sure you want to synchronize the database with the Google Sheet?")) return;
    setSyncing(true);
    setMessage(null);
    setSyncResult(null);
    try {
      const res = await fetch(`${SYNC_API}/sync-google-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "manual" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSyncResult(data);
        setMessage({ type: "success", text: `Database synchronized successfully — Added: ${data.added}, Updated: ${data.updated}, Unchanged: ${data.unchanged}, Deactivated: ${data.deactivated}` });
        fetchStatus();
        fetchFiles();
        fetchHistory();
      } else if (data.validationErrors && data.validationErrors.length > 0) {
        setMessage({ type: "error", text: `Sheet has ${data.validationErrors.length} validation error(s). Database NOT changed. First: ${data.validationErrors[0]}` });
        setSyncResult({ validationErrors: data.validationErrors, warnings: data.warnings });
      } else {
        setMessage({ type: "error", text: data.error || "Sync failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Sync failed. Check server connection." });
    }
    setSyncing(false);
  };

  // Preview changes (dry-run — never writes)
  const handlePreview = async () => {
    setPreviewing(true);
    setMessage(null);
    setPreview(null);
    try {
      const res = await fetch(`${SYNC_API}/preview-google-sheet-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPreview(data);
      } else if (data.validationErrors && data.validationErrors.length > 0) {
        setMessage({ type: "error", text: `Sheet has ${data.validationErrors.length} validation error(s): ${data.validationErrors.slice(0, 3).join("; ")}` });
      } else {
        setMessage({ type: "error", text: data.error || "Preview failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Preview failed. Check server connection." });
    }
    setPreviewing(false);
  };

  // Update settings
  const updateSettings = async () => {
    try {
      await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSyncEnabled: autoSync, syncFrequency }),
      });
      setMessage({ type: "success", text: "Settings saved!" });
      fetchStatus();
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save settings" });
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect from Google Drive? All synced data will be removed.")) return;
    try {
      await fetch(`${API_BASE}/disconnect`, { method: "DELETE" });
      setFiles([]);
      setSelectedFile(null);
      setFileRecords([]);
      setDriveUrl("");
      setMessage({ type: "success", text: "Disconnected from Google Drive" });
      fetchStatus();
    } catch (err) {
      setMessage({ type: "error", text: "Failed to disconnect" });
    }
  };

  // View file data
  const handleViewFile = (file) => {
    fetchFileData(file.id, 1, "");
    setFileSearch("");
  };

  // Search within file data
  const handleFileSearch = (search) => {
    setFileSearch(search);
    if (selectedFile) {
      fetchFileData(selectedFile.id, 1, search);
    }
  };

  // Pagination
  const handlePage = (page) => {
    if (selectedFile) {
      fetchFileData(selectedFile.id, page, fileSearch);
    }
  };

  // Export file data as CSV
  const exportFileData = () => {
    if (!fileRecords.length) return;
    const headers = Object.keys(fileRecords[0]).filter((k) => k !== "id" && k !== "row");
    const rows = fileRecords.map((r) => headers.map((h) => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedFile?.file_name || "data"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Format file size
  function formatSize(bytes) {
    if (!bytes || bytes === 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  // Time ago
  function timeAgo(dateStr) {
    if (!dateStr) return "Never";
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const inputStyle = {
    padding: "11px 14px",
    border: "1.5px solid #E7E2D8",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
    fontFamily: "'Inter', sans-serif",
    color: "#161616",
    background: "#FAF9F7",
    width: "100%",
  };

  const btnPrimary = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 20px",
    background: "#F2701D",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  };

  const btnSecondary = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 20px",
    background: "#fff",
    color: "#4A4A4A",
    border: "1.5px solid #E7E2D8",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  };

  const cardStyle = {
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #E7E2D8",
    padding: 24,
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* ===== GOOGLE SHEET SYNC (master source of truth) ===== */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(242,112,29,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileSpreadsheet size={22} color="#F2701D" />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#161616" }}>Google Sheet Sync</h3>
            <p style={{ fontSize: 12, color: "#949494", marginTop: 2 }}>The Google Sheet is the master source — sync overwrites matching database records by ID</p>
          </div>
        </div>

        {/* Status row */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: sheetStatus?.connected ? "#dcfce7" : "#fef2f2", borderRadius: 8, fontSize: 13, fontWeight: 600, color: sheetStatus?.connected ? "#16a34a" : "#dc2626" }}>
            {sheetStatus?.connected ? <Cloud size={16} /> : <CloudOff size={16} />}
            {sheetStatus?.connected ? "🟢 Connected" : "Not configured"}
            {sheetStatus?.source === "env" ? " (env)" : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAF9F7", borderRadius: 8, fontSize: 13, color: "#4A4A4A" }}>
            <Clock size={14} color="#F2701D" />
            Last sync: <strong>{sheetStatus?.lastSyncAt ? formatDate(sheetStatus.lastSyncAt) : "Never"}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAF9F7", borderRadius: 8, fontSize: 13, color: "#4A4A4A" }}>
            <Database size={14} color="#F2701D" />
            <span><strong>{sheetStatus?.records ?? 0}</strong> Records</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={handlePreview} disabled={previewing || syncing || !sheetStatus?.connected} style={{ ...btnSecondary, opacity: previewing || !sheetStatus?.connected ? 0.6 : 1 }}>
            {previewing ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            Preview Changes
          </button>
          <button onClick={handleSync} disabled={syncing || previewing || !sheetStatus?.connected} style={{ ...btnPrimary, opacity: syncing || !sheetStatus?.connected ? 0.6 : 1 }}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? "Syncing Google Sheet..." : "Sync Google Sheet"}
          </button>
        </div>

        {/* Preview panel */}
        {preview && (
          <div style={{ marginTop: 16, padding: 16, border: "1px solid #E7E2D8", borderRadius: 10, background: "#FAF9F7" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161616", marginBottom: 10 }}>
              Changes detected:
            </div>
            <div style={{ display: "grid", gap: 6, fontSize: 13, color: "#4A4A4A" }}>
              <span>➕ {preview.added} new café{preview.added === 1 ? "" : "s"}</span>
              <span>✏️ {preview.updated} updated café{preview.updated === 1 ? "" : "s"}</span>
              <span>➖ {preview.deactivated} removed café{preview.deactivated === 1 ? "" : "s"} (deactivated)</span>
              <span>✅ {preview.unchanged} unchanged</span>
            </div>
            {preview.changes && preview.changes.updated.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 200, overflowY: "auto", borderTop: "1px solid #E7E2D8", paddingTop: 10 }}>
                {preview.changes.updated.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#656565", marginBottom: 6 }}>
                    <strong style={{ color: "#161616" }}>{u.name}</strong> ({u.sheet_id}):{" "}
                    {u.fields.map((f, j) => (
                      <span key={j}>
                        {f.field.replace(/_/g, " ")} <strong style={{ color: "#dc2626" }}>{String(f.from ?? "—")}</strong> → <strong style={{ color: "#16a34a" }}>{String(f.to)}</strong>{j < u.fields.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {preview.changes && preview.changes.added.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#656565" }}>
                <strong style={{ color: "#16a34a" }}>New:</strong> {preview.changes.added.map((a) => a.name).join(", ")}
              </div>
            )}
            {preview.changes && preview.changes.deactivated.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#656565" }}>
                <strong style={{ color: "#dc2626" }}>Deactivates:</strong> {preview.changes.deactivated.map((d) => d.name).join(", ")}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setPreview(null)} style={btnSecondary}>Cancel</button>
              <button onClick={handleSync} disabled={syncing} style={{ ...btnPrimary, opacity: syncing ? 0.6 : 1 }}>
                {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Sync Now
              </button>
            </div>
          </div>
        )}

        {/* Sync result panel */}
        {syncResult && !syncResult.validationErrors && (
          <div style={{ marginTop: 16, padding: "14px 16px", border: "1px solid #bbf7d0", borderRadius: 10, background: "#f0fdf4", fontSize: 13, color: "#166534" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>✅ Sync completed successfully</div>
            <div>Added: {syncResult.added} · Updated: {syncResult.updated} · Unchanged: {syncResult.unchanged} · Deleted/Deactivated: {syncResult.deactivated} · Errors: 0</div>
            {syncResult.warnings && syncResult.warnings.length > 0 && (
              <div style={{ marginTop: 6, color: "#d97706" }}>⚠ {syncResult.warnings.length} warning(s): {syncResult.warnings.slice(0, 3).join("; ")}</div>
            )}
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Last Sync: {formatDate(syncResult.lastSync)}</div>
          </div>
        )}

        {/* Validation errors panel */}
        {syncResult && syncResult.validationErrors && syncResult.validationErrors.length > 0 && (
          <div style={{ marginTop: 16, padding: "14px 16px", border: "1px solid #fecaca", borderRadius: 10, background: "#fef2f2", fontSize: 13, color: "#991b1b" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Validation failed — database was NOT modified</div>
            {syncResult.validationErrors.map((e, i) => (
              <div key={i} style={{ fontSize: 12, marginTop: 2 }}>• {e}</div>
            ))}
          </div>
        )}
      </div>

      {/* ===== NOTIFICATION MESSAGE ===== */}
      {message && (
        <div style={{
          padding: "14px 20px",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: message.type === "success" ? "#dcfce7" : "#fef2f2",
          border: `1px solid ${message.type === "success" ? "#bbf7d0" : "#fecaca"}`,
          color: message.type === "success" ? "#166534" : "#991b1b",
          fontSize: 13,
          fontWeight: 500,
        }}>
          {message.type === "success" ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          {message.text}
          <button onClick={() => setMessage(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* ===== CONNECTION SETTINGS ===== */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(242,112,29,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Cloud size={22} color="#F2701D" />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#161616" }}>Google Drive Integration</h3>
            <p style={{ fontSize: 12, color: "#949494", marginTop: 2 }}>Connect your Google Drive to sync files and data</p>
          </div>
        </div>

        {/* Status Bar */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: status?.connected ? "#dcfce7" : "#fef2f2", borderRadius: 8, fontSize: 13, fontWeight: 600, color: status?.connected ? "#16a34a" : "#dc2626" }}>
            {status?.connected ? <Cloud size={16} /> : <CloudOff size={16} />}
            Status: {status?.connected ? "Connected" : "Not Connected"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAF9F7", borderRadius: 8, fontSize: 13, color: "#4A4A4A" }}>
            <FileSpreadsheet size={14} color="#F2701D" />
            <span><strong>{status?.filesFound || 0}</strong> Files</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAF9F7", borderRadius: 8, fontSize: 13, color: "#4A4A4A" }}>
            <Database size={14} color="#F2701D" />
            <span><strong>{status?.recordsImported || 0}</strong> Records</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#FAF9F7", borderRadius: 8, fontSize: 13, color: "#4A4A4A" }}>
            <Clock size={14} color="#F2701D" />
            <span>Last sync: <strong>{timeAgo(status?.lastSyncAt)}</strong></span>
          </div>
        </div>

        {/* URL Input */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Link size={16} color="#949494" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="text"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="Paste Google Drive folder/file link here..."
              style={{ ...inputStyle, paddingLeft: 38 }}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
          </div>
          <button onClick={handleConnect} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
            Connect Drive
          </button>
          <button onClick={handleSync} disabled={syncing || !status?.connected} style={{ ...btnPrimary, background: status?.connected ? "#16a34a" : "#949494", opacity: (syncing || !status?.connected) ? 0.6 : 1 }}>
            {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Sync Now
          </button>
          {status?.connected && (
            <button onClick={handleDisconnect} style={{ ...btnSecondary, color: "#dc2626", borderColor: "#fecaca" }}>
              <CloudOff size={16} />
              Disconnect
            </button>
          )}
        </div>

        {/* Auto Sync Settings */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", background: "#FAF9F7", borderRadius: 10, border: "1px solid #E7E2D8", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={16} color="#F2701D" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#4A4A4A" }}>Auto Sync</span>
          </div>
          <button
            onClick={() => { setAutoSync(!autoSync); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: autoSync ? "#16a34a" : "#949494" }}
          >
            {autoSync ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
          </button>
          <select
            value={syncFrequency}
            onChange={(e) => setSyncFrequency(e.target.value)}
            style={{ ...inputStyle, width: "auto", padding: "8px 12px", fontSize: 13 }}
          >
            <option value="5">Every 5 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60">Every hour</option>
            <option value="1440">Every day</option>
          </select>
          <button onClick={updateSettings} style={{ ...btnPrimary, padding: "8px 16px", fontSize: 12 }}>
            <Settings size={14} /> Save Settings
          </button>
          <span style={{ fontSize: 12, color: "#949494" }}>
            {autoSync ? `Auto-syncing every ${syncFrequency < 60 ? syncFrequency + " min" : syncFrequency === 60 ? "1 hour" : "1 day"}` : "Auto sync is off"}
          </span>
        </div>
      </div>

      {/* ===== SYNCED FILES TABLE ===== */}
      {files.length > 0 && !selectedFile && (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E7E2D8", background: "#FAF9F7" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#161616" }}>📁 Synced Files ({files.length})</h3>
            <span style={{ fontSize: 12, color: "#949494" }}>Click View to see file data</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["File Name", "File Type", "Size", "Records", "Last Updated", "Status", "Action"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#949494", borderBottom: "1px solid #E7E2D8" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} style={{ borderBottom: "1px solid #F0EDE8" }}>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <FileSpreadsheet size={16} color="#F2701D" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#161616" }}>{file.file_name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ padding: "3px 10px", background: "#F5F0EA", borderRadius: 6, fontSize: 12, fontWeight: 500, color: "#656565" }}>{file.file_type}</span>
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: 13, color: "#656565" }}>{formatSize(file.file_size)}</td>
                  <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 600, color: file.records_count > 0 ? "#161616" : "#949494" }}>{file.records_count > 0 ? file.records_count.toLocaleString() : "—"}</td>
                  <td style={{ padding: "14px 16px", fontSize: 13, color: "#656565" }}>{timeAgo(file.last_modified)}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ padding: "3px 10px", background: file.status === "synced" ? "#dcfce7" : "#fef3c7", color: file.status === "synced" ? "#16a34a" : "#d97706", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                      {file.status === "synced" ? "✓ Synced" : file.status}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <button onClick={() => handleViewFile(file)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", border: "1px solid #E7E2D8", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#F2701D" }}>
                      <Eye size={14} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== FILE DATA VIEWER ===== */}
      {selectedFile && (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E7E2D8", background: "#FAF9F7", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => { setSelectedFile(null); setFileRecords([]); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", border: "1px solid #E7E2D8", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#4A4A4A" }}>
                ← Back to Files
              </button>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#161616" }}>📄 {selectedFile.file_name}</h3>
                <p style={{ fontSize: 12, color: "#949494", marginTop: 2 }}>{selectedFile.file_type} • {formatSize(selectedFile.file_size)} • {selectedFile.records_count} records</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1.5px solid #E7E2D8", borderRadius: 8, background: "#FAF9F7" }}>
                <Search size={14} color="#949494" />
                <input
                  type="text"
                  placeholder="Search records..."
                  value={fileSearch}
                  onChange={(e) => handleFileSearch(e.target.value)}
                  style={{ border: "none", background: "none", outline: "none", fontSize: 13, fontFamily: "'Inter', sans-serif", width: 180 }}
                />
              </div>
              <button onClick={exportFileData} style={{ ...btnPrimary, padding: "8px 14px", fontSize: 12 }}>
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          {/* Data Table */}
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {fileRecords.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#949494", borderBottom: "1px solid #E7E2D8", background: "#FAF9F7" }}>#</th>
                    {Object.keys(fileRecords[0]).filter((k) => k !== "id" && k !== "row").map((key) => (
                      <th key={key} style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#949494", borderBottom: "1px solid #E7E2D8", background: "#FAF9F7", whiteSpace: "nowrap" }}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileRecords.map((record, idx) => (
                    <tr key={record.id || idx} style={{ borderBottom: "1px solid #F0EDE8" }}>
                      <td style={{ padding: "10px 16px", fontSize: 12, color: "#949494" }}>{(filePagination.page - 1) * filePagination.limit + idx + 1}</td>
                      {Object.keys(record).filter((k) => k !== "id" && k !== "row").map((key) => (
                        <td key={key} style={{ padding: "10px 16px", fontSize: 13, color: "#4A4A4A" }}>{String(record[key] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 48, textAlign: "center", color: "#949494" }}>
                <FileSpreadsheet size={40} style={{ margin: "0 auto 12px" }} />
                <p>No records found{fileSearch ? ` for "${fileSearch}"` : ""}</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {filePagination.pages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: "1px solid #E7E2D8", background: "#FAF9F7" }}>
              <span style={{ fontSize: 12, color: "#656565" }}>
                Showing {(filePagination.page - 1) * filePagination.limit + 1}-{Math.min(filePagination.page * filePagination.limit, filePagination.total)} of {filePagination.total} records
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handlePage(filePagination.page - 1)} disabled={filePagination.page <= 1} style={{ ...btnSecondary, padding: "6px 10px", opacity: filePagination.page <= 1 ? 0.4 : 1 }}>
                  <ChevronLeft size={14} />
                </button>
                <span style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#4A4A4A" }}>Page {filePagination.page} of {filePagination.pages}</span>
                <button onClick={() => handlePage(filePagination.page + 1)} disabled={filePagination.page >= filePagination.pages} style={{ ...btnSecondary, padding: "6px 10px", opacity: filePagination.page >= filePagination.pages ? 0.4 : 1 }}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== SYNC HISTORY ===== */}
      {syncHistory.length > 0 && !selectedFile && (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #E7E2D8", background: "#FAF9F7" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#161616" }}>📋 Sync History</h3>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Time", "Trigger", "Status", "Added", "Updated", "Deactivated", "Message"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#949494", borderBottom: "1px solid #E7E2D8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syncHistory.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: "1px solid #F0EDE8" }}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#4A4A4A" }}>{formatDate(entry.completed_at || entry.started_at)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: entry.trigger_type === "manual" ? "#dbeafe" : entry.trigger_type === "preview" ? "#f3e8ff" : "#fef3c7", color: entry.trigger_type === "manual" ? "#2563eb" : entry.trigger_type === "preview" ? "#7c3aed" : "#d97706" }}>
                        {entry.trigger_type === "manual" ? "🔄 Manual" : entry.trigger_type === "preview" ? "👁 Preview" : "⏰ Scheduled"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: entry.status === "success" ? "#dcfce7" : entry.status === "failed" || entry.status === "validation_failed" ? "#fef2f2" : "#f3f4f6", color: entry.status === "success" ? "#16a34a" : entry.status === "failed" || entry.status === "validation_failed" ? "#dc2626" : "#6b7280" }}>
                        {entry.status === "success" ? "✓ Success" : entry.status === "failed" ? "✗ Failed" : entry.status === "validation_failed" ? "⚠ Invalid data" : `○ ${entry.status}`}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#16a34a" }}>{entry.added ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#2563eb" }}>{entry.updated ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, color: "#dc2626" }}>{entry.deactivated ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "#656565", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.error_message || entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== SHEET BACKFILL (two-way sync) ===== */}
      {backfill && (
        <div style={{ ...cardStyle, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#161616", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                ⬆ Sheet Backfill (two-way sync)
              </h3>
              <p style={{ fontSize: 12, color: "#949494", margin: "4px 0 0" }}>
                Customer-selected locations queued for the master Google Sheet — appended to the
                <strong> CRM Backfill </strong> tab with <strong>Source (inhouse / from google)</strong> as the last column.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: backfill.configured ? "#DCFCE7" : "#FEF3C7", color: backfill.configured ? "#15803D" : "#B45309" }}>
                {backfill.configured ? "Webhook configured" : "Webhook not set"}
              </span>
              <span style={{ fontSize: 12, color: "#656565" }}>
                Pending: <strong>{backfill.pending}</strong> • Synced: <strong>{backfill.synced}</strong> • Failed: <strong>{backfill.failed}</strong>
              </span>
              <button onClick={handleFlushBackfill} disabled={flushing || !backfill.pending}
                style={{ padding: "8px 16px", background: flushing || !backfill.pending ? "#E7E2D8" : "#F2701D", color: flushing || !backfill.pending ? "#949494" : "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: flushing || !backfill.pending ? "default" : "pointer", fontFamily: "'Inter', sans-serif" }}>
                {flushing ? "Pushing…" : "Sync Now"}
              </button>
              <a href={`${SYNC_API}/sheet-backfill?format=csv`}
                style={{ padding: "8px 14px", background: "#FAF9F7", border: "1px solid #E7E2D8", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#4A4A4A", textDecoration: "none" }}>
                Export CSV
              </a>
            </div>
          </div>
          {backfill.rows.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #F0EDE8", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#FAF9F7" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#949494" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#949494" }}>Type</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#949494" }}>Source</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#949494" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {backfill.rows.slice().reverse().slice(0, 50).map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #F0EDE8" }}>
                      <td style={{ padding: "6px 12px", color: "#161616", fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "6px 12px", color: "#656565", textTransform: "capitalize" }}>{r.type}</td>
                      <td style={{ padding: "6px 12px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: r.source === "from google" ? "#FEF3C7" : "#DCFCE7", color: r.source === "from google" ? "#B45309" : "#15803D" }}>
                          {r.source === "from google" ? "From Google" : "Inhouse"}
                        </span>
                      </td>
                      <td style={{ padding: "6px 12px", color: r.status === "synced" ? "#15803D" : r.status === "failed" ? "#DC2626" : "#B45309", fontWeight: 600, textTransform: "capitalize" }}>
                        {r.status}{r.last_error ? ` — ${r.last_error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== EMPTY STATE ===== */}
      {files.length === 0 && syncHistory.length === 0 && !selectedFile && (
        <div style={{ ...cardStyle, padding: 48, textAlign: "center" }}>
          <Cloud size={56} color="#D8D2C6" style={{ margin: "0 auto 16px" }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#161616", marginBottom: 8 }}>No Drive Connected</h3>
          <p style={{ fontSize: 14, color: "#949494", maxWidth: 400, margin: "0 auto 20px", lineHeight: 1.6 }}>
            Paste a Google Drive folder link above and click <strong>Connect Drive</strong> to start syncing your files.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <div style={{ padding: "12px 20px", background: "#FAF9F7", borderRadius: 10, border: "1px solid #E7E2D8", fontSize: 13, color: "#4A4A4A", display: "flex", alignItems: "center", gap: 8 }}>
              <FileSpreadsheet size={16} color="#F2701D" /> Auto-detect CSV & Excel
            </div>
            <div style={{ padding: "12px 20px", background: "#FAF9F7", borderRadius: 10, border: "1px solid #E7E2D8", fontSize: 13, color: "#4A4A4A", display: "flex", alignItems: "center", gap: 8 }}>
              <RefreshCw size={16} color="#F2701D" /> Auto-sync on schedule
            </div>
            <div style={{ padding: "12px 20px", background: "#FAF9F7", borderRadius: 10, border: "1px solid #E7E2D8", fontSize: 13, color: "#4A4A4A", display: "flex", alignItems: "center", gap: 8 }}>
              <Download size={16} color="#F2701D" /> Export data as CSV
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default GoogleDriveTab;
