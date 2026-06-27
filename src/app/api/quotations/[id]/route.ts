import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createQuotationSchema } from "@/lib/validations";
import { getUser } from "@/lib/get-user";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    if (body.status) {
      const quotation = await prisma.quotation.update({
        where: { id },
        data: { status: body.status },
        include: { brand: true, project: true },
      });

      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `STATUS_CHANGED_TO_${body.status}`,
          module: "QUOTATIONS",
          entityId: id,
          entityType: "Quotation",
          details: { quoteNumber: quotation.quoteNumber, newStatus: body.status },
        },
      });

      return NextResponse.json(quotation);
    }

    const validated = createQuotationSchema.partial().parse(body);

    let subtotal = 0;
    const taxRate = validated.taxRate || 18;
    if (validated.items) {
      subtotal = validated.items.reduce(
        (sum, item) => sum + (item.quantity || 1) * item.unitPrice,
        0
      );
    }

    const taxAmount = (subtotal * taxRate) / 100;
    const totalAmount = subtotal + taxAmount;

    await prisma.quotationItem.deleteMany({ where: { quotationId: id } });

    const quotation = await prisma.quotation.update({
      where: { id },
      data: {
        ...(validated.title && { title: validated.title }),
        ...(validated.projectId && { projectId: validated.projectId }),
        ...(validated.brandId && { brandId: validated.brandId }),
        ...(validated.taxRate !== undefined && { taxRate }),
        ...(validated.currency && { currency: validated.currency }),
        ...(validated.terms !== undefined && { terms: validated.terms || null }),
        ...(validated.notes !== undefined && { notes: validated.notes || null }),
        ...(validated.validUntil !== undefined && {
          validUntil: validated.validUntil ? new Date(validated.validUntil as any) : null,
        }),
        subtotal,
        taxAmount,
        totalAmount,
        ...(validated.items && {
          items: {
            create: validated.items.map((item) => ({
              description: item.description,
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice,
              totalPrice: (item.quantity || 1) * item.unitPrice,
              serviceId: item.serviceId || null,
              vendorId: item.vendorId || null,
            })),
          },
        }),
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
        action: "UPDATED",
        module: "QUOTATIONS",
        entityId: id,
        entityType: "Quotation",
        details: { quoteNumber: quotation.quoteNumber },
      },
    });

    return NextResponse.json(quotation);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: "Validation failed", details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update quotation" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    await prisma.quotationItem.deleteMany({ where: { quotationId: id } });
    await prisma.quotation.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "QUOTATIONS",
        entityId: id,
        entityType: "Quotation",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete quotation" }, { status: 500 });
  }
}
