import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/get-user";

export async function PUT(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { serviceId, price } = body;

    if (!serviceId || price === undefined) {
      return NextResponse.json({ error: "serviceId and price required" }, { status: 400 });
    }

    const priceHistory = await prisma.priceHistory.create({
      data: {
        serviceId,
        price,
        currency: "INR",
        effectiveFrom: new Date(),
      },
    });

    return NextResponse.json(priceHistory, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed", details: error.message }, { status: 500 });
  }
}
