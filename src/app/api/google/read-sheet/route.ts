import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { readSheetData } from "@/lib/google";

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { spreadsheetId, range } = await req.json();
    const data = await readSheetData(user.id, spreadsheetId, range);

    if (!data) {
      return NextResponse.json({ error: "Not connected to Google" }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Error reading sheet:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
