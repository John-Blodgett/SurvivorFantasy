"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { makeDraftPickAction } from "@/app/league/[id]/draft/actions";

interface Player {
  id: string;
  display_name: string;
}

interface Castaway {
  id: string;
  name: string;
  tribe: string | null;
  photo_url: string | null;
  is_eliminated: boolean;
}

interface Pick {
  id: string;
  player_id: string;
  castaway_id: string;
  pick_number: number;
  picked_at: string;
}

interface DraftState {
  id: string;
  status: string;
  currentPickIndex: number;
}

interface Props {
  leagueId: string;
  currentUserId: string;
  draft: DraftState;
  players: Player[];
  snakeOrder: string[];
  availableCastaways: Castaway[];
  allCastaways: Castaway[];
  existingPicks: Pick[];
  pickTimerSeconds: number;
  rosterSize: number;
}

export default function DraftRoom({
  leagueId,
  currentUserId,
  draft: initialDraft,
  players,
  snakeOrder,
  availableCastaways: initialAvailable,
  allCastaways,
  existingPicks,
  pickTimerSeconds,
  rosterSize,
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [picks, setPicks] = useState<Pick[]>(existingPicks);
  const [available, setAvailable] = useState<Castaway[]>(initialAvailable);
  const [timeLeft, setTimeLeft] = useState(pickTimerSeconds);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPickFiredRef = useRef(false);

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));
  const castawayMap = Object.fromEntries(allCastaways.map((c) => [c.id, c]));

  const currentPickIndex = draft.currentPickIndex;
  const isComplete = draft.status === "complete";
  const currentPickerId =
    !isComplete && currentPickIndex < snakeOrder.length
      ? snakeOrder[currentPickIndex]
      : null;
  const isMyTurn = currentPickerId === currentUserId;

  // Reset timer when pick index changes
  useEffect(() => {
    setTimeLeft(pickTimerSeconds);
    autoPickFiredRef.current = false;
  }, [currentPickIndex, pickTimerSeconds]);

  // Countdown timer
  useEffect(() => {
    if (isComplete || !currentPickerId) return;

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentPickIndex, isComplete, currentPickerId]);

  // Auto-pick when timer hits 0 — any client can trigger this; the API
  // guards against duplicate/stale requests via pickIndex comparison.
  const handleAutoPick = useCallback(async () => {
    if (autoPickFiredRef.current) return;
    autoPickFiredRef.current = true;
    setPicking(true);
    try {
      const res = await fetch("/api/draft/auto-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, pickIndex: currentPickIndex }),
      });
      const data = await res.json();
      if (!res.ok && data.error) setError(data.error);
    } catch {
      setError("Failed to auto-pick. Please refresh.");
    }
    setPicking(false);
  }, [leagueId, currentPickIndex]);

  useEffect(() => {
    if (timeLeft === 0 && !picking && !isComplete && currentPickerId) {
      handleAutoPick();
    }
  }, [timeLeft, picking, isComplete, currentPickerId, handleAutoPick]);

  // Supabase Realtime subscription on draft_picks
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`draft-picks-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_picks",
        },
        (payload) => {
          const newPick = payload.new as Pick;
          setPicks((prev) => {
            if (prev.some((p) => p.id === newPick.id)) return prev;
            return [...prev, newPick];
          });
          // Remove from available
          setAvailable((prev) =>
            prev.filter((c) => c.id !== newPick.castaway_id)
          );
          // Advance pick index
          setDraft((prev) => ({
            ...prev,
            currentPickIndex: newPick.pick_number,
          }));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const updated = payload.new as {
            status: string;
            current_pick_index: number;
          };
          setDraft((prev) => ({
            ...prev,
            status: updated.status,
            currentPickIndex: updated.current_pick_index,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  async function handlePick(castawayId: string) {
    if (!isMyTurn || picking) return;
    setPicking(true);
    setError(null);

    const formData = new FormData();
    formData.set("league_id", leagueId);
    formData.set("castaway_id", castawayId);

    const result = await makeDraftPickAction(formData);
    if (result.error) {
      setError(result.error);
    }
    setPicking(false);
  }

  // Build team assignments from picks
  const teamByPlayer: Record<string, string[]> = {};
  for (const pick of picks) {
    if (!teamByPlayer[pick.player_id]) teamByPlayer[pick.player_id] = [];
    teamByPlayer[pick.player_id].push(pick.castaway_id);
  }

  const totalPicks = snakeOrder.length;
  const progressPct = totalPicks > 0 ? (picks.length / totalPicks) * 100 : 0;

  return (
    <main className="p-4 max-w-5xl mx-auto space-y-6">
      {/* Status bar */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {isComplete ? (
          <p className="text-sm font-semibold text-green-700">
            ✓ Draft complete! All teams have been assigned.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-medium">
                  Pick {picks.length + 1} of {totalPicks}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isMyTurn ? (
                    <span className="text-primary font-semibold">
                      Your turn to pick!
                    </span>
                  ) : (
                    <>
                      Waiting for{" "}
                      <span className="font-medium">
                        {playerMap[currentPickerId!]?.display_name ?? "…"}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* Pick timer */}
              <div
                className={`flex items-center gap-2 text-sm font-semibold tabular-nums ${
                  timeLeft <= 10 ? "text-destructive" : "text-foreground"
                }`}
                aria-live="polite"
                aria-label={`${timeLeft} seconds remaining`}
              >
                <TimerIcon />
                {timeLeft}s
              </div>
            </div>

            {/* Progress bar */}
            <div
              className="h-1.5 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={picks.length}
              aria-valuemax={totalPicks}
            >
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Available castaways grid */}
        <section
          className="lg:col-span-2 space-y-3"
          aria-labelledby="available-heading"
        >
          <h2 id="available-heading" className="text-base font-semibold">
            Available Castaways ({available.length})
          </h2>

          {available.length === 0 && !isComplete ? (
            <p className="text-sm text-muted-foreground">
              No castaways available.
            </p>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {available.map((castaway) => (
                <li key={castaway.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(castaway.id)}
                    disabled={!isMyTurn || picking || isComplete}
                    className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label={`Pick ${castaway.name}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                        {castaway.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={castaway.photo_url}
                            alt={castaway.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground font-medium">
                            {castaway.name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {castaway.name}
                        </p>
                        {castaway.tribe && (
                          <p className="text-xs text-muted-foreground truncate">
                            {castaway.tribe}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pick history */}
        <section className="space-y-3" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-base font-semibold">
            Pick History
          </h2>
          {picks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No picks yet.</p>
          ) : (
            <ol className="space-y-1.5 max-h-96 overflow-y-auto">
              {[...picks].reverse().map((pick) => {
                const castaway = castawayMap[pick.castaway_id];
                const player = playerMap[pick.player_id];
                return (
                  <li
                    key={pick.id}
                    className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-xs"
                  >
                    <span className="text-muted-foreground w-5 text-right shrink-0">
                      {pick.pick_number}
                    </span>
                    <div className="w-6 h-6 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {castaway?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={castaway.photo_url}
                          alt={castaway.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {castaway?.name.charAt(0) ?? "?"}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {castaway?.name ?? "Unknown"}
                      </p>
                      <p className="text-muted-foreground truncate">
                        {player?.display_name ?? "Unknown"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Teams overview */}
      <section className="space-y-3" aria-labelledby="teams-heading">
        <h2 id="teams-heading" className="text-base font-semibold">
          Teams
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => {
            const teamIds = teamByPlayer[player.id] ?? [];
            const isCurrentPicker = player.id === currentPickerId;
            return (
              <div
                key={player.id}
                className={`rounded-lg border bg-card p-3 space-y-2 ${
                  isCurrentPicker && !isComplete
                    ? "border-primary"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">
                    {player.display_name}
                    {player.id === currentUserId && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {teamIds.length}/{rosterSize}
                  </span>
                </div>
                {teamIds.length > 0 ? (
                  <ul className="space-y-1">
                    {teamIds.map((cid) => {
                      const c = castawayMap[cid];
                      return (
                        <li
                          key={cid}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <div className="w-5 h-5 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                            {c?.photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={c.photo_url}
                                alt={c.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {c?.name.charAt(0) ?? "?"}
                              </span>
                            )}
                          </div>
                          <span className="truncate">{c?.name ?? "?"}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No picks yet</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function TimerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
