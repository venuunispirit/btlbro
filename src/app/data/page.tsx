"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileSpreadsheet,
  Presentation,
  ExternalLink,
  Loader2,
  Database,
  RefreshCw,
  Table,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  iconLink?: string;
  embedUrl: string;
  isSheet: boolean;
  isSlide: boolean;
  modifiedTime?: string;
  owner?: string;
}

export default function DataPage() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setCheckingAuth(true);
    try {
      const res = await apiFetch("/api/google/status");
      const data = await res.json();
      setConnected(data.connected);
      if (data.connected) fetchFiles();
    } finally {
      setCheckingAuth(false);
    }
  };

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/google/files");
      const data = await res.json();
      if (data.files) setFiles(data.files);
    } finally {
      setLoading(false);
    }
  };

  const connectGoogle = async () => {
    try {
      const res = await apiFetch("/api/auth/google");
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error("Failed to get auth URL:", err);
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <AppShell title="Data">
      <div className="space-y-6">
        {checkingAuth ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="mx-auto h-8 w-8 animate-spin mb-2" />
            Checking connection...
          </div>
        ) : !connected ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Database className="mx-auto h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Google Drive</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Connect your Google account to browse, preview, and manage
                spreadsheets and presentations directly in the CRM.
              </p>
              <Button onClick={connectGoogle}>
                <ExternalLink className="mr-2 h-4 w-4" /> Connect Google Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""} in Drive
              </p>
              <Button size="sm" variant="outline" onClick={fetchFiles}>
                <RefreshCw className={`mr-2 h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading files...</div>
            ) : files.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Table className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">No files found in Drive</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create a sheet or slide in the shared folder to see it here
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {files.map((file) => (
                  <div key={file.id} className="break-inside-avoid">
                    <Card className="hover:shadow-md transition-shadow overflow-hidden cursor-pointer" onClick={() => setPreviewFile(file)}>
                      <div className="aspect-video w-full bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center relative">
                        {file.isSheet ? (
                          <FileSpreadsheet className="h-12 w-12 text-emerald-400/60" />
                        ) : (
                          <Presentation className="h-12 w-12 text-orange-400/60" />
                        )}
                        <Badge
                          className="absolute bottom-2 right-2 z-10 text-xs"
                          variant={file.isSheet ? "success" : "warning"}
                        >
                          {file.isSheet ? "Sheet" : "Slides"}
                        </Badge>
                      </div>
                      <CardContent className="p-4">
                        <p className="font-semibold text-sm mb-1 line-clamp-2">{file.name}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{file.owner || "Shared"}</span>
                          <span>{formatDate(file.modifiedTime)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-2xl w-full max-w-5xl shadow-2xl shadow-black/30 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 min-w-0">
                {previewFile.isSheet ? (
                  <FileSpreadsheet className="h-5 w-5 text-emerald-400 shrink-0" />
                ) : (
                  <Presentation className="h-5 w-5 text-orange-400 shrink-0" />
                )}
                <h2 className="font-semibold truncate">{previewFile.name}</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                >
                  <a href={previewFile.webViewLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                  </a>
                </Button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-all"
                >
                  <span className="text-lg leading-none">&times;</span>
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                src={previewFile.embedUrl}
                className="w-full h-[80vh] rounded-b-2xl"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
