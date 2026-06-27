import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = file.name.split(".").pop();
    const filename = `${uuid()}.${ext}`;
    const filepath = join(process.cwd(), "public", "uploads", "images", filename);

    await writeFile(filepath, buffer);

    return NextResponse.json({
      url: `/uploads/images/${filename}`,
      filename,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
