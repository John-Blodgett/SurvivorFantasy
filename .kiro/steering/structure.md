# Project Structure

## Layout

```
src/
  app/          # Next.js App Router pages and server actions
  components/   # Shared React components
  lib/          # Pure business logic and utilities
    supabase/   # Supabase client factories (client.ts, server.ts)
  test/         # Vitest test files
  middleware.ts # Auth middleware (protects routes, refreshes session)
supabase/
  migrations/   # SQL migration files (sequential, prefixed with timestamps)
```

## Architecture patterns

### Data layer separation

- `src/lib/*.ts` contains pure business logic (validation, scoring, draft order, trade rules). These modules have zero Supabase imports and are fully unit-testable.
- `src/app/**/actions.ts` are `"use server"` server actions that combine Supabase queries with lib-layer validation, then redirect with query-param feedback (`?error=...` or `?success=...`).
- Page components (`page.tsx`) are async server components that fetch data via Supabase and render UI. They import actions for form handling.

### Supabase client usage

- Server components and server actions: `import { createClient } from "@/lib/supabase/server"`
- Client components: `import { createClient } from "@/lib/supabase/client"`
- Middleware creates its own client inline using `createServerClient`

### Routing conventions

- `/admin/*` — league admin pages (castaways, draft, episodes, rules, trades, waiver, late-join)
- `/league/[id]/*` — player-facing league pages (leaderboard, draft, team, episodes, challenges, waiver, preferences)
- `/dashboard` — authenticated home (league list, pending trades)
- `/join/[invite_code]` — invite link handler
- `/api/*` — API routes (e.g., auto-pick endpoint)

### Testing conventions

- Test files in `src/test/` named `<module>.test.ts`
- Tests target `src/lib/` pure functions only (no Supabase mocking)
- Property-based tests use `fast-check` with descriptive property names referencing requirement IDs
- Setup file: `src/test/setup.ts` (imports `@testing-library/jest-dom`)

### UI patterns

- `AppShell` component wraps all pages (title, back navigation)
- Feedback via URL search params (`?error=`, `?success=`) rendered as alert/status banners
- Forms use native `<form action={serverAction}>` with `FormData`
- Tailwind utility classes directly in JSX; shadcn/ui design tokens for colors and spacing
- Accessibility: `role="alert"` / `role="status"` on messages, `aria-label` on inputs, semantic HTML
