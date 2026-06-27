"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users, Settings, X, Database, ExternalLink, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface TeamMember {
  id: string; name: string; email: string; role: string; createdAt: string;
  _count: { activityLogs: number };
}

export default function SettingsPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "MEMBER" });
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => { fetchMembers(); }, []);
  useEffect(() => { apiFetch("/api/auth/session").then(r => r.json()).then(d => setUserRole(d?.user?.role || "")); }, []);
  useEffect(() => { apiFetch("/api/google/status").then(r => r.json()).then(d => setGoogleConnected(d.connected)).catch(() => {}); }, []);

  const fetchMembers = async () => {
    try { const res = await apiFetch("/api/users"); const data = await res.json(); if (Array.isArray(data)) setMembers(data); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch("/api/users", { method: "POST", body: JSON.stringify(form) });
    if (res.ok) { setShowModal(false); setForm({ name: "", email: "", password: "", role: "MEMBER" }); fetchMembers(); }
    else { const err = await res.json(); alert(err.error || "Failed"); }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Remove this team member?")) return;
    await apiFetch(`/api/users?id=${userId}`, { method: "DELETE" });
    fetchMembers();
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

  const isAdmin = userRole === "ADMIN";

  return (
    <AppShell title="Settings">
      <div className="space-y-6 max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings className="h-4 w-4" /> Profile</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg bg-muted/50 p-4 text-center">
                  <div className="mx-auto h-16 w-16 rounded-full bg-[#E87A1E]/20 flex items-center justify-center mb-2">
                    <span className="text-[#E87A1E] font-bold text-2xl">{members.find(m => m.role === "ADMIN")?.name?.charAt(0) || "A"}</span>
                  </div>
                  <p className="font-semibold">{members.find(m => m.role === "ADMIN")?.name || "Admin"}</p>
                  <p className="text-muted-foreground">{members.find(m => m.role === "ADMIN")?.email || ""}</p>
                  <Badge className="mt-2">ADMIN</Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span>1.0.0</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Database</span><span>PostgreSQL</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Deploy</span><span>Oracle Cloud</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Google Drive</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${googleConnected ? "bg-emerald-500" : "bg-gray-500"}`} />
                  <span>{googleConnected ? "Connected" : "Not connected"}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {googleConnected
                    ? "Your Google account is linked. Browse files from the Data page."
                    : "Connect to browse spreadsheets and presentations from your Drive."}
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={connectGoogle}>
                  {googleConnected ? (
                    <><RefreshCw className="mr-2 h-3 w-3" /> Reconnect</>
                  ) : (
                    <><ExternalLink className="mr-2 h-3 w-3" /> Connect</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Team Members</CardTitle>
                  {isAdmin && <Button size="sm" onClick={() => setShowModal(true)}><Plus className="mr-1 h-3 w-3" /> Add Member</Button>}
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : members.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No team members</div>
                ) : (
                  <div className="space-y-2">
                    {members.map(member => (
                      <div key={member.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-[#E87A1E]/20 flex items-center justify-center">
                            <span className="text-[#E87A1E] font-semibold text-sm">{member.name?.charAt(0) || "?"}</span>
                          </div>
                          <div><p className="text-sm font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.email}</p></div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-xs text-muted-foreground">
                            <p>{member._count.activityLogs} actions</p>
                            <p>Joined {formatDate(member.createdAt)}</p>
                          </div>
                          <Badge variant={member.role === "ADMIN" ? "default" : member.role === "MANAGER" ? "secondary" : "outline"}>{member.role}</Badge>
                          {isAdmin && member.role !== "ADMIN" && (
                            <Button size="icon" variant="ghost" onClick={() => handleDelete(member.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4" onClick={() => setShowModal(false)}>
            <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] backdrop-blur-xl rounded-2xl w-full max-w-lg shadow-2xl shadow-black/30" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 pb-0">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Add Team Member</h2>
                <button onClick={() => setShowModal(false)} className="h-8 w-8 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all"><X className="h-4 w-4" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                  <Input placeholder="Email *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                  <Input placeholder="Password *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={6} />
                  <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} options={[{ value: "ADMIN", label: "Admin" }, { value: "MANAGER", label: "Manager" }, { value: "MEMBER", label: "Member" }]} />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button type="submit">Create Member</Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
