"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ImageUpload } from "@/components/ui/image-upload";
import { Plus, Building2, Trash2, Edit, X, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Brand {
  id: string; name: string; logo?: string; description?: string;
  contactName?: string; contactEmail?: string; contactPhone?: string; website?: string;
  _count: { projects: number; quotations: number };
}

const emptyForm = { name: "", logo: "", description: "", contactName: "", contactEmail: "", contactPhone: "", website: "" };

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Brand | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchBrands(); }, []);

  const fetchBrands = async () => {
    try { const res = await apiFetch("/api/brands"); const data = await res.json(); if (Array.isArray(data)) setBrands(data); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    const res = await apiFetch("/api/brands", { method: "POST", body: JSON.stringify(form) });
    if (res.ok) { setShowCreateModal(false); setForm(emptyForm); fetchBrands(); }
    setSubmitting(false);
  };

  const openEdit = (brand: Brand) => {
    setEditTarget(brand);
    setForm({ name: brand.name, logo: brand.logo || "", description: brand.description || "", contactName: brand.contactName || "", contactEmail: brand.contactEmail || "", contactPhone: brand.contactPhone || "", website: brand.website || "" });
    setShowEditModal(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editTarget) return; setSubmitting(true);
    const res = await apiFetch(`/api/brands/${editTarget.id}`, { method: "PATCH", body: JSON.stringify(form) });
    if (res.ok) { setShowEditModal(false); setEditTarget(null); setForm(emptyForm); fetchBrands(); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this brand?")) return;
    await apiFetch(`/api/brands/${id}`, { method: "DELETE" });
    fetchBrands();
  };

  const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="text-sm font-medium text-[var(--text-secondary)] mb-2 block">{label}</label>
      {children}
    </div>
  );

  return (
    <AppShell title="Brands">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={() => { setForm(emptyForm); setShowCreateModal(true); }}><Plus className="mr-2 h-4 w-4" /> New Brand</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : brands.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><Building2 className="mx-auto h-12 w-12 text-muted-foreground/50" /><p className="mt-4 text-muted-foreground">No brands found</p></CardContent></Card>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {brands.map(brand => (
              <div key={brand.id} className="break-inside-avoid">
                <Card className="hover:shadow-md transition-shadow overflow-hidden">
                  {brand.logo ? (
                    <div className="w-full relative">
                      <img src={brand.logo} alt={brand.name} className="w-full h-auto object-contain" />
                      <div className="absolute top-2 right-2 flex gap-1 z-10">
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(brand)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(brand.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                      <Badge className="absolute bottom-2 right-2 z-10 text-xs">{brand._count.projects + brand._count.quotations} items</Badge>
                    </div>
                  ) : (
                    <div className="aspect-video w-full bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center relative">
                      <span className="text-amber-400 font-bold text-4xl">{brand.name.charAt(0)}</span>
                      <div className="absolute top-2 right-2 flex gap-1 z-10">
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(brand)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(brand.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                      <Badge className="absolute bottom-2 right-2 z-10 text-xs">{brand._count.projects + brand._count.quotations} items</Badge>
                    </div>
                  )}
                  <CardContent className="p-5">
                    <p className="font-semibold text-lg mb-1">{brand.name}</p>
                    {brand.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{brand.description}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {brand.contactName && <span>Contact: {brand.contactName}</span>}
                      {brand.contactEmail && <span>{brand.contactEmail}</span>}
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
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create Brand</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <FormField label="Brand Name">
                <Input placeholder="Enter brand name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </FormField>
              <FormField label="Logo">
                <ImageUpload value={form.logo} onChange={url => setForm({ ...form, logo: url })} />
              </FormField>
              <FormField label="Description">
                <Input placeholder="Brief description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </FormField>
              <FormField label="Contact Name">
                <Input placeholder="Contact person name" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
              </FormField>
              <FormField label="Contact Email">
                <Input type="email" placeholder="email@example.com" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} />
              </FormField>
              <FormField label="Contact Phone">
                <Input placeholder="Phone number" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} />
              </FormField>
              <FormField label="Website">
                <Input placeholder="https://example.com" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
              </FormField>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Brand"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Edit Brand</h2>
              <button type="button" onClick={() => setShowEditModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <FormField label="Brand Name">
                <Input placeholder="Enter brand name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </FormField>
              <FormField label="Logo">
                <ImageUpload value={form.logo} onChange={url => setForm({ ...form, logo: url })} />
              </FormField>
              <FormField label="Description">
                <Input placeholder="Brief description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </FormField>
              <FormField label="Contact Name">
                <Input placeholder="Contact person name" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
              </FormField>
              <FormField label="Contact Email">
                <Input type="email" placeholder="email@example.com" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} />
              </FormField>
              <FormField label="Contact Phone">
                <Input placeholder="Phone number" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} />
              </FormField>
              <FormField label="Website">
                <Input placeholder="https://example.com" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
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
