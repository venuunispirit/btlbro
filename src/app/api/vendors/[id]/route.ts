import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVendorSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const validated = createVendorSchema.partial().parse(body);

    const vendor = await prisma.vendor.update({
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
        module: "VENDORS",
        entityId: vendor.id,
        entityType: "Vendor",
        details: { name: vendor.name },
      },
    });

    return NextResponse.json(vendor);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await prisma.vendor.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "VENDORS",
        entityId: id,
        entityType: "Vendor",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete vendor" }, { status: 500 });
  }
}
