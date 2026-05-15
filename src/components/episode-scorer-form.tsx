"use client";

import { useState } from "react";
import { addEpisodeEventAction } from "@/app/league/[id]/admin/episode/[num]/actions";
import SubmitButton from "./submit-button";
import type { Castaway } from "@/lib/castaways";
import type { ScoringRule } from "@/lib/scoring-rules";
import Link from "next/link";

interface EpisodeScorerFormProps {
  leagueId: string;
  episodeNumber: number;
  castaways: Castaway[];
  rules: ScoringRule[];
}

export default function EpisodeScorerForm({
  leagueId,
  episodeNumber,
  castaways,
  rules,
}: EpisodeScorerFormProps) {
  const [selectedCastawayId, setSelectedCastawayId] = useState<string>("");
  const [selectedRuleId, setSelectedRuleId] = useState<string>("");

  if (castaways.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active castaways. Add castaways in{" "}
        <Link href={`/league/${leagueId}/admin/castaways`} className="underline">
          Castaway Management
        </Link>
        .
      </p>
    );
  }

  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No scoring rules. Add rules in{" "}
        <Link href={`/league/${leagueId}/admin/rules`} className="underline">
          Scoring Rules
        </Link>
        .
      </p>
    );
  }

  const selectedRule = rules.find((r) => r.id === selectedRuleId);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <form action={addEpisodeEventAction} className="space-y-4">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="episode_number" value={episodeNumber} />
        <input
          type="hidden"
          name="points"
          value={selectedRule?.points ?? 0}
        />

        {/* Castaway grid */}
        <fieldset>
          <legend className="text-sm font-medium mb-2">Select Castaway</legend>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {castaways.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCastawayId(c.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-colors min-h-[44px] ${
                  selectedCastawayId === c.id
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                }`}
              >
                {c.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photo_url}
                    alt={c.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-xs text-center leading-tight font-medium">
                  {c.name}
                </span>
              </button>
            ))}
          </div>
          {/* Hidden radio to carry the value in form submission */}
          <input
            type="hidden"
            name="castaway_id"
            value={selectedCastawayId}
          />
        </fieldset>

        {/* Rule selector */}
        <fieldset>
          <legend className="text-sm font-medium mb-2">Select Scoring Rule</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {rules.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => setSelectedRuleId(rule.id)}
                className={`flex items-center justify-between rounded-lg border-2 px-3 py-2 transition-colors min-h-[44px] ${
                  selectedRuleId === rule.id
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                }`}
              >
                <span className="text-sm font-medium">{rule.name}</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    rule.points < 0 ? "text-destructive" : "text-green-700"
                  }`}
                >
                  {rule.points > 0 ? `+${rule.points}` : rule.points}
                </span>
              </button>
            ))}
          </div>
          <input type="hidden" name="rule_id" value={selectedRuleId} />
        </fieldset>

        {/* Preview */}
        {selectedCastawayId && selectedRule && (
          <div className="rounded bg-muted px-3 py-2 text-sm">
            <span className="font-medium">
              {castaways.find((c) => c.id === selectedCastawayId)?.name}
            </span>{" "}
            — {selectedRule.name}{" "}
            <span
              className={`font-semibold ${
                selectedRule.points < 0 ? "text-destructive" : "text-green-700"
              }`}
            >
              ({selectedRule.points > 0 ? "+" : ""}
              {selectedRule.points} pts)
            </span>
          </div>
        )}

        <SubmitButton
          pendingText="Recording…"
          disabled={!selectedCastawayId || !selectedRuleId}
          className="w-full rounded bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Record Event
        </SubmitButton>
      </form>
    </div>
  );
}
