import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";

    const services = await prisma.service.findMany({
      where: q ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { vendor: { name: { contains: q, mode: "insensitive" } } },
        ],
      } : undefined,
      include: {
        vendor: { select: { id: true, name: true } },
        priceHistory: {
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });

    const result = services.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      vendorId: s.vendorId,
      vendorName: s.vendor.name,
      price: s.priceHistory.length > 0 ? Number(s.priceHistory[0].price) : 0,
      currency: s.priceHistory.length > 0 ? s.priceHistory[0].currency : "INR",
    }));

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: "Failed", details: error.message }, { status: 500 });
  }
}
