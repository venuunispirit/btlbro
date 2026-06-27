"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Presentation, Edit, Play, X, ExternalLink, Loader2 } from "lucide-react";
import { formatDate, getStatusColor } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Project { id: string; name: string; brand: { name: string }; }
interface PresentationItem {
  id: string; title: string; description?: string; status: string;
  googleSlideId?: string;
  project: Project; _count: { slides: number }; createdAt: string;
}

export default function PresentationsPage() {
  const [presentations, setPresentations] = useState<PresentationItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", projectId: "", description: "" });
  const [slidePreview, setSlidePreview] = useState<{ id: string; title: string } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { Promise.all([fetchPresentations(), fetchProjects()]); }, []);

  const fetchPresentations = async () => {
    try { const res = await apiFetch("/api/presentations"); const data = await res.json(); if (Array.isArray(data)) setPresentations(data); }
    finally { setLoading(false); }
  };
  const fetchProjects = async () => { const res = await apiFetch("/api/projects"); const data = await res.json(); if (Array.isArray(data)) setProjects(data); };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch("/api/presentations", { method: "POST", body: JSON.stringify(form) });
    if (res.ok) { setShowModal(false); setForm({ title: "", projectId: "", description: "" }); fetchPresentations(); }
  };

  const handlePlay = async (p: PresentationItem) => {
    if (p.googleSlideId) {
      setSlidePreview({ id: p.googleSlideId, title: p.title });
      return;
    }
    setSyncing(p.id);
    try {
      const res = await apiFetch("/api/google/sync-slide", {
        method: "POST",
        body: JSON.stringify({ presentationId: p.id }),
      });
      const data = await res.json();
      if (data.presentationId) {
        fetchPresentations();
        setSlidePreview({ id: data.presentationId, title: p.title });
      }
    } finally {
      setSyncing(null);
    }
  };

  return (
    <AppShell title="Presentations">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={() => setShowModal(true)}><Plus className="mr-2 h-4 w-4" /> New Presentation</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : presentations.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><Presentation className="mx-auto h-12 w-12 text-muted-foreground/50" /><p className="mt-4 text-muted-foreground">No presentations found</p></CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {presentations.map(p => (
              <Card key={p.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div><p className="font-semibold text-lg">{p.title}</p><p className="text-sm text-muted-foreground">{p.project.brand.name} · {p.project.name}</p></div>
                    <Badge className={getStatusColor(p.status)}>{p.status}</Badge>
                  </div>
                  {p.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{p.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{p._count.slides} slides · {formatDate(p.createdAt)}</span>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" asChild><a href={`/presentations/${p.id}/edit`}><Edit className="h-4 w-4" /></a></Button>
                      <Button size="icon" variant="ghost" onClick={() => handlePlay(p)} disabled={syncing === p.id}>
                        {syncing === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowModal(false)}>
            <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] backdrop-blur-xl rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 pb-0">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">New Presentation</h2>
                <button onClick={() => setShowModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="Title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
                  <Select placeholder="Select Project *" value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} options={projects.map(p => ({ value: p.id, label: `${p.name} (${p.brand.name})` }))} />
                  <Input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="md:col-span-2" />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button type="submit">Create Presentation</Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {slidePreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setSlidePreview(null)}
          >
            <div
              className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-2xl w-full max-w-5xl shadow-2xl shadow-black/30 max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
                <h2 className="font-semibold truncate">{slidePreview.title}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" asChild>
                    <a
                      href={`https://docs.google.com/presentation/d/${slidePreview.id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Edit in Slides
                    </a>
                  </Button>
                  <button
                    onClick={() => setSlidePreview(null)}
                    className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-all"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <iframe
                  src={`https://docs.google.com/presentation/d/${slidePreview.id}/preview`}
                  className="w-full h-[80vh] rounded-b-2xl"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
