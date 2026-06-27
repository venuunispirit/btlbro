"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Presentation, Edit, Play, X } from "lucide-react";
import { formatDate, getStatusColor } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Project { id: string; name: string; brand: { name: string }; }
interface PresentationItem {
  id: string; title: string; description?: string; status: string;
  project: Project; _count: { slides: number }; createdAt: string;
}

export default function PresentationsPage() {
  const [presentations, setPresentations] = useState<PresentationItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", projectId: "", description: "" });

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
                      <Button size="icon" variant="ghost"><Play className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowModal(false)}>
            <div className="bg-white/10 border border-white/10 backdrop-blur-xl rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 pb-0">
                <h2 className="text-lg font-semibold text-white">New Presentation</h2>
                <button onClick={() => setShowModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
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
      </div>
    </AppShell>
  );
}
