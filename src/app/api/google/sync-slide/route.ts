import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { createOrUpdateSlide } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { presentationId } = await req.json();

    const presentation = await prisma.presentation.findUnique({
      where: { id: presentationId },
      include: {
        project: { include: { brand: true } },
        slides: {
          orderBy: { order: "asc" },
          include: { elements: true },
        },
      },
    });

    if (!presentation) {
      return NextResponse.json({ error: "Presentation not found" }, { status: 404 });
    }

    const result = await createOrUpdateSlide(
      user.id,
      presentation.title,
      presentation.googleSlideId ?? undefined
    );

    if (!result) {
      return NextResponse.json({ error: "Not connected to Google" }, { status: 400 });
    }

    await prisma.presentation.update({
      where: { id: presentationId },
      data: { googleSlideId: result.presentationId },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Error syncing slide:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
