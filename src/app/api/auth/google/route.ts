import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { getAuthUrl } from "@/lib/google";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = getAuthUrl();
  return NextResponse.json({ url });
}
