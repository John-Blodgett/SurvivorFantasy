"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface PhotoUploadProps {
  /** Called with the public URL once upload succeeds */
  onUpload: (url: string) => void;
}

export default function PhotoUpload({ onUpload }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Local preview
    setPreview(URL.createObjectURL(file));
    setError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `castaways/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("photos")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("photos").getPublicUrl(path);
      onUpload(data.publicUrl);
    } catch (err) {
      setError("Photo upload failed. You can still add the castaway without a photo.");
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className="w-24 h-24 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer bg-muted hover:bg-muted/70 transition-colors"
        onClick={() => inputRef.current?.click()}
        role="button"
        aria-label="Upload castaway photo"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground text-center px-2">
            {uploading ? "Uploading…" : "Tap to upload photo"}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        aria-label="Photo file input"
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
