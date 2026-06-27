import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const presentation = await prisma.presentation.findUnique({
      where: { id },
      include: {
        project: { include: { brand: true } },
        slides: {
          orderBy: { order: "asc" },
          include: { elements: { orderBy: { zIndex: "asc" } } },
        },
      },
    });
    if (!presentation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(presentation);
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
