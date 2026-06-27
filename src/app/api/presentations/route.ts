import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPresentationSchema } from "@/lib/validations";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const presentations = await prisma.presentation.findMany({
      include: {
        project: { include: { brand: true } },
        _count: { select: { slides: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(presentations);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch presentations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createPresentationSchema.parse(body);

    const presentation = await prisma.presentation.create({
      data: validated,
      include: { project: true },
    });

    await prisma.slide.create({
      data: {
        presentationId: presentation.id,
        order: 0,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "PRESENTATIONS",
        entityId: presentation.id,
        entityType: "Presentation",
        details: { title: presentation.title },
      },
    });

    return NextResponse.json(presentation, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create presentation" }, { status: 500 });
  }
}
