import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const element = await prisma.slideElement.update({
      where: { id },
      data: {
        ...(body.x !== undefined && { x: body.x }),
        ...(body.y !== undefined && { y: body.y }),
        ...(body.width !== undefined && { width: body.width }),
        ...(body.height !== undefined && { height: body.height }),
        ...(body.zIndex !== undefined && { zIndex: body.zIndex }),
        ...(body.content && { content: body.content }),
        ...(body.type && { type: body.type }),
      },
    });
    return NextResponse.json(element);
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.slideElement.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
