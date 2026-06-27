import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBrandSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const validated = createBrandSchema.partial().parse(body);

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        ...validated,
        slug: validated.slug || (validated.name ? slugify(validated.name) : undefined),
        contactEmail: validated.contactEmail || null,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "UPDATED",
        module: "BRANDS",
        entityId: brand.id,
        entityType: "Brand",
        details: { name: brand.name },
      },
    });

    return NextResponse.json(brand);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update brand" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await prisma.brand.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "BRANDS",
        entityId: id,
        entityType: "Brand",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete brand" }, { status: 500 });
  }
}
