import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const slide = await prisma.slide.update({
      where: { id },
      data: {
        ...(body.transition && { transition: body.transition }),
        ...(body.background && { background: body.background }),
        ...(body.order !== undefined && { order: body.order }),
      },
    });
    return NextResponse.json(slide);
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
