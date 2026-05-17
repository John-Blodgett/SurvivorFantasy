"use client";

import { useState } from "react";
import { updateCastawayAction, deleteCastawayAction } from "@/app/league/[id]/admin/castaways/actions";
import SubmitButton from "./submit-button";

interface TribeOption {
  id: string;
  name: string;
}

interface EditCastawayFormProps {
  leagueId: string;
  castaway: {
    id: string;
    name: string;
    tribe_id: string | null;
    photo_url: string | null;
  };
  tribes: TribeOption[];
  canDelete: boolean;
}

export default function EditCastawayForm({ leagueId, castaway, tribes, canDelete }: EditCastawayFormProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded border border-input px-2 py-1 text-xs hover:bg-muted transition-colors"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-border bg-muted/50 p-3 space-y-3">
      <form action={updateCastawayAction} className="space-y-2">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="castaway_id" value={castaway.id} />
        <input type="hidden" name="photo_url" value={castaway.photo_url ?? ""} />
        <div>
          <label className="text-xs font-medium">Name</label>
          <input
            name="name"
            type="text"
            defaultValue={castaway.name}
            required
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Tribe</label>
          <select
            name="tribe_id"
            defaultValue={castaway.tribe_id ?? ""}
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
          >
            <option value="">No tribe</option>
            {tribes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <SubmitButton
            pendingText="Saving…"
            className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50"
          >
            Save
          </SubmitButton>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded border border-input px-3 py-1 text-xs hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </form>

      {canDelete && (
        <form action={deleteCastawayAction} className="border-t border-border pt-2">
          <input type="hidden" name="league_id" value={leagueId} />
          <input type="hidden" name="castaway_id" value={castaway.id} />
          <SubmitButton
            pendingText="Deleting…"
            className="rounded border border-destructive text-destructive px-3 py-1 text-xs hover:bg-destructive/10 disabled:opacity-50"
          >
            Delete Castaway
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
