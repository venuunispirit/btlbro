import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/get-user";
import { listDriveFiles, getEmbedUrl } from "@/lib/google";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await listDriveFiles(
      user.id,
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );
    if (!files) {
      return NextResponse.json({ error: "Not connected to Google" }, { status: 400 });
    }

    const items = files.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      iconLink: f.iconLink,
      size: f.size,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      owner: f.owners?.[0]?.displayName,
      embedUrl: getEmbedUrl(f.id, f.mimeType),
      isSheet: f.mimeType === "application/vnd.google-apps.spreadsheet",
      isSlide: f.mimeType === "application/vnd.google-apps.presentation",
    }));

    return NextResponse.json({ files: items });
  } catch (err: any) {
    console.error("Error listing Drive files:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
