import Link from "next/link";

export interface SectionTab {
  href: string;
  label: string;
  /** Optional count/badge shown after the label, e.g. pending trades. */
  badge?: number;
}

/**
 * In-page section navigation used on pages that combine several previously
 * separate screens (e.g. the "Moves" page hosting waiver / trades / alliance,
 * or the admin "Castaways & Tribes" page). Rendered as a horizontal row of
 * pill links; the active tab is driven by `active` rather than the pathname so
 * callers can switch sections via a query param or hash.
 */
export default function SectionTabs({
  tabs,
  active,
}: {
  tabs: SectionTab[];
  active: string;
}) {
  return (
    <nav
      aria-label="Section navigation"
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === active || tab.label === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="rounded-full bg-primary/10 text-primary text-xs font-semibold px-1.5 py-0.5 leading-none">
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
