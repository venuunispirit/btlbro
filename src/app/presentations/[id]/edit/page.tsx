"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Type, Image, Square, Download } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface SlideElement {
  id?: string;
  type: "TEXT" | "IMAGE" | "SHAPE";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  content: any;
}

interface Slide {
  id: string;
  order: number;
  transition: string;
  background: string;
  elements: SlideElement[];
}

interface Presentation {
  id: string;
  title: string;
  description?: string;
  project: { name: string; brand: { name: string } };
  slides: Slide[];
}

export default function PresentationEditorPage() {
  const params = useParams();
  const id = params.id as string;
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [selectedElement, setSelectedElement] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchPresentation(); }, [id]);

  const fetchPresentation = async () => {
    try {
      const res = await apiFetch(`/api/presentations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setPresentation(data);
      }
    } finally { setLoading(false); }
  };

  const addSlide = async () => {
    if (!presentation) return;
    await apiFetch(`/api/presentations/${id}/slides`, {
      method: "POST",
      body: JSON.stringify({ order: presentation.slides.length }),
    });
    fetchPresentation();
  };

  const addElement = async (type: "TEXT" | "IMAGE" | "SHAPE") => {
    if (!presentation) return;
    const slide = presentation.slides[activeSlide];
    if (!slide) return;

    const defaults: Record<string, any> = {
      TEXT: { content: { text: "New Text", fontSize: 24, fontFamily: "Arial", color: "#000000", fontWeight: "normal", textAlign: "left" } },
      IMAGE: { content: { src: "", alt: "Image" } },
      SHAPE: { content: { fill: "#6366f1", stroke: "none", borderRadius: 0 } },
    };

    await apiFetch(`/api/slides/${slide.id}/elements`, {
      method: "POST",
      body: JSON.stringify({
        type,
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 100,
        width: type === "TEXT" ? 400 : type === "IMAGE" ? 300 : 200,
        height: type === "TEXT" ? 60 : type === "IMAGE" ? 200 : 150,
        zIndex: slide.elements.length,
        content: defaults[type],
      }),
    });
    fetchPresentation();
  };

  const updateElement = async (slideId: string, elementIndex: number, updates: Partial<SlideElement>) => {
    if (!presentation) return;
    const slide = presentation.slides.find(s => s.id === slideId);
    if (!slide) return;
    const element = slide.elements[elementIndex];
    if (!element?.id) return;

    await apiFetch(`/api/elements/${element.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...element, ...updates }),
    });
    fetchPresentation();
  };

  const deleteElement = async (slideId: string, elementIndex: number) => {
    if (!presentation) return;
    const slide = presentation.slides.find(s => s.id === slideId);
    if (!slide) return;
    const element = slide.elements[elementIndex];
    if (!element?.id) return;

    await apiFetch(`/api/elements/${element.id}`, { method: "DELETE" });
    setSelectedElement(null);
    fetchPresentation();
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
    if (res.ok) {
      const { url } = await res.json();
      if (!presentation) return;
      const slide = presentation.slides[activeSlide];
      if (!slide) return;
      await apiFetch(`/api/slides/${slide.id}/elements`, {
        method: "POST",
        body: JSON.stringify({
          type: "IMAGE", x: 100, y: 100, width: 400, height: 300,
          zIndex: slide.elements.length,
          content: { src: url, alt: file.name },
        }),
      });
      fetchPresentation();
    }
  };

  const updateSlide = async (slideId: string, updates: Partial<Slide>) => {
    await apiFetch(`/api/slides/${slideId}`, { method: "PATCH", body: JSON.stringify(updates) });
    fetchPresentation();
  };

  const exportPPTX = async () => {
    const res = await fetch(`/api/presentations/${id}/export`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${presentation?.title || "presentation"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  if (loading || !presentation) {
    return <AppShell><div className="text-center py-12 text-muted-foreground">Loading editor...</div></AppShell>;
  }

  const currentSlide = presentation.slides[activeSlide];

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-4rem)] gap-4">
        {/* Slide Panel */}
        <div className="w-48 border-r bg-card p-3 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <Link href="/presentations" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{presentation.title}</p>
          <div className="space-y-2">
            {presentation.slides.map((slide, i) => (
              <div
                key={slide.id}
                onClick={() => { setActiveSlide(i); setSelectedElement(null); }}
                className={`aspect-video rounded border-2 cursor-pointer overflow-hidden ${i === activeSlide ? "border-primary" : "border-border hover:border-primary/50"}`}
                style={{ background: slide.background }}
              >
                <div className="h-full w-full p-2 text-[8px] overflow-hidden">
                  {slide.elements.filter(e => e.type === "TEXT").map((el, j) => (
                    <div key={j} style={{ fontSize: "8px", color: el.content?.color || "#000" }}>
                      {el.content?.text?.substring(0, 30)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="w-full mt-2" onClick={addSlide}>
            <Plus className="mr-1 h-3 w-3" /> Add Slide
          </Button>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center bg-muted/50 p-4">
          <div className="bg-white shadow-xl rounded-lg overflow-hidden" style={{ width: 960, height: 540 }}>
            <div className="relative w-full h-full" style={{ background: currentSlide?.background || "#ffffff" }}>
              {currentSlide?.elements.map((el, i) => (
                <div
                  key={i}
                  className={`absolute cursor-move ${selectedElement === i ? "ring-2 ring-primary" : ""}`}
                  style={{ left: el.x, top: el.y, width: el.width, height: el.height, zIndex: el.zIndex }}
                  onClick={(e) => { e.stopPropagation(); setSelectedElement(i); }}
                >
                  {el.type === "TEXT" && (
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      style={{
                        fontSize: el.content?.fontSize || 24,
                        fontFamily: el.content?.fontFamily || "Arial",
                        color: el.content?.color || "#000000",
                        fontWeight: el.content?.fontWeight || "normal",
                        textAlign: el.content?.textAlign || "left",
                        width: "100%", height: "100%", outline: "none",
                      }}
                      onBlur={(e) => {
                        updateElement(currentSlide.id, i, {
                          content: { ...el.content, text: e.currentTarget.textContent || "" },
                        });
                      }}
                    >
                      {el.content?.text}
                    </div>
                  )}
                  {el.type === "IMAGE" && el.content?.src && (
                    <img src={el.content.src} alt={el.content.alt || ""} className="w-full h-full object-contain" />
                  )}
                  {el.type === "SHAPE" && (
                    <div className="w-full h-full" style={{
                      background: el.content?.fill || "#6366f1",
                      border: el.content?.stroke !== "none" ? `2px solid ${el.content?.stroke}` : "none",
                      borderRadius: el.content?.borderRadius || 0,
                    }} />
                  )}
                </div>
              ))}
              {currentSlide?.elements.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30 text-lg">
                  Click elements below to add content
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Properties Panel */}
        <div className="w-72 border-l bg-card p-4 overflow-y-auto">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Elements</h3>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => addElement("TEXT")}><Type className="mr-1 h-3 w-3" /> Text</Button>
                <Button size="sm" variant="outline" onClick={() => addElement("SHAPE")}><Square className="mr-1 h-3 w-3" /> Shape</Button>
                <label>
                  <Button size="sm" variant="outline" asChild><span><Image className="mr-1 h-3 w-3" /> Image</span></Button>
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadImage} />
                </label>
              </div>
            </div>

            {selectedElement !== null && currentSlide?.elements[selectedElement] && (
              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-medium">Properties</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">X</label>
                    <Input type="number" value={Math.round(currentSlide.elements[selectedElement].x)} onChange={e => updateElement(currentSlide.id, selectedElement, { x: parseFloat(e.target.value) || 0 })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Y</label>
                    <Input type="number" value={Math.round(currentSlide.elements[selectedElement].y)} onChange={e => updateElement(currentSlide.id, selectedElement, { y: parseFloat(e.target.value) || 0 })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Width</label>
                    <Input type="number" value={Math.round(currentSlide.elements[selectedElement].width)} onChange={e => updateElement(currentSlide.id, selectedElement, { width: parseFloat(e.target.value) || 100 })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Height</label>
                    <Input type="number" value={Math.round(currentSlide.elements[selectedElement].height)} onChange={e => updateElement(currentSlide.id, selectedElement, { height: parseFloat(e.target.value) || 50 })} className="h-8 text-xs" />
                  </div>
                </div>

                {currentSlide.elements[selectedElement].type === "TEXT" && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Font Size</label>
                      <Input type="number" value={currentSlide.elements[selectedElement].content?.fontSize || 24} onChange={e => updateElement(currentSlide.id, selectedElement, {
                        content: { ...currentSlide.elements[selectedElement].content, fontSize: parseInt(e.target.value) || 24 },
                      })} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Color</label>
                      <Input type="color" value={currentSlide.elements[selectedElement].content?.color || "#000000"} onChange={e => updateElement(currentSlide.id, selectedElement, {
                        content: { ...currentSlide.elements[selectedElement].content, color: e.target.value },
                      })} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Font Family</label>
                      <Select value={currentSlide.elements[selectedElement].content?.fontFamily || "Arial"} onChange={e => updateElement(currentSlide.id, selectedElement, {
                        content: { ...currentSlide.elements[selectedElement].content, fontFamily: e.target.value },
                      })} options={[{ value: "Arial", label: "Arial" }, { value: "Helvetica", label: "Helvetica" }, { value: "Georgia", label: "Georgia" }, { value: "Times New Roman", label: "Times New Roman" }, { value: "Courier New", label: "Courier New" }, { value: "Verdana", label: "Verdana" }]} />
                    </div>
                  </div>
                )}

                {currentSlide.elements[selectedElement].type === "SHAPE" && (
                  <div>
                    <label className="text-xs text-muted-foreground">Fill Color</label>
                    <Input type="color" value={currentSlide.elements[selectedElement].content?.fill || "#6366f1"} onChange={e => updateElement(currentSlide.id, selectedElement, {
                      content: { ...currentSlide.elements[selectedElement].content, fill: e.target.value },
                    })} className="h-8 text-xs" />
                  </div>
                )}

                <Button size="sm" variant="destructive" className="w-full" onClick={() => deleteElement(currentSlide.id, selectedElement)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Delete Element
                </Button>
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium mb-2">Slide Settings</h3>
              <div>
                <label className="text-xs text-muted-foreground">Background</label>
                <Input type="color" value={currentSlide?.background || "#ffffff"} onChange={e => {
                  if (currentSlide) updateSlide(currentSlide.id, { background: e.target.value });
                }} className="h-8 text-xs" />
              </div>
              <div className="mt-2">
                <label className="text-xs text-muted-foreground">Transition</label>
                <Select value={currentSlide?.transition || "FADE"} onChange={e => {
                  if (currentSlide) updateSlide(currentSlide.id, { transition: e.target.value });
                }} options={[{ value: "NONE", label: "None" }, { value: "FADE", label: "Fade" }, { value: "SLIDE", label: "Slide" }, { value: "ZOOM", label: "Zoom" }]} />
              </div>
            </div>

            <div className="border-t pt-4">
              <Button className="w-full" onClick={exportPPTX}>
                <Download className="mr-2 h-4 w-4" /> Export as .pptx
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
