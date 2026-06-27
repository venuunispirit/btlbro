import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const presentation = await prisma.presentation.findUnique({
      where: { id },
      include: {
        project: { include: { brand: true } },
        slides: {
          orderBy: { order: "asc" },
          include: { elements: { orderBy: { zIndex: "asc" } } },
        },
      },
    });

    if (!presentation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pptx = new PptxGenJS();
    pptx.title = presentation.title;
    pptx.author = "CRM Pro";

    for (const slide of presentation.slides) {
      const pptSlide = pptx.addSlide();
      pptSlide.background = { color: slide.background.replace("#", "") };

      if (slide.transition !== "NONE") {
        (pptSlide as any).transition = { type: slide.transition.toLowerCase() };
      }

      for (const element of slide.elements) {
        const content = element.content as any;
        if (element.type === "TEXT") {
          pptSlide.addText(content?.text || "", {
            x: element.x / 960 * 10,
            y: element.y / 540 * 5.625,
            w: element.width / 960 * 10,
            h: element.height / 540 * 5.625,
            fontSize: (content?.fontSize || 24) / 2,
            fontFace: content?.fontFamily || "Arial",
            color: content?.color?.replace("#", "") || "000000",
            bold: content?.fontWeight === "bold",
            align: content?.textAlign || "left",
          });
        } else if (element.type === "IMAGE" && content?.src) {
          const fs = await import("fs");
          const path = await import("path");
          const imgPath = path.join(process.cwd(), "public", content.src);
          if (fs.existsSync(imgPath)) {
            pptSlide.addImage({
              path: imgPath,
              x: element.x / 960 * 10,
              y: element.y / 540 * 5.625,
              w: element.width / 960 * 10,
              h: element.height / 540 * 5.625,
            });
          }
        } else if (element.type === "SHAPE") {
          pptSlide.addShape("rect" as any, {
            x: element.x / 960 * 10,
            y: element.y / 540 * 5.625,
            w: element.width / 960 * 10,
            h: element.height / 540 * 5.625,
            fill: { color: content?.fill?.replace("#", "") || "6366F1" },
          });
        }
      }
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" });

    return new Response(Buffer.from(buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${presentation.title}.pptx"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
