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
  tribe_id: string | null;
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
  pickStartedAt: string | null;
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
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));
  const castawayMap = Object.fromEntries(allCastaways.map((c) => [c.id, c]));

  const currentPickIndex = draft.currentPickIndex;
  const isComplete = draft.status === "complete";
  const currentPickerId =
    !isComplete && currentPickIndex < snakeOrder.length
      ? snakeOrder[currentPickIndex]
      : null;
  const isMyTurn = currentPickerId === currentUserId;

  // Recompute time left when pick_started_at changes (synced across all clients)
  useEffect(() => {
    setTimeLeft(computeTimeLeft(draft.pickStartedAt, pickTimerSeconds));
    autoPickFiredRef.current = false;
  }, [draft.pickStartedAt, pickTimerSeconds]);

  // Countdown timer — ticks every second, computing from server timestamp
  useEffect(() => {
    if (isComplete || !currentPickerId) return;

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      const remaining = computeTimeLeft(draft.pickStartedAt, pickTimerSeconds);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [draft.pickStartedAt, isComplete, currentPickerId, pickTimerSeconds]);

  // Auto-pick when timer hits 0 — any client can trigger this; the API
  // guards against duplicate/stale requests via pickIndex comparison.
  const handleAutoPick = useCallback(async () => {
    if (autoPickFiredRef.current) return;
    autoPickFiredRef.current = true;
    setPicking(true);
    console.log("[draft-room] Timer expired, triggering auto-pick", {
      leagueId,
      pickIndex: currentPickIndex,
    });
    try {
      const res = await fetch("/api/draft/auto-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, pickIndex: currentPickIndex }),
      });
      const data = await res.json();
      console.log("[draft-room] Auto-pick response", { status: res.status, data });
      if (!res.ok && data.error) {
        setError(data.error);
      } else if (data.success && data.pick) {
        console.log("[draft-room] Auto-pick succeeded, broadcasting");

        // Update local state immediately
        const newPick = data.pick;
        setPicks((prev) => {
          if (prev.some((p: Pick) => p.id === newPick.id)) return prev;
          return [...prev, newPick];
        });
        setAvailable((prev: Castaway[]) => prev.filter((c) => c.id !== newPick.castaway_id));
        setDraft((prev) => ({
          ...prev,
          status: data.draftStatus,
          currentPickIndex: data.currentPickIndex,
          pickStartedAt: data.pickStartedAt,
        }));

        // Broadcast to other clients
        if (channelRef.current) {
          await channelRef.current.send({
            type: "broadcast",
            event: "draft_pick",
            payload: {
              pick: data.pick,
              draftStatus: data.draftStatus,
              currentPickIndex: data.currentPickIndex,
              pickStartedAt: data.pickStartedAt,
            },
          });
          console.log("[draft-room] Auto-pick broadcast sent");
        }
      }
    } catch (err) {
      console.error("[draft-room] Auto-pick fetch failed", err);
      setError("Failed to auto-pick. Please refresh.");
    }
    setPicking(false);
  }, [leagueId, currentPickIndex]);

  useEffect(() => {
    if (timeLeft === 0 && !picking && !isComplete && currentPickerId) {
      handleAutoPick();
    }
  }, [timeLeft, picking, isComplete, currentPickerId, handleAutoPick]);

  // Supabase Broadcast subscription — listens for pick events sent by other clients
  useEffect(() => {
    const supabase = createClient();

    console.log("[draft-room] Setting up Broadcast subscription", { leagueId });

    const channel = supabase
      .channel(`draft-broadcast-${leagueId}`)
      .on("broadcast", { event: "draft_pick" }, (payload) => {
        const data = payload.payload as {
          pick: Pick;
          draftStatus: string;
          currentPickIndex: number;
          pickStartedAt: string | null;
        };
        console.log("[draft-room] Broadcast: pick received", data);

        setPicks((prev) => {
          if (prev.some((p) => p.id === data.pick.id)) return prev;
          return [...prev, data.pick];
        });
        setAvailable((prev) =>
          prev.filter((c) => c.id !== data.pick.castaway_id)
        );
        setDraft((prev) => ({
          ...prev,
          status: data.draftStatus,
          currentPickIndex: data.currentPickIndex,
          pickStartedAt: data.pickStartedAt,
        }));
      })
      .subscribe((status, err) => {
        console.log("[draft-room] Broadcast subscription status:", status, err ?? "");
      });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  async function handlePick(castawayId: string) {
    // Double-check turn enforcement — the server also validates this,
    // but we guard here to avoid unnecessary round-trips.
    if (picking) {
      console.log("[draft-room] Pick already in progress, ignoring click");
      return;
    }
    if (!isMyTurn) {
      console.warn("[draft-room] Not my turn, ignoring pick attempt", {
        currentPickerId,
        currentUserId,
        currentPickIndex: draft.currentPickIndex,
      });
      setError("It's not your turn to pick.");
      return;
    }

    setPicking(true);
    setError(null);

    console.log("[draft-room] Submitting pick", {
      castawayId,
      currentPickIndex: draft.currentPickIndex,
      currentUserId,
    });

    const formData = new FormData();
    formData.set("league_id", leagueId);
    formData.set("castaway_id", castawayId);

    const result = await makeDraftPickAction(formData);
    if (result.error) {
      console.error("[draft-room] Pick failed", { error: result.error });
      setError(result.error);
    } else {
      console.log("[draft-room] Pick succeeded, broadcasting");

      // Update local state immediately (broadcast doesn't echo back to sender)
      const newPick = result.pick!;
      setPicks((prev) => {
        if (prev.some((p) => p.id === newPick.id)) return prev;
        return [...prev, newPick];
      });
      setAvailable((prev) => prev.filter((c) => c.id !== newPick.castaway_id));
      setDraft((prev) => ({
        ...prev,
        status: result.draftStatus!,
        currentPickIndex: result.currentPickIndex!,
        pickStartedAt: result.pickStartedAt ?? null,
      }));

      // Broadcast to other clients
      if (channelRef.current) {
        await channelRef.current.send({
          type: "broadcast",
          event: "draft_pick",
          payload: {
            pick: result.pick,
            draftStatus: result.draftStatus,
            currentPickIndex: result.currentPickIndex,
            pickStartedAt: result.pickStartedAt,
          },
        });
        console.log("[draft-room] Broadcast sent");
      }
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

/**
 * Compute seconds remaining from a server-provided pick_started_at timestamp.
 * All clients derive the same value from the same timestamp, keeping timers in sync.
 */
function computeTimeLeft(pickStartedAt: string | null, pickTimerSeconds: number): number {
  if (!pickStartedAt) return pickTimerSeconds;
  const elapsed = (Date.now() - new Date(pickStartedAt).getTime()) / 1000;
  return Math.max(0, Math.round(pickTimerSeconds - elapsed));
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
