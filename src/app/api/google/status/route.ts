import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getUser(req);

  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const token = await prisma.googleToken.findUnique({
    where: { userId: user.id },
  });

  return NextResponse.json({
    connected: !!token,
  });
}
