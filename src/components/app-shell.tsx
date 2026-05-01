"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./logout-button";

interface NavLink {
  href: string;
  label: string;
}

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  backHref?: string;
  backLabel?: string;
  navLinks?: NavLink[];
  badge?: string;
}

export default function AppShell({
  children,
  title = "Fantasy Survivor",
  backHref,
  backLabel,
  navLinks = [],
  badge,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            {backHref && (
              <Link
                href={backHref}
                className="text-sm text-muted-foreground hover:text-foreground shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 rounded-md hover:bg-muted transition-colors"
                aria-label={backLabel ?? "Go back"}
              >
                ←
              </Link>
            )}
            <h1 className="text-lg font-semibold truncate">{title}</h1>
            {badge && (
              <span className="text-xs font-medium rounded px-2 py-0.5 bg-green-100 text-green-800 shrink-0">
                {badge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Desktop nav links */}
            {navLinks.length > 0 && (
              <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[44px] flex items-center ${
                      pathname === link.href
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}

            <LogoutButton />

            {/* Mobile menu button */}
            {navLinks.length > 0 && (
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  {menuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {menuOpen && navLinks.length > 0 && (
          <nav
            className="md:hidden border-t border-border px-4 py-2 space-y-1"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-3 text-sm font-medium transition-colors min-h-[44px] ${
                  pathname === link.href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
