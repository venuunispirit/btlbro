"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, Trash2, Edit, X, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Quotation {
  id: string; quoteNumber: string; title: string; status: string;
  totalAmount: number; currency: string;
  brand: { name: string; };
  creator: { name: string };
}

interface Brand { id: string; name: string; }
interface Project { id: string; name: string; brandId: string; }
interface Service { id: string; name: string; category?: string; vendorId: string; priceHistory: { price: number; currency: string }[]; }
interface Vendor { id: string; name: string; services: Service[]; }

interface LineItem { vendorId: string; serviceId: string; description: string; quantity: number; unitPrice: number; }

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-500/20 text-gray-300",
  SENT: "bg-blue-500/20 text-blue-300",
  ACCEPTED: "bg-emerald-500/20 text-emerald-300",
  REJECTED: "bg-red-500/20 text-red-300",
  EXPIRED: "bg-amber-500/20 text-amber-300",
};

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Quotation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [brandId, setBrandId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taxRate, setTaxRate] = useState(18);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);

  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState("DRAFT");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [qRes, bRes, pRes, vRes] = await Promise.all([
        apiFetch("/api/quotations"),
        apiFetch("/api/brands"),
        apiFetch("/api/projects"),
        apiFetch("/api/vendors"),
      ]);
      const qData = await qRes.json(); if (Array.isArray(qData)) setQuotations(qData);
      const bData = await bRes.json(); if (Array.isArray(bData)) setBrands(bData);
      const pData = await pRes.json(); if (Array.isArray(pData)) setProjects(pData);
      const vData = await vRes.json(); if (Array.isArray(vData)) setVendors(vData);
    } finally { setLoading(false); }
  };

  const openCreate = () => {
    setTitle(""); setBrandId(""); setProjectId(""); setTaxRate(18); setNotes(""); setItems([{ vendorId: "", serviceId: "", description: "", quantity: 1, unitPrice: 0 }]);
    setShowCreateModal(true);
  };

  const filteredProjects = projects.filter(p => p.brandId === brandId);

  const vendorServices = (vId: string) => vendors.find(v => v.id === vId)?.services || [];

  const servicePrice = (sId: string) => {
    for (const v of vendors) {
      const s = v.services.find(sv => sv.id === sId);
      if (s?.priceHistory[0]) return Number(s.priceHistory[0].price);
    }
    return 0;
  };

  const updateItem = (idx: number, field: keyof LineItem, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    if (field === "vendorId") { next[idx].serviceId = ""; next[idx].description = ""; next[idx].unitPrice = 0; }
    if (field === "serviceId") {
      const svc = vendors.flatMap(v => v.services).find(s => s.id === value);
      next[idx].description = svc?.name || "";
      next[idx].unitPrice = servicePrice(value);
    }
    setItems(next);
  };

  const addItem = () => setItems([...items, { vendorId: "", serviceId: "", description: "", quantity: 1, unitPrice: 0 }]);
  const removeItem = (idx: number) => { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)); };

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = (subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    const res = await apiFetch("/api/quotations", {
      method: "POST",
      body: JSON.stringify({
        title, brandId, projectId, taxRate, notes: notes || undefined,
        items: items.map(i => ({ serviceId: i.serviceId || undefined, vendorId: i.vendorId || undefined, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
      }),
    });
    if (res.ok) { setShowCreateModal(false); fetchAll(); }
    setSubmitting(false);
  };

  const openEdit = (q: Quotation) => {
    setEditTarget(q); setEditTitle(q.title); setEditStatus(q.status); setShowEditModal(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editTarget) return; setSubmitting(true);
    const res = await apiFetch(`/api/quotations/${editTarget.id}`, { method: "PATCH", body: JSON.stringify({ title: editTitle, status: editStatus }) });
    if (res.ok) { setShowEditModal(false); setEditTarget(null); fetchAll(); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this quotation?")) return;
    await apiFetch(`/api/quotations/${id}`, { method: "DELETE" });
    fetchAll();
  };

  const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="text-sm font-medium text-gray-300 mb-2 block">{label}</label>
      {children}
    </div>
  );

  return (
    <AppShell title="Quotations">
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New Quotation</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : quotations.length === 0 ? (
          <Card><CardContent className="py-12 text-center"><FileText className="mx-auto h-12 w-12 text-muted-foreground/50" /><p className="mt-4 text-muted-foreground">No quotations found</p></CardContent></Card>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {quotations.map(q => (
              <div key={q.id} className="break-inside-avoid">
                <Card className="hover:shadow-md transition-shadow overflow-hidden">
                  <div className="aspect-video w-full bg-gradient-to-br from-[#E87A1E]/20 to-[#E87A1E]/5 flex items-center justify-center relative">
                    <FileText className="h-12 w-12 text-[#E87A1E]/60" />
                    <div className="absolute top-2 right-2 flex gap-1 z-10">
                      <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => openEdit(q)}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80" onClick={() => handleDelete(q.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                    <Badge className={`absolute bottom-2 right-2 z-10 text-xs capitalize ${statusColors[q.status] || ""}`}>{q.status.toLowerCase()}</Badge>
                  </div>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-lg">{q.quoteNumber}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{q.title}</p>
                    <p className="text-xs text-muted-foreground mb-1">{q.brand.name}</p>
                    <div className="flex items-center justify-between pt-3 border-t border-white/10">
                      <span className="text-sm font-semibold">{q.currency} {Number(q.totalAmount).toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-md p-4 pt-8 overflow-y-auto" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Create Quotation</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-5">
              <FormField label="Title">
                <Input placeholder="e.g. Q3 Marketing Campaign" value={title} onChange={e => setTitle(e.target.value)} required />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Brand">
                  <select className="flex h-10 w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={brandId} onChange={e => { setBrandId(e.target.value); setProjectId(""); }}>
                    <option value="">Select Brand</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </FormField>
                <FormField label="Project">
                  <select className="flex h-10 w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!brandId}>
                    <option value="">Select Project</option>
                    {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FormField>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-300">Line Items</label>
                  <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-3 w-3 mr-1" /> Add Item</Button>
                </div>
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="bg-white/5 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Item #{idx + 1}</span>
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(idx)} className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-red-400 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField label="Vendor">
                          <select className="flex h-10 w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={item.vendorId} onChange={e => updateItem(idx, "vendorId", e.target.value)}>
                            <option value="">Select Vendor</option>
                            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </FormField>
                        <FormField label="Service">
                          <select className="flex h-10 w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={item.serviceId} onChange={e => updateItem(idx, "serviceId", e.target.value)} disabled={!item.vendorId}>
                            <option value="">Select Service</option>
                            {vendorServices(item.vendorId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </FormField>
                      </div>
                      <FormField label="Description">
                        <Input placeholder="Service description" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} required />
                      </FormField>
                      <div className="grid grid-cols-3 gap-3">
                        <FormField label="Qty">
                          <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} required />
                        </FormField>
                        <FormField label="Unit Price">
                          <Input type="number" min={0} value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} required />
                        </FormField>
                        <FormField label="Total">
                          <div className="flex h-10 w-full items-center rounded-lg border border-[#333] bg-[#1a1a1a] px-3 text-sm text-white">{(item.quantity * item.unitPrice).toLocaleString()}</div>
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/10 pt-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-400">Subtotal</span><span>₹ {subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Tax</span>
                  <div className="flex items-center gap-2">
                    <input type="number" className="w-14 rounded border border-[#333] bg-[#1a1a1a] px-2 py-1 text-xs text-white text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E87A1E]" value={taxRate} onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} /> %
                    <span>₹ {taxAmount.toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex justify-between text-base font-semibold border-t border-white/10 pt-2"><span>Total</span><span>₹ {totalAmount.toLocaleString()}</span></div>
              </div>

              <FormField label="Notes (optional)">
                <Input placeholder="Payment terms, delivery info..." value={notes} onChange={e => setNotes(e.target.value)} />
              </FormField>

              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting || !brandId || items.some(i => !i.description || !i.quantity || !i.unitPrice)}>
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Quotation"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowEditModal(false)}>
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-white">Edit Quotation</h2>
              <button type="button" onClick={() => setShowEditModal(false)} className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:bg-white/10 hover:text-white transition-all"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <FormField label="Title">
                <Input placeholder="Quotation title" value={editTitle} onChange={e => setEditTitle(e.target.value)} required />
              </FormField>
              <FormField label="Status">
                <select className="flex h-10 w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E]" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                  <option value="DRAFT">Draft</option>
                  <option value="SENT">Sent</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="EXPIRED">Expired</option>
                </select>
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
