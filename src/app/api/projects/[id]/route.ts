import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createProjectSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const validated = createProjectSchema.partial().parse(body);

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...validated,
        slug: validated.slug || (validated.name ? slugify(validated.name) : undefined),
      },
      include: { brand: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "UPDATED",
        module: "PROJECTS",
        entityId: project.id,
        entityType: "Project",
        details: { name: project.name },
      },
    });

    return NextResponse.json(project);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await prisma.project.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "PROJECTS",
        entityId: id,
        entityType: "Project",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
