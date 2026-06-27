import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const element = await prisma.slideElement.create({
      data: {
        slideId: id,
        type: body.type,
        x: body.x || 0,
        y: body.y || 0,
        width: body.width || 100,
        height: body.height || 50,
        zIndex: body.zIndex || 0,
        content: body.content || {},
      },
    });
    return NextResponse.json(element, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
