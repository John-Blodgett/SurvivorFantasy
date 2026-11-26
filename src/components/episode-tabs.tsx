"use client";

import { createContext, useContext, useEffect, useState } from "react";

export interface EpisodeTab {
  id: string;
  label: string;
  /** Optional count shown after the label. */
  badge?: number;
}

const ActiveTabContext = createContext<string>("");

interface TabsProps {
  tabs: EpisodeTab[];
  /** Tab to open when nothing else applies. */
  defaultTab: string;
  /** Tab to open right after an action (e.g. "events" after a tally submit). */
  forcedTab?: string | null;
  /** Where the last-used tab is remembered (per episode). */
  storageKey: string;
  children: React.ReactNode;
}

/**
 * Tabs for the episode scoring page. All panels stay rendered (hidden when
 * inactive), so server actions keep working and in-progress state such as the
 * Live Tally survives tab switches. The last-used tab is remembered for this
 * browser tab, so an action's redirect or error lands you back where you were.
 */
export default function EpisodeTabs({ tabs, defaultTab, forcedTab, storageKey, children }: TabsProps) {
  const ids = tabs.map((t) => t.id);
  const valid = (id: string | null | undefined): id is string => !!id && ids.includes(id);
  const [active, setActive] = useState<string>(valid(forcedTab) ? forcedTab : defaultTab);

  // Restore the remembered tab unless an action asked for a specific one.
  useEffect(() => {
    if (valid(forcedTab)) {
      setActive(forcedTab);
      try {
        window.sessionStorage.setItem(storageKey, forcedTab);
      } catch {
        // Ignore storage errors.
      }
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (valid(saved)) setActive(saved);
    } catch {
      // sessionStorage unavailable; keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedTab, storageKey, ids.join(",")]);

  const choose = (id: string) => {
    setActive(id);
    try {
      window.sessionStorage.setItem(storageKey, id);
    } catch {
      // Ignore storage errors.
    }
  };

  return (
    <ActiveTabContext.Provider value={valid(active) ? active : defaultTab}>
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Episode scoring sections"
          className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => choose(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[40px] ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="rounded-full bg-primary/10 text-primary text-xs font-semibold px-1.5 py-0.5 leading-none tabular-nums">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </ActiveTabContext.Provider>
  );
}

/** One tab's content. Hidden (but kept mounted) when its tab isn't active. */
export function EpisodeTabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  const active = useContext(ActiveTabContext);
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={active !== id}
      className="space-y-6"
    >
      {children}
    </div>
  );
}
