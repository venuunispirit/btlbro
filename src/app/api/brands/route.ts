import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBrandSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const brands = await prisma.brand.findMany({
      include: {
        _count: { select: { projects: true, quotations: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(brands);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch brands" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createBrandSchema.parse(body);

    const brand = await prisma.brand.create({
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
        module: "BRANDS",
        entityId: brand.id,
        entityType: "Brand",
        details: { name: brand.name },
      },
    });

    return NextResponse.json(brand, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create brand" }, { status: 500 });
  }
}
