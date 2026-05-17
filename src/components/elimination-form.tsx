"use client";

import { useState } from "react";
import { eliminateCastawaysAction } from "@/app/league/[id]/admin/episode/[num]/actions";
import SubmitButton from "./submit-button";

interface EliminationFormProps {
  leagueId: string;
  episodeNumber: number;
  castaways: Array<{ id: string; name: string }>;
}

export default function EliminationForm({ leagueId, episodeNumber, castaways }: EliminationFormProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={eliminateCastawaysAction} className="space-y-3">
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="episode_number" value={episodeNumber} />
      <input type="hidden" name="castaway_ids" value={JSON.stringify(Array.from(selected))} />

      {castaways.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active castaways to eliminate.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {castaways.map((c) => (
            <label
              key={c.id}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${
                selected.has(c.id)
                  ? "border-destructive bg-destructive/10 text-destructive font-medium"
                  : "border-border hover:bg-muted"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="sr-only"
              />
              {c.name}
            </label>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <SubmitButton
          pendingText="Eliminating…"
          className="rounded bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium hover:bg-destructive/90 transition-colors min-h-[44px] disabled:opacity-50"
        >
          Eliminate {selected.size} castaway{selected.size !== 1 ? "s" : ""}
        </SubmitButton>
      )}
    </form>
  );
}
