"use client";

import { useState } from "react";
import { addBatchEventsAction } from "@/app/league/[id]/admin/episode/[num]/actions";
import SubmitButton from "./submit-button";

interface BatchCastaway {
  id: string;
  name: string;
  tribe_name: string | null;
}

interface BatchScoringRule {
  id: string;
  name: string;
  points: number;
}

interface BatchScoringFormProps {
  leagueId: string;
  episodeNumber: number;
  castaways: BatchCastaway[];
  scoringRules: BatchScoringRule[];
}

export default function BatchScoringForm({
  leagueId,
  episodeNumber,
  castaways,
  scoringRules,
}: BatchScoringFormProps) {
  const [selectedCastawayIds, setSelectedCastawayIds] = useState<Set<string>>(new Set());
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());

  function toggleCastaway(id: string) {
    setSelectedCastawayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRule(id: string) {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllCastaways() {
    if (selectedCastawayIds.size === castaways.length) {
      setSelectedCastawayIds(new Set());
    } else {
      setSelectedCastawayIds(new Set(castaways.map((c) => c.id)));
    }
  }

  function selectAllRules() {
    if (selectedRuleIds.size === scoringRules.length) {
      setSelectedRuleIds(new Set());
    } else {
      setSelectedRuleIds(new Set(scoringRules.map((r) => r.id)));
    }
  }

  const eventCount = selectedCastawayIds.size * selectedRuleIds.size;

  // Get unique tribe names for quick-select buttons
  const tribeNames = Array.from(new Set(castaways.map((c) => c.tribe_name).filter((t): t is string => t !== null)));

  function selectTribe(tribeName: string) {
    const tribeIds = new Set(
      castaways.filter((c) => c.tribe_name === tribeName).map((c) => c.id)
    );
    // If all tribe members are already selected, deselect them
    const allSelected = Array.from(tribeIds).every((id) => selectedCastawayIds.has(id));
    setSelectedCastawayIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        tribeIds.forEach((id) => next.delete(id));
      } else {
        tribeIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  if (castaways.length === 0 || scoringRules.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <form action={addBatchEventsAction} className="space-y-4">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="episode_number" value={episodeNumber} />
        <input type="hidden" name="castaway_ids" value={JSON.stringify(Array.from(selectedCastawayIds))} />
        <input type="hidden" name="rule_ids" value={JSON.stringify(Array.from(selectedRuleIds))} />

        {/* Castaway multi-select */}
        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-sm font-medium">Select Castaways</legend>
            <button
              type="button"
              onClick={selectAllCastaways}
              className="text-xs text-primary hover:underline"
            >
              {selectedCastawayIds.size === castaways.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          {/* Tribe quick-select buttons */}
          {tribeNames.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {tribeNames.map((tribe) => {
                const tribeIds = castaways.filter((c) => c.tribe_name === tribe).map((c) => c.id);
                const allSelected = tribeIds.every((id) => selectedCastawayIds.has(id));
                return (
                  <button
                    key={tribe}
                    type="button"
                    onClick={() => selectTribe(tribe)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      allSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {tribe}
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {castaways.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 cursor-pointer transition-colors min-h-[44px] ${
                  selectedCastawayIds.has(c.id)
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedCastawayIds.has(c.id)}
                  onChange={() => toggleCastaway(c.id)}
                  className="rounded border-input h-4 w-4 accent-primary"
                  aria-label={`Select ${c.name}`}
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium block truncate">{c.name}</span>
                  {c.tribe_name && (
                    <span className="text-xs text-muted-foreground block truncate">{c.tribe_name}</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Rule multi-select */}
        <fieldset>
          <div className="flex items-center justify-between mb-2">
            <legend className="text-sm font-medium">Select Scoring Rules</legend>
            <button
              type="button"
              onClick={selectAllRules}
              className="text-xs text-primary hover:underline"
            >
              {selectedRuleIds.size === scoringRules.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {scoringRules.map((rule) => (
              <label
                key={rule.id}
                className={`flex items-center justify-between rounded-lg border-2 px-3 py-2 cursor-pointer transition-colors min-h-[44px] ${
                  selectedRuleIds.has(rule.id)
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedRuleIds.has(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                    className="rounded border-input h-4 w-4 accent-primary"
                    aria-label={`Select ${rule.name}`}
                  />
                  <span className="text-sm font-medium">{rule.name}</span>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    rule.points < 0 ? "text-destructive" : "text-green-700"
                  }`}
                >
                  {rule.points > 0 ? `+${rule.points}` : rule.points}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Preview */}
        {eventCount > 0 && (
          <div className="rounded bg-muted px-3 py-2 text-sm">
            This will create <span className="font-semibold">{eventCount}</span> event{eventCount !== 1 ? "s" : ""}{" "}
            ({selectedCastawayIds.size} castaway{selectedCastawayIds.size !== 1 ? "s" : ""} × {selectedRuleIds.size} rule{selectedRuleIds.size !== 1 ? "s" : ""})
          </div>
        )}

        <SubmitButton
          pendingText="Recording batch…"
          disabled={eventCount === 0}
          className="w-full rounded bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Record {eventCount} Event{eventCount !== 1 ? "s" : ""}
        </SubmitButton>
      </form>
    </div>
  );
}
