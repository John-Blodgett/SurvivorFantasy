"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { submitTallyAction } from "@/app/league/[id]/admin/episode/[num]/actions";
import SubmitButton from "./submit-button";
import {
  countOf,
  decrement,
  emptyTally,
  increment,
  lastTap,
  moreRules,
  parseStoredTally,
  quickRules,
  storageKey,
  tallyEntries,
  tallyTotals,
  toggleRuleHidden,
  undoLast,
  type TallyRule,
  type TallyState,
} from "@/lib/live-tally";

export interface TallyCastaway {
  id: string;
  name: string;
  photo_url: string | null;
}

interface Props {
  leagueId: string;
  episodeNumber: number;
  castaways: TallyCastaway[];
  rules: TallyRule[];
  /**
   * Set right after a successful submit. The saved tally is cleared once per
   * token, so reloading the page later doesn't wipe a new tally.
   */
  submittedToken: string | null;
}

/** Short label for a quick button: drops filler words so it fits on a phone. */
function shortLabel(name: string): string {
  const short = name.replace(/\b(your name|challenge|episode)\b/gi, "").replace(/\s+/g, " ").trim();
  return short.length > 0 ? short : name;
}

function pointsText(points: number): string {
  return points > 0 ? `+${points}` : `${points}`;
}

/**
 * Live Tally: tap to count events per castaway as they happen. Taps are
 * instant and saved on this device. Review and submit once at the end.
 */
