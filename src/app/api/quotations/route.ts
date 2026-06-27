import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createQuotationSchema } from "@/lib/validations";
import { generateQuoteNumber } from "@/lib/utils";
import { getUser } from "@/lib/get-user";

export async function GET() {
  try {
    const quotations = await prisma.quotation.findMany({
      include: {
        brand: true,
        project: true,
        creator: { select: { id: true, name: true, email: true } },
        items: {
          include: { service: true, vendor: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(quotations);
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to fetch quotations", details: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createQuotationSchema.parse(body);

    const subtotal = validated.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const taxRate = validated.taxRate || 18;
    const taxAmount = (subtotal * taxRate) / 100;
    const totalAmount = subtotal + taxAmount;

    const quotation = await prisma.quotation.create({
      data: {
        title: validated.title,
        projectId: validated.projectId,
        brandId: validated.brandId,
        quoteNumber: generateQuoteNumber(),
        createdBy: user.id,
        subtotal,
        taxRate,
        taxAmount,
        totalAmount,
        currency: validated.currency || "INR",
        validUntil: validated.validUntil ? new Date(validated.validUntil as any) : null,
        terms: validated.terms || null,
        notes: validated.notes || null,
        status: "DRAFT",
        items: {
          create: validated.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
            serviceId: item.serviceId || null,
            vendorId: item.vendorId || null,
          })),
        },
      },
      include: {
        items: { include: { service: true, vendor: true } },
        brand: true,
        project: true,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "QUOTATIONS",
        entityId: quotation.id,
        entityType: "Quotation",
        details: { quoteNumber: quotation.quoteNumber, totalAmount: quotation.totalAmount },
      },
    });

    return NextResponse.json(quotation, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create quotation", details: error.message }, { status: 500 });
  }
}
