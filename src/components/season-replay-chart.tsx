"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  niceTicks,
  pointsUpTo,
  spreadLabels,
  valueAt,
  valueRange,
  type RecapChartData,
} from "@/lib/season-recap";

/** Milliseconds the chart spends moving from one episode to the next. */
const MS_PER_EPISODE = 1500;

const WIDTH = 800;
const HEIGHT = 420;
const MARGIN = { top: 16, right: 130, bottom: 36, left: 44 };
const LABEL_GAP = 15;

interface Props {
  data: RecapChartData;
  /** The viewer's player id. Their line is drawn bolder. */
  currentPlayerId?: string;
}

/**
 * Replays the season's cumulative points, one episode at a time. Each line
 * climbs smoothly from one episode total to the next, with a name and running
 * total at its tip. Starts when scrolled into view.
 */
export default function SeasonReplayChart({ data, currentPlayerId }: Props) {
  const total = data.episodes.length;
  const [progress, setProgressState] = useState(0);
  const progressRef = useRef(0);
  const setProgress = useCallback((p: number) => {
    progressRef.current = p;
    setProgressState(p);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const startedRef = useRef(false);

  const [min, max] = useMemo(() => valueRange(data.series), [data.series]);
  const ticks = useMemo(() => niceTicks(min, max), [min, max]);
  const yMin = Math.min(min, ticks[0] ?? min);
  const yMax = Math.max(max, ticks[ticks.length - 1] ?? max);

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = useCallback(
    (step: number) => MARGIN.left + (total === 0 ? 0 : (step / total) * plotW),
    [total, plotW]
  );
  const y = useCallback(
    (v: number) => MARGIN.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH,
    [plotH, yMin, yMax]
  );

  // Animation loop.
  useEffect(() => {
    if (!playing) return;
    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      lastTimeRef.current = now;
      const next = Math.min(total, progressRef.current + (now - last) / MS_PER_EPISODE);
      setProgress(next);
      if (next >= total) {
        setPlaying(false);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = null;
    };
  }, [playing, total, setProgress]);

  // Start once the chart scrolls into view. Respect reduced motion.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || total === 0) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setProgress(total);
      startedRef.current = true;
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      startedRef.current = true;
      setPlaying(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!startedRef.current && entries.some((e) => e.isIntersecting)) {
          startedRef.current = true;
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [total, setProgress]);

  const finished = progress >= total;
  const onPlayPause = () => {
    if (finished) {
      setProgress(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };
  const onReplay = () => {
    setProgress(0);
    setPlaying(true);
  };

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">No episodes were scored this season.</p>
    );
  }

  const shownEpisode = Math.min(total, Math.floor(progress));
  const tips = data.series.map((s) => valueAt(s.totals, progress));
  const labelYs = spreadLabels(
    tips.map((v) => y(v)),
    LABEL_GAP,
    MARGIN.top + 6,
    MARGIN.top + plotH
  );
  const tipX = x(progress);

  // Draw highlighted and current-user lines last so they sit on top.
  const order = data.series
    .map((s, i) => i)
    .sort((a, b) => {
      const rank = (i: number) =>
        data.series[i].player_id === highlight ? 2 : data.series[i].player_id === currentPlayerId ? 1 : 0;
      return rank(a) - rank(b);
    });

  const isDimmed = (id: string) => highlight !== null && highlight !== id;
  const toggleHighlight = (id: string) => setHighlight((h) => (h === id ? null : id));

  return (
    <div ref={containerRef} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPlayPause}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors min-h-[40px]"
        >
          {playing ? "Pause" : finished ? "Replay" : "Play"}
        </button>
        {!finished && (
          <button
            type="button"
            onClick={onReplay}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors min-h-[40px]"
          >
            Restart
          </button>
        )}
        <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {shownEpisode === 0 ? "Start of season" : `Episode ${data.episodes[shownEpisode - 1]} of ${data.episodes[total - 1]}`}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-card p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full min-w-[560px] h-auto"
          role="img"
          aria-label="Each player's total points after every episode of the season"
        >
          {/* Grid and y-axis */}
          {ticks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke="currentColor"
                className={t === 0 ? "text-border" : "text-border/50"}
                strokeWidth={t === 0 ? 1.5 : 1}
              />
              <text
                x={MARGIN.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={12}
              >
                {t}
              </text>
            </g>
          ))}

          {/* x-axis episode labels */}
          {data.episodes.map((ep, i) => (
            <text
              key={`x${ep}`}
              x={x(i + 1)}
              y={MARGIN.top + plotH + 22}
              textAnchor="middle"
              className={i + 1 <= shownEpisode ? "fill-foreground" : "fill-muted-foreground"}
              fontSize={12}
            >
              E{ep}
            </text>
          ))}

          {/* Current position marker */}
          <line
            x1={tipX}
            x2={tipX}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
            stroke="currentColor"
            className="text-muted-foreground/30"
            strokeDasharray="4 4"
          />

          {/* Lines */}
          {order.map((i) => {
            const s = data.series[i];
            const pts = pointsUpTo(s.totals, progress);
            const d = pts
              .map(([step, v], k) => `${k === 0 ? "M" : "L"}${x(step).toFixed(1)},${y(v).toFixed(1)}`)
              .join(" ");
            const isMe = s.player_id === currentPlayerId;
            const dim = isDimmed(s.player_id);
            return (
              <g
                key={s.player_id}
                opacity={dim ? 0.15 : 1}
                onClick={() => toggleHighlight(s.player_id)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={highlight === s.player_id ? 4 : isMe ? 3.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={tipX} cy={y(tips[i])} r={isMe ? 4.5 : 3.5} fill={s.color} />
              </g>
            );
          })}

          {/* Tip labels */}
          {data.series.map((s, i) => {
            const dim = isDimmed(s.player_id);
            const isMe = s.player_id === currentPlayerId;
            const labelX = tipX + 10;
            return (
              <g
                key={`label-${s.player_id}`}
                opacity={dim ? 0.25 : 1}
                onClick={() => toggleHighlight(s.player_id)}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1={tipX + 4}
                  y1={y(tips[i])}
                  x2={labelX - 2}
                  y2={labelYs[i]}
                  stroke={s.color}
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text
                  x={labelX}
                  y={labelYs[i]}
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={isMe || highlight === s.player_id ? 700 : 500}
                  fill={s.color}
                >
                  {s.display_name} {Math.round(tips[i])}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend: tap to highlight a player */}
      <ul className="flex flex-wrap gap-2" aria-label="Players">
        {data.series.map((s) => (
          <li key={`legend-${s.player_id}`}>
            <button
              type="button"
              onClick={() => toggleHighlight(s.player_id)}
              aria-pressed={highlight === s.player_id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity min-h-[32px] ${
                highlight === s.player_id ? "border-foreground" : "border-border"
              } ${isDimmed(s.player_id) ? "opacity-40" : ""}`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.display_name}
              {s.player_id === currentPlayerId && <span className="text-muted-foreground">(you)</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