export default function LiveTally({ leagueId, episodeNumber, castaways, rules, submittedToken }: Props) {
  const key = storageKey(leagueId, episodeNumber);
  const [state, setState] = useState<TallyState>(emptyTally);
  const [loaded, setLoaded] = useState(false);
  const [openMore, setOpenMore] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const [wakeSupported, setWakeSupported] = useState(false);

  // Load the saved tally (or clear it after a successful submit).
  useEffect(() => {
    try {
      const stored = parseStoredTally(window.localStorage.getItem(key));
      const tokenKey = `${key}:submitted`;
      if (submittedToken && window.localStorage.getItem(tokenKey) !== submittedToken) {
        // Just submitted: drop the counts, keep the rule toggles.
        const fresh = { ...emptyTally(), hiddenRuleIds: stored.hiddenRuleIds };
        window.localStorage.setItem(key, JSON.stringify(fresh));
        window.localStorage.setItem(tokenKey, submittedToken);
        setState(fresh);
      } else {
        setState(stored);
      }
    } catch {
      // Storage unavailable (e.g. private mode): tally still works in memory.
    }
    setLoaded(true);
    setWakeSupported(typeof navigator !== "undefined" && "wakeLock" in navigator);
  }, [key, submittedToken]);

  // Save on every change.
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore storage errors; counts remain in memory.
    }
  }, [state, loaded, key]);

  // Keep the screen awake while tallying, if the browser supports it.
  useEffect(() => {
    if (!keepAwake) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      return;
    }
    let cancelled = false;
    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        const lock = await nav.wakeLock?.request("screen");
        if (lock && !cancelled) wakeLockRef.current = lock;
      } catch {
        setKeepAwake(false);
      }
    };
    request();
    // The lock is dropped when the tab is hidden; re-acquire on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [keepAwake]);

  const tap = useCallback((castawayId: string, ruleId: string) => {
    setState((s) => increment(s, castawayId, ruleId));
    if (typeof navigator !== "undefined") navigator.vibrate?.(8);
  }, []);
  const untap = useCallback((castawayId: string, ruleId: string) => {
    setState((s) => decrement(s, castawayId, ruleId));
  }, []);

  const rulePoints = useMemo(() => new Map(rules.map((r) => [r.id, r.points])), [rules]);
  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);
  const castawayName = useMemo(() => new Map(castaways.map((c) => [c.id, c.name])), [castaways]);
  const addedRules = rules.filter((r) => !r.is_default);
  const quick = quickRules(rules, state);
  const more = moreRules(rules, state);
  const entries = tallyEntries(state);
  const totals = tallyTotals(state, rulePoints);
  const last = lastTap(state);

  const castawayTotal = (castawayId: string) =>
    entries
      .filter((e) => e.castaway_id === castawayId)
      .reduce((sum, e) => sum + e.count * (rulePoints.get(e.rule_id) ?? 0), 0);

  const clearAll = () => {
    if (window.confirm("Clear the whole tally? This can't be undone.")) {
      setState((s) => ({ ...emptyTally(), hiddenRuleIds: s.hiddenRuleIds }));
      setReviewing(false);
    }
  };

  if (castaways.length === 0 || rules.length === 0) {
    return <p className="text-sm text-muted-foreground">Add castaways and scoring rules to use the tally.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Tap as things happen. Counts save on this phone instantly. Nothing is scored until you
        review and submit.
      </p>

      {/* Which added rules are quick buttons tonight */}
      {addedRules.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Quick buttons tonight</p>
          <div className="flex flex-wrap gap-2">
            {addedRules.map((r) => {
              const on = !state.hiddenRuleIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setState((s) => toggleRuleHidden(s, r.id))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setState(undoLast)}
          disabled={!last}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40"
        >
          ↶ Undo
          {last && (
            <span className="text-muted-foreground font-normal">
              {" "}
              {castawayName.get(last.castaway_id)} · {shortLabel(ruleName.get(last.rule_id) ?? "")}
            </span>
          )}
        </button>
        {wakeSupported && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepAwake}
              onChange={(e) => setKeepAwake(e.target.checked)}
              className="h-4 w-4"
            />
            Keep screen on
          </label>
        )}
      </div>

      {/* Castaway rows */}
      <ul className="space-y-2">
        {castaways.map((c) => {
          const total = castawayTotal(c.id);
          const moreOpen = openMore === c.id;
          const moreTapped = more.reduce((n, r) => n + countOf(state, c.id, r.id), 0);
          return (
            <li key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {c.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="font-semibold text-sm flex-1 min-w-0 truncate">{c.name}</span>
                {total !== 0 && (
                  <span
                    className={`text-sm font-semibold tabular-nums ${total < 0 ? "text-destructive" : "text-green-700"}`}
                  >
                    {pointsText(total)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {quick.map((r) => (
                  <TallyButton
                    key={r.id}
                    label={shortLabel(r.name)}
                    points={r.points}
                    count={countOf(state, c.id, r.id)}
                    onTap={() => tap(c.id, r.id)}
                    onUntap={() => untap(c.id, r.id)}
                    big
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setOpenMore(moreOpen ? null : c.id)}
                  aria-expanded={moreOpen}
                  className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors min-h-[48px]"
                >
                  {moreOpen ? "Less" : "More"}
                  {!moreOpen && moreTapped > 0 && <span className="ml-1 font-semibold text-foreground">({moreTapped})</span>}
                </button>
              </div>

              {moreOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {more.map((r) => (
                    <TallyButton
                      key={r.id}
                      label={r.name}
                      points={r.points}
                      count={countOf(state, c.id, r.id)}
                      onTap={() => tap(c.id, r.id)}
                      onUntap={() => untap(c.id, r.id)}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-30 -mx-1 rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-3 shadow-md">
        <div className="flex items-center gap-3">
          <p className="text-sm flex-1">
            <span className="font-semibold tabular-nums">{totals.taps}</span> taps ·{" "}
            <span className="font-semibold tabular-nums">{pointsText(totals.points)}</span> pts
          </p>
          <button
            type="button"
            onClick={() => setReviewing(true)}
            disabled={totals.taps === 0}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Review &amp; Submit
          </button>
        </div>
      </div>

      {/* Review sheet */}
      {reviewing && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="tally-review-heading">
          <div className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-background p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="tally-review-heading" className="text-base font-semibold">
                Review tally
              </h3>
              <button
                type="button"
                onClick={() => setReviewing(false)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
              >
                Back
              </button>
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing tallied.</p>
            ) : (
              <ul className="space-y-3">
                {castaways
                  .filter((c) => entries.some((e) => e.castaway_id === c.id))
                  .map((c) => (
                    <li key={c.id} className="space-y-1.5">
                      <p className="text-sm font-semibold">
                        {c.name}{" "}
                        <span className="text-muted-foreground font-normal">({pointsText(castawayTotal(c.id))} pts)</span>
                      </p>
                      <ul className="space-y-1">
                        {entries
                          .filter((e) => e.castaway_id === c.id)
                          .map((e) => (
                            <li key={e.rule_id} className="flex items-center gap-2 text-sm">
                              <span className="flex-1 min-w-0 truncate">
                                {ruleName.get(e.rule_id) ?? "Unknown rule"}
                              </span>
                              <button
                                type="button"
                                onClick={() => untap(c.id, e.rule_id)}
                                aria-label={`Remove one ${ruleName.get(e.rule_id)} for ${c.name}`}
                                className="w-9 h-9 rounded-md border border-border font-semibold hover:bg-muted"
                              >
                                −
                              </button>
                              <span className="w-8 text-center tabular-nums font-semibold">×{e.count}</span>
                              <button
                                type="button"
                                onClick={() => tap(c.id, e.rule_id)}
                                aria-label={`Add one ${ruleName.get(e.rule_id)} for ${c.name}`}
                                className="w-9 h-9 rounded-md border border-border font-semibold hover:bg-muted"
                              >
                                +
                              </button>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            )}

            <form action={submitTallyAction} className="space-y-2">
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <input type="hidden" name="tally" value={JSON.stringify(entries)} />
              <SubmitButton
                pendingText="Saving…"
                disabled={entries.length === 0}
                className="w-full rounded-md bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Submit {totals.taps} events ({pointsText(totals.points)} pts)
              </SubmitButton>
            </form>
            <button
              type="button"
              onClick={clearAll}
              className="w-full rounded-md px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              Clear tally
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TallyButton({
  label,
  points,
  count,
  onTap,
  onUntap,
  big = false,
}: {
  label: string;
  points: number;
  count: number;
  onTap: () => void;
  onUntap: () => void;
  big?: boolean;
}) {
  return (
    <div className={`inline-flex items-stretch rounded-md border ${count > 0 ? "border-primary" : "border-border"} overflow-hidden`}>
      <button
        type="button"
        onClick={onTap}
        className={`flex items-center gap-2 px-3 text-left transition-colors active:bg-primary/20 ${
          count > 0 ? "bg-primary/10" : "bg-muted/60 hover:bg-muted"
        } ${big ? "min-h-[48px] text-sm font-medium" : "min-h-[44px] text-sm flex-1"}`}
      >
        <span className="leading-tight">{label}</span>
        <span className={`text-xs tabular-nums ${points < 0 ? "text-destructive" : "text-green-700"}`}>
          {pointsText(points)}
        </span>
        {count > 0 && (
          <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 tabular-nums">
            ×{count}
          </span>
        )}
      </button>
      {count > 0 && (
        <button
          type="button"
          onClick={onUntap}
          aria-label={`Remove one ${label}`}
          className="px-3 border-l border-primary/40 text-sm font-semibold hover:bg-muted active:bg-muted"
        >
          −
        </button>
      )}
    </div>
  );
}
