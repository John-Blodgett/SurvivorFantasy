"use client";

import { useState, useRef, useCallback } from "react";
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

  // Refs to each <li> so we can hit-test the pointer position against rows.
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // The index the dragged item currently hovers over.
  const dragOverIndex = useRef<number | null>(null);
  // The index being dragged (mirrors draggingIndex but readable in listeners).
  const dragFromIndex = useRef<number | null>(null);

  const setItemRef = useCallback(
    (index: number) => (el: HTMLLIElement | null) => {
      itemRefs.current[index] = el;
    },
    []
  );

  /** Moves the dragged item to a new position (immutably). */
  function reorder(from: number, to: number) {
    setRanked((prev) => {
      if (from === to || from < 0 || to < 0) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);
      return updated;
    });
  }

  /** Finds the row index whose vertical center is closest to a Y coordinate. */
  function indexAtY(clientY: number): number | null {
    let closest: number | null = null;
    let closestDist = Infinity;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return closest;
  }

  // ── Pointer-based drag (works for mouse AND touch) ──

  function handlePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    index: number
  ) {
    // Only respond to primary button / single touch.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();

    dragFromIndex.current = index;
    dragOverIndex.current = index;
    setDraggingIndex(index);

    // Capture the pointer so we keep receiving move/up even if the finger
    // slides off the handle.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragFromIndex.current === null) return;
    e.preventDefault();

    const over = indexAtY(e.clientY);
    if (over === null || over === dragOverIndex.current) return;

    const from = dragOverIndex.current;
    if (from === null) return;

    reorder(from, over);
    dragOverIndex.current = over;
    setDraggingIndex(over);
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragFromIndex.current === null) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture was already released
    }
    dragFromIndex.current = null;
    dragOverIndex.current = null;
    setDraggingIndex(null);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    reorder(index, index - 1);
  }

  function moveDown(index: number) {
    if (index === ranked.length - 1) return;
    reorder(index, index + 1);
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
            ref={setItemRef(index)}
            className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-opacity ${
              draggingIndex === index
                ? "opacity-60 border-primary shadow-sm"
                : "border-border"
            }`}
          >
            {/* Rank number */}
            <span className="text-sm font-semibold text-muted-foreground w-6 text-right shrink-0">
              {index + 1}
            </span>

            {/* Drag handle — pointer events work for mouse + touch */}
            <button
              type="button"
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              aria-label={`Drag to reorder ${castaway.name}`}
              className="text-muted-foreground shrink-0 select-none cursor-grab active:cursor-grabbing touch-none px-1 py-2 -my-2 leading-none"
            >
              ⠿
            </button>

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

            {/* Up/down buttons for accessibility + fallback */}
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
