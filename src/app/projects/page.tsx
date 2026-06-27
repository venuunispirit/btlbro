"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, FolderKanban, Trash2, Edit, X, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Brand { id: string; name: string; }

interface Project {
  id: string; name: string; description?: string; status: string;
  startDate?: string; endDate?: string;
  brand: Brand;
  _count: { quotations: number; presentations: number };
}

const statusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-500/20 text-emerald-300",
  COMPLETED: "bg-blue-500/20 text-blue-300",
  ON_HOLD: "bg-amber-500/20 text-amber-300",
};

const emptyForm = { name: "", description: "", status: "ACTIVE", brandId: "", startDate: "", endDate: "" };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { Promise.all([fetchProjects(), fetchBrands()]); }, []);

  const fetchProjects = async () => {
    try { const res = await apiFetch("/api/projects"); const data = await res.json(); if (Array.isArray(data)) setProjects(data); }
    finally { setLoading(false); }
  };

  const fetchBrands = async () => {
    try { const res = await apiFetch("/api/brands"); const data = await res.json(); if (Array.isArray(data)) setBrands(data); }
    catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    const body: any = { name: form.name, description: form.description, status: form.status, brandId: form.brandId };
    if (form.startDate) body.startDate = new Date(form.startDate).toISOString();
    if (form.endDate) body.endDate = new Date(form.endDate).toISOString();
    const res = await apiFetch("/api/projects", { method: "POST", body: JSON.stringify(body) });
    if (res.ok) { setShowCreateModal(false); setForm(emptyForm); fetchProjects(); }
    setSubmitting(false);
  };

  const openEdit = (project: Project) => {
    setEditTarget(project);
    setForm({
      name: project.name,
      description: project.description || "",
      status: project.status,
      brandId: project.brand.id,
      startDate: project.startDate ? project.startDate.split("T")[0] : "",
      endDate: project.endDate ? project.endDate.split("T")[0] : "",
    });
    setShowEditModal(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editTarget) return; setSubmitting(true);
    const body: any = { name: form.name, description: form.description, status: form.status, brandId: form.brandId };
    if (form.startDate) body.startDate = new Date(form.startDate).toISOString();
    if (form.endDate) body.endDate = new Date(form.endDate).toISOString();
    const res = await apiFetch(`/api/projects/${editTarget.id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res.ok) { setShowEditModal(false); setEditTarget(null); setForm(emptyForm); fetchProjects(); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    fetchProjects();
  };

  const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="text-sm font-medium text-[var(--text-secondary)] mb-2 block">{label}</label>
      {children}
    </div>
  );

  return (
    <AppShell title="Projects">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={() => { setForm(emptyForm); setShowCreateModal(true); }}><Plus className="mr-2 h-4 w-4" /> New Project</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : projects.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><FolderKanban className="mx-auto h-12 w-12 text-muted-foreground/50" /><p className="mt-4 text-muted-foreground">No projects found</p></CardContent></Card>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {projects.map(project => (
              <div key={project.id} className="break-inside-avoid">
                <Card className="hover:shadow-md transition-shadow overflow-hidden">
                  <div className="aspect-video w-full bg-gradient-to-br from-sky-500/20 to-sky-500/5 flex items-center justify-center relative">
                    <span className="text-sky-400 font-bold text-4xl">{project.name.charAt(0)}</span>
                    <div className="absolute top-2 right-2 flex gap-1 z-10">
                      <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(project)}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(project.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                    <Badge className={`absolute bottom-2 right-2 z-10 text-xs capitalize ${statusColors[project.status] || ""}`}>{project.status.toLowerCase().replace("_", " ")}</Badge>
                  </div>
                  <CardContent className="p-5">
                    <p className="font-semibold text-lg mb-1">{project.name}</p>
                    <p className="text-xs text-muted-foreground mb-2">{project.brand.name}</p>
                    {project.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{project.description}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{project._count.quotations} quotations</span>
                      <span>{project._count.presentations} presentations</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create Project</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <FormField label="Project Name">
                <Input placeholder="Enter project name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </FormField>
              <FormField label="Brand">
                <select className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={form.brandId} onChange={e => setForm({ ...form, brandId: e.target.value })} required>
                  <option value="">Select Brand</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </FormField>
              <FormField label="Description">
                <Input placeholder="Brief description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </FormField>
              <FormField label="Status">
                <select className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On Hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </FormField>
              <FormField label="Start Date">
                <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </FormField>
              <FormField label="End Date">
                <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </FormField>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Project"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Edit Project</h2>
              <button type="button" onClick={() => setShowEditModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <FormField label="Project Name">
                <Input placeholder="Enter project name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </FormField>
              <FormField label="Brand">
                <select className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={form.brandId} onChange={e => setForm({ ...form, brandId: e.target.value })} required>
                  <option value="">Select Brand</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </FormField>
              <FormField label="Description">
                <Input placeholder="Brief description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </FormField>
              <FormField label="Status">
                <select className="flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On Hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </FormField>
              <FormField label="Start Date">
                <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </FormField>
              <FormField label="End Date">
                <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </FormField>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
