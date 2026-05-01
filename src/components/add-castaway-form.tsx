"use client";

import { useState } from "react";
import { addCastawayAction } from "@/app/admin/castaways/actions";
import PhotoUpload from "./photo-upload";

export default function AddCastawayForm() {
  const [photoUrl, setPhotoUrl] = useState<string>("");

  return (
    <form action={addCastawayAction} className="space-y-4">
      {/* Hidden field carries the uploaded photo URL */}
      <input type="hidden" name="photo_url" value={photoUrl} />

      <div className="flex gap-4 items-start">
        <PhotoUpload onUpload={setPhotoUrl} />

        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              Name <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. Jeff Probst"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tribe" className="text-sm font-medium">
              Tribe
            </label>
            <input
              id="tribe"
              name="tribe"
              type="text"
              placeholder="e.g. Tika"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Add Castaway
      </button>
    </form>
  );
}
