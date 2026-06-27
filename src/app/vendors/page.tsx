"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ImageUpload } from "@/components/ui/image-upload";
import { Plus, Users, Trash2, Edit, X, Package, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Service {
  id: string; name: string; category?: string;
  priceHistory: { price: number; currency: string }[];
}

interface Vendor {
  id: string; name: string; logo?: string; description?: string;
  contactName?: string; contactEmail?: string; contactPhone?: string; website?: string;
  services: Service[];
}

const emptyForm = { name: "", logo: "", description: "", contactName: "", contactEmail: "", contactPhone: "", website: "" };
const emptyServiceForm = { name: "", description: "", category: "", price: "" };

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [serviceVendorId, setServiceVendorId] = useState<string | null>(null);
  const [serviceForm, setServiceForm] = useState(emptyServiceForm);
  const [submitting, setSubmitting] = useState(false);
  const [showEditServiceModal, setShowEditServiceModal] = useState(false);
  const [editServiceTarget, setEditServiceTarget] = useState<{ service: Service; vendorId: string } | null>(null);
  const [editServiceForm, setEditServiceForm] = useState(emptyServiceForm);

  useEffect(() => { fetchVendors(); }, []);

  const fetchVendors = async () => {
    try { const res = await apiFetch("/api/vendors"); const data = await res.json(); if (Array.isArray(data)) setVendors(data); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    const res = await apiFetch("/api/vendors", { method: "POST", body: JSON.stringify(form) });
    if (res.ok) { setShowCreateModal(false); setForm(emptyForm); fetchVendors(); }
    setSubmitting(false);
  };

  const openEdit = (vendor: Vendor) => {
    setEditTarget(vendor);
    setForm({ name: vendor.name, logo: vendor.logo || "", description: vendor.description || "", contactName: vendor.contactName || "", contactEmail: vendor.contactEmail || "", contactPhone: vendor.contactPhone || "", website: vendor.website || "" });
    setShowEditModal(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editTarget) return; setSubmitting(true);
    const res = await apiFetch(`/api/vendors/${editTarget.id}`, { method: "PATCH", body: JSON.stringify(form) });
    if (res.ok) { setShowEditModal(false); setEditTarget(null); setForm(emptyForm); fetchVendors(); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this vendor?")) return;
    await apiFetch(`/api/vendors/${id}`, { method: "DELETE" });
    fetchVendors();
  };

  const openServiceModal = (vendorId: string) => {
    setServiceVendorId(vendorId);
    setServiceForm(emptyServiceForm);
    setShowServiceModal(true);
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault(); if (!serviceVendorId) return;
    const body: any = { vendorId: serviceVendorId, name: serviceForm.name, description: serviceForm.description, category: serviceForm.category };
    const serviceRes = await apiFetch("/api/services", { method: "POST", body: JSON.stringify(body) });
    if (serviceRes.ok) {
      const service = await serviceRes.json();
      if (serviceForm.price) {
        await apiFetch("/api/services/price", { method: "PUT", body: JSON.stringify({ serviceId: service.id, price: parseFloat(serviceForm.price) }) });
      }
      setShowServiceModal(false); setServiceVendorId(null); setServiceForm(emptyServiceForm); fetchVendors();
    }
  };

  const currentPrice = (s: Service) => {
    if (s.priceHistory.length === 0) return null;
    const p = s.priceHistory[0];
    return `${p.currency} ${p.price}`;
  };

  const openEditService = (service: Service, vendorId: string) => {
    setEditServiceTarget({ service, vendorId });
    setEditServiceForm({
      name: service.name,
      description: "",
      category: service.category || "",
      price: service.priceHistory[0]?.price?.toString() || "",
    });
    setShowEditServiceModal(true);
  };

  const handleEditService = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editServiceTarget) return;
    await apiFetch(`/api/services/${editServiceTarget.service.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: editServiceForm.name, category: editServiceForm.category }),
    });
    if (editServiceForm.price) {
      await apiFetch("/api/services/price", {
        method: "PUT",
        body: JSON.stringify({ serviceId: editServiceTarget.service.id, price: parseFloat(editServiceForm.price) }),
      });
    }
    setShowEditServiceModal(false); setEditServiceTarget(null); setEditServiceForm(emptyServiceForm); fetchVendors();
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm("Delete this service?")) return;
    await apiFetch(`/api/services/${serviceId}`, { method: "DELETE" });
    fetchVendors();
  };

  const Modal = ({ title, onSubmit, children }: { title: string; onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          {children}
        </form>
      </div>
    </div>
  );

  const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="text-sm font-medium text-gray-300 mb-2 block">{label}</label>
      {children}
    </div>
  );

  const vendorForm = (onClose: () => void) => (
    <>
      <FormField label="Vendor Name">
        <Input placeholder="Enter vendor name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
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
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save"}</Button>
      </div>
    </>
  );

  return (
    <AppShell title="Vendors">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={() => { setForm(emptyForm); setShowCreateModal(true); }}><Plus className="mr-2 h-4 w-4" /> New Vendor</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : vendors.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><Users className="mx-auto h-12 w-12 text-muted-foreground/50" /><p className="mt-4 text-muted-foreground">No vendors found</p></CardContent></Card>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {vendors.map(vendor => (
              <div key={vendor.id} className="break-inside-avoid">
                <Card className="hover:shadow-md transition-shadow overflow-hidden">
                  {vendor.logo ? (
                    <div className="w-full relative">
                      <img src={vendor.logo} alt={vendor.name} className="w-full h-auto object-contain" />
                      <div className="absolute top-2 right-2 flex gap-1 z-10">
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(vendor)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(vendor.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video w-full bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center relative">
                      <span className="text-violet-400 font-bold text-4xl">{vendor.name.charAt(0)}</span>
                      <div className="absolute top-2 right-2 flex gap-1 z-10">
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(vendor)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(vendor.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </div>
                  )}
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-lg">{vendor.name}</p>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => openServiceModal(vendor.id)}>
                        <Plus className="h-3 w-3" /> Service
                      </Button>
                    </div>
                    {vendor.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{vendor.description}</p>}
                    <div className="space-y-2 mt-3">
                      {vendor.services.slice(0, 5).map(service => (
                        <div key={service.id} className="text-sm bg-muted/30 rounded-lg px-3 py-2 group">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{service.name}</span>
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                              <button type="button" onClick={() => openEditService(service, vendor.id)} className="h-5 w-5 rounded flex items-center justify-center text-gray-400 hover:text-white transition-all"><Edit className="h-3 w-3" /></button>
                              <button type="button" onClick={() => handleDeleteService(service.id)} className="h-5 w-5 rounded flex items-center justify-center text-gray-400 hover:text-red-400 transition-all"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                            {service.category && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{service.category}</Badge>}
                            <span className="text-xs text-muted-foreground">{currentPrice(service) || "—"}</span>
                          </div>
                        </div>
                      ))}
                      {vendor.services.length > 5 && <p className="text-xs text-muted-foreground text-center pt-1">+{vendor.services.length - 5} more services</p>}
                      {vendor.services.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No services yet</p>}
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
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Create Vendor</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <FormField label="Vendor Name">
                <Input placeholder="Enter vendor name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
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
                <Button type="submit" disabled={submitting}>{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Vendor"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Edit Vendor</h2>
              <button type="button" onClick={() => setShowEditModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <FormField label="Vendor Name">
                <Input placeholder="Enter vendor name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
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

      {showServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowServiceModal(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Add Service</h2>
              <button type="button" onClick={() => setShowServiceModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleAddService} className="p-6 space-y-4">
              <FormField label="Service Name">
                <Input placeholder="e.g. Web Design" value={serviceForm.name} onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })} required />
              </FormField>
              <FormField label="Description">
                <Input placeholder="Service description" value={serviceForm.description} onChange={e => setServiceForm({ ...serviceForm, description: e.target.value })} />
              </FormField>
              <FormField label="Category">
                <Input placeholder="e.g. Web, Marketing, Design" value={serviceForm.category} onChange={e => setServiceForm({ ...serviceForm, category: e.target.value })} />
              </FormField>
              <FormField label="Price (INR)">
                <Input type="number" placeholder="50000" value={serviceForm.price} onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })} />
              </FormField>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowServiceModal(false)}>Cancel</Button>
                <Button type="submit">Add Service</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowEditServiceModal(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Edit Service</h2>
              <button type="button" onClick={() => setShowEditServiceModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleEditService} className="p-6 space-y-4">
              <FormField label="Service Name">
                <Input placeholder="e.g. Web Design" value={editServiceForm.name} onChange={e => setEditServiceForm({ ...editServiceForm, name: e.target.value })} required />
              </FormField>
              <FormField label="Category">
                <Input placeholder="e.g. Web, Marketing, Design" value={editServiceForm.category} onChange={e => setEditServiceForm({ ...editServiceForm, category: e.target.value })} />
              </FormField>
              <FormField label="Price (INR)">
                <Input type="number" placeholder="50000" value={editServiceForm.price} onChange={e => setEditServiceForm({ ...editServiceForm, price: e.target.value })} />
              </FormField>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowEditServiceModal(false)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
