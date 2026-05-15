"use client";

import { useState, useRef } from "react";
import { savePreferencesAction } from "@/app/league/[id]/preferences/actions";
import { Loader2 } from "lucide-react";

interface Castaway {
  id: string;
  name: string;
  tribe_id: string | null;
  photo_url: string | null;
}

interface Props {
  leagueId: string;
  castaways: Castaway[];
}

export default function DraftPreferencesForm({ leagueId, castaways }: Props) {
  const [ranked, setRanked] = useState<Castaway[]>(castaways);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dragOverIndex = useRef<number | null>(null);

  function handleDragStart(index: number) {
    setDraggingIndex(index);
  }

  function handleDragEnter(index: number) {
    dragOverIndex.current = index;
  }

  function handleDragEnd() {
    if (draggingIndex === null || dragOverIndex.current === null) {
      setDraggingIndex(null);
      return;
    }
    const from = draggingIndex;
    const to = dragOverIndex.current;
    if (from === to) {
      setDraggingIndex(null);
      return;
    }
    const updated = [...ranked];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setRanked(updated);
    setDraggingIndex(null);
    dragOverIndex.current = null;
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...ranked];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setRanked(updated);
  }

  function moveDown(index: number) {
    if (index === ranked.length - 1) return;
    const updated = [...ranked];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setRanked(updated);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    formData.set("ranked_castaways", JSON.stringify(ranked.map((c) => c.id)));
    await savePreferencesAction(formData);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="league_id" value={leagueId} />
      {/* ranked_castaways is set dynamically on submit */}

      <ol className="space-y-2" aria-label="Castaway rankings">
        {ranked.map((castaway, index) => (
          <li
            key={castaway.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 cursor-grab active:cursor-grabbing transition-opacity ${
              draggingIndex === index
                ? "opacity-40 border-primary"
                : "border-border"
            }`}
          >
            {/* Rank number */}
            <span className="text-sm font-semibold text-muted-foreground w-6 text-right shrink-0">
              {index + 1}
            </span>

            {/* Drag handle */}
            <span
              className="text-muted-foreground shrink-0 select-none"
              aria-hidden="true"
            >
              ⠿
            </span>

            {/* Photo */}
            <div className="w-9 h-9 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
              {castaway.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={castaway.photo_url}
                  alt={castaway.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs text-muted-foreground font-medium">
                  {castaway.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            {/* Name + tribe */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{castaway.name}</p>
            </div>

            {/* Up/down buttons for accessibility */}
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                aria-label={`Move ${castaway.name} up`}
                className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(index)}
                disabled={index === ranked.length - 1}
                aria-label={`Move ${castaway.name} down`}
                className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="submit"
        disabled={saving}
        className="rounded bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving…
          </span>
        ) : (
          "Save Rankings"
        )}
      </button>
    </form>
  );
}
