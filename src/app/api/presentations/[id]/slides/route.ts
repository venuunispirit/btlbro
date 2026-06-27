import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const slide = await prisma.slide.create({
      data: {
        presentationId: id,
        order: body.order ?? 0,
        transition: body.transition || "FADE",
        background: body.background || "#ffffff",
      },
    });
    return NextResponse.json(slide, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
