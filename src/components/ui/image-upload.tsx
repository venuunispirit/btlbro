"use client";

import { useState, useRef } from "react";
import { Upload, Link as LinkIcon, X, Loader2 } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { apiFetch } from "@/lib/api";

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
}

export function ImageUpload({ value, onChange }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch("/api/upload", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      onChange(data.url);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUrlSubmit = () => {
    if (urlValue) onChange(urlValue);
    setShowUrlInput(false);
    setUrlValue("");
  };

  if (value) {
    return (
      <div className="relative inline-block">
        <img src={value} alt="Preview" className="h-24 w-24 object-cover rounded-lg border border-white/10" />
        <button type="button" onClick={() => onChange("")} className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span className="ml-1">{uploading ? "Uploading..." : "Upload"}</span>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowUrlInput(!showUrlInput)}>
          <LinkIcon className="h-4 w-4" />
          <span className="ml-1">URL</span>
        </Button>
      </div>
      {showUrlInput && (
        <div className="flex gap-2">
          <Input placeholder="https://example.com/logo.png" value={urlValue} onChange={e => setUrlValue(e.target.value)} />
          <Button type="button" size="sm" onClick={handleUrlSubmit}>Add</Button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
    </div>
  );
}
