"use client";

/**
 * SurvivorDropdownPicker — visual photo-card grid replacing the plain <select>
 * for survivor_dropdown challenge submissions. Designed for mobile: 3-column
 * grid, large tap targets, photo avatar with name below.
 *
 * Stores the selected castaway id in a hidden input for native form submission.
 */

import { useState } from "react";

interface CastawayOption {
  id: string;
  name: string;
  photo_url?: string | null;
}

interface SurvivorDropdownPickerProps {
  /** The form input name (e.g. "response"). */
  name: string;
  options: CastawayOption[];
  /** Pre-selected castaway id (for edit mode). */
  defaultValue?: string;
  required?: boolean;
}

export default function SurvivorDropdownPicker({
  name,
  options,
  defaultValue = "",
  required,
}: SurvivorDropdownPickerProps) {
  const [selected, setSelected] = useState(defaultValue);

  const selectedCastaway = options.find((c) => c.id === selected);

  return (
    <div className="space-y-3">
      {/* Hidden input carries the value for form submission */}
      <input type="hidden" name={name} value={selected} required={required} />

      {selected ? (
        /* ── Selected state: show chosen castaway + Change button ── */
        <div className="flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/5 px-3 py-2.5">
          <CastawayAvatar castaway={selectedCastaway!} size="sm" />
          <span className="flex-1 text-sm font-semibold">{selectedCastaway!.name}</span>
          <button
            type="button"
            onClick={() => setSelected("")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-2 shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        /* ── Unselected state: photo grid ── */
        <div
          role="listbox"
          aria-label="Select a castaway"
          className="grid grid-cols-3 gap-2"
        >
          {options.map((castaway) => (
            <button
              key={castaway.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => setSelected(castaway.id)}
              className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-transparent bg-muted p-2.5 text-center transition-colors hover:bg-muted/70 active:border-primary active:bg-primary/10 min-h-[80px]"
            >
              <CastawayAvatar castaway={castaway} size="lg" />
              <span className="text-xs font-medium leading-tight line-clamp-2 w-full">
                {castaway.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CastawayAvatar({
  castaway,
  size,
}: {
  castaway: CastawayOption;
  size: "sm" | "lg";
}) {
  const dim = size === "lg" ? "w-14 h-14" : "w-8 h-8";
  const initials = castaway.name.charAt(0).toUpperCase();

  return castaway.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={castaway.photo_url}
      alt={castaway.name}
      className={`${dim} rounded-full object-cover shrink-0`}
    />
  ) : (
    <div
      className={`${dim} rounded-full bg-primary/20 flex items-center justify-center shrink-0`}
      aria-hidden="true"
    >
      <span className="text-sm font-bold text-primary">{initials}</span>
    </div>
  );
}
