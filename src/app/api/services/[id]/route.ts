import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createServiceSchema } from "@/lib/validations";
import { getUser } from "@/lib/get-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const validated = createServiceSchema.partial().parse(body);

    const service = await prisma.service.update({
      where: { id },
      data: validated,
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "UPDATED",
        module: "SERVICES",
        entityId: service.id,
        entityType: "Service",
        details: { name: service.name },
      },
    });

    return NextResponse.json(service);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update service" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await prisma.service.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "SERVICES",
        entityId: id,
        entityType: "Service",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete service" }, { status: 500 });
  }
}
