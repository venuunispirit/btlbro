import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUser } from "@/lib/get-user";
import bcrypt from "bcryptjs";

export async function GET(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { activityLogs: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await request.json();
    const { name, email, password, role } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, password required" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || "MEMBER",
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "CREATED",
        module: "SETTINGS",
        entityId: newUser.id,
        entityType: "User",
        details: { name: newUser.name, email: newUser.email, role: newUser.role },
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser(request as any);
    if (!user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");

    if (!userId) return NextResponse.json({ error: "User ID required" }, { status: 400 });
    if (userId === user.id) return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });

    await prisma.user.delete({ where: { id: userId } });

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "DELETED",
        module: "SETTINGS",
        entityId: userId,
        entityType: "User",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
