import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const page = searchParams.get("page") || "";

    if (!q || q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    const where = { contains: q, mode: "insensitive" as const };

    const [brands, vendors, services, quotations, projects, presentations] = await Promise.all([
      prisma.brand.findMany({ where: { OR: [{ name: where }, { description: where }] }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.vendor.findMany({ where: { OR: [{ name: where }, { description: where }] }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.service.findMany({ where: { OR: [{ name: where }, { description: where }, { category: where }] }, include: { vendor: { select: { name: true } }, priceHistory: { orderBy: { effectiveFrom: "desc" }, take: 1 } }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.quotation.findMany({ where: { OR: [{ title: where }, { quoteNumber: where }] }, include: { brand: { select: { name: true } } }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.project.findMany({ where: { OR: [{ name: where }, { description: where }] }, include: { brand: { select: { name: true } } }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.presentation.findMany({ where: { OR: [{ title: where }, { description: where }] }, include: { project: { select: { name: true, brand: { select: { name: true } } } } }, take: 5, orderBy: { createdAt: "desc" } }),
    ]);

    const results: any[] = [];

    quotations.forEach((q: any) => results.push({ type: "quotation", id: q.id, title: q.quoteNumber, subtitle: `${q.title} · ${q.brand?.name}`, href: "/quotations" }));
    projects.forEach((p: any) => results.push({ type: "project", id: p.id, title: p.name, subtitle: p.brand?.name, href: "/projects" }));
    brands.forEach((b: any) => results.push({ type: "brand", id: b.id, title: b.name, subtitle: `${b._count?.projects || 0} projects`, href: "/brands" }));
    vendors.forEach((v: any) => results.push({ type: "vendor", id: v.id, title: v.name, subtitle: `${v.services?.length || 0} services`, href: "/vendors" }));
    services.forEach((s: any) => results.push({ type: "service", id: s.id, title: s.name, subtitle: `${s.vendor?.name} · ${s.category || "General"}`, href: "/vendors" }));
    presentations.forEach((p: any) => results.push({ type: "presentation", id: p.id, title: p.title, subtitle: `${p.project?.brand?.name} · ${p.project?.name}`, href: "/presentations" }));

    const priority: Record<string, number> = {
      quotation: 0, project: 1, brand: 2, vendor: 3, service: 4, presentation: 5,
    };
    const pagePriority: Record<string, string[]> = {
      "/quotations": ["quotation", "service", "brand", "project", "vendor", "presentation"],
      "/brands": ["brand", "project", "quotation", "vendor", "service", "presentation"],
      "/vendors": ["vendor", "service", "brand", "quotation", "project", "presentation"],
      "/projects": ["project", "quotation", "brand", "presentation", "vendor", "service"],
      "/presentations": ["presentation", "project", "brand", "quotation", "vendor", "service"],
      "/": ["quotation", "brand", "project", "vendor", "service", "presentation"],
    };

    const order = pagePriority[page] || pagePriority["/"];
    results.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error: any) {
    return NextResponse.json({ error: "Search failed", details: error.message }, { status: 500 });
  }
}
