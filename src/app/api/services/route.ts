import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createServiceSchema } from "@/lib/validations";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const services = await prisma.service.findMany({
      include: {
        vendor: true,
        priceHistory: {
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(services);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch services" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createServiceSchema.parse(body);

    const service = await prisma.service.create({
      data: validated,
      include: { vendor: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "SERVICES",
        entityId: service.id,
        entityType: "Service",
        details: { name: service.name, vendorId: service.vendorId },
      },
    });

    return NextResponse.json(service, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create service" }, { status: 500 });
  }
}
