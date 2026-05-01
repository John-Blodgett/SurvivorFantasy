"use client";

import { useState } from "react";
import { addCastawayAction } from "@/app/league/[id]/admin/castaways/actions";
import PhotoUpload from "./photo-upload";
import SubmitButton from "./submit-button";

interface AddCastawayFormProps {
  leagueId: string;
}

export default function AddCastawayForm({ leagueId }: AddCastawayFormProps) {
  const [photoUrl, setPhotoUrl] = useState<string>("");

  return (
    <form action={addCastawayAction} className="space-y-4">
      <input type="hidden" name="league_id" value={leagueId} />
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

      <SubmitButton
        pendingText="Adding…"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        Add Castaway
      </SubmitButton>
    </form>
  );
}
