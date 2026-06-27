import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createProjectSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        brand: true,
        _count: { select: { quotations: true, presentations: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createProjectSchema.parse(body);

    const project = await prisma.project.create({
      data: {
        ...validated,
        slug: validated.slug || slugify(validated.name),
        startDate: validated.startDate ? new Date(validated.startDate as any) : null,
        endDate: validated.endDate ? new Date(validated.endDate as any) : null,
      },
      include: { brand: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "PROJECTS",
        entityId: project.id,
        entityType: "Project",
        details: { name: project.name },
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
