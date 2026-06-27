"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Users, FileText, FolderKanban } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function DashboardPage() {
  const [stats, setStats] = useState({ brands: 0, vendors: 0, projects: 0, quotations: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch("/api/brands").then(r => r.json()),
      apiFetch("/api/vendors").then(r => r.json()),
      apiFetch("/api/projects").then(r => r.json()),
      apiFetch("/api/quotations").then(r => r.json()),
    ]).then(([brands, vendors, projects, quotations]) => {
      setStats({
        brands: Array.isArray(brands) ? brands.length : 0,
        vendors: Array.isArray(vendors) ? vendors.length : 0,
        projects: Array.isArray(projects) ? projects.length : 0,
        quotations: Array.isArray(quotations) ? quotations.length : 0,
      });
    });
  }, []);

  const tiles = [
    { label: "Brands", value: stats.brands, icon: Building2, href: "/brands", color: "from-amber-500/20 to-amber-500/5 text-amber-400" },
    { label: "Vendors", value: stats.vendors, icon: Users, href: "/vendors", color: "from-violet-500/20 to-violet-500/5 text-violet-400" },
    { label: "Projects", value: stats.projects, icon: FolderKanban, href: "/projects", color: "from-sky-500/20 to-sky-500/5 text-sky-400" },
    { label: "Quotations", value: stats.quotations, icon: FileText, href: "/quotations", color: "from-[#E87A1E]/20 to-[#E87A1E]/5 text-[#E87A1E]" },
  ];

  return (
    <AppShell title="Dashboard">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map(tile => (
          <a key={tile.label} href={tile.href}>
            <Card className="hover:shadow-md transition-shadow overflow-hidden">
              <div className={`aspect-video w-full bg-gradient-to-br ${tile.color} flex items-center justify-center`}>
                <tile.icon className="h-12 w-12" />
              </div>
              <CardContent className="p-5 flex items-center justify-between">
                <span className="font-semibold">{tile.label}</span>
                <span className="text-2xl font-bold">{tile.value}</span>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
