import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVendorSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const vendors = await prisma.vendor.findMany({
      include: {
        services: {
          include: {
            priceHistory: {
              orderBy: { effectiveFrom: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(vendors);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createVendorSchema.parse(body);

    const vendor = await prisma.vendor.create({
      data: {
        ...validated,
        slug: validated.slug || slugify(validated.name),
        contactEmail: validated.contactEmail || null,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "VENDORS",
        entityId: vendor.id,
        entityType: "Vendor",
        details: { name: vendor.name },
      },
    });

    return NextResponse.json(vendor, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 });
  }
}
