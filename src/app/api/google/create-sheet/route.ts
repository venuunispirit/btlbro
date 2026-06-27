import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { createSheet } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { vendorId, serviceIds } = await req.json();

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        services: {
          where: serviceIds ? { id: { in: serviceIds } } : undefined,
          include: {
            priceHistory: { orderBy: { effectiveFrom: "desc" }, take: 1 },
          },
        },
      },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const headers = ["Service", "Category", "Price", "Currency"];
    const rows = vendor.services.map((s) => [
      s.name,
      s.category || "",
      s.priceHistory[0]?.price.toString() || "",
      s.priceHistory[0]?.currency || "INR",
    ]);

    const sheet = await createSheet(
      user.id,
      `Services - ${vendor.name}`,
      { headers, rows }
    );

    if (!sheet) {
      return NextResponse.json({ error: "Not connected to Google" }, { status: 400 });
    }

    return NextResponse.json(sheet);
  } catch (err: any) {
    console.error("Error creating sheet:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
