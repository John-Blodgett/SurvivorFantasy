# Fantasy Survivor

A fantasy sports web app for CBS Survivor. Create or join leagues, draft castaways, and earn points based on real episode events.

## Tech Stack

- Next.js 14 (App Router) with React 18 and TypeScript
- Supabase (PostgreSQL, Auth, Storage, Row Level Security)
- Tailwind CSS 3 with shadcn/ui components
- Vitest for testing

## Prerequisites

- Node.js 18+
- A Supabase project (free tier works)

## Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. Run the database migrations in your Supabase project. The migration files are in `supabase/migrations/` and should be applied in order.

4. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to get started.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run dev:clean` | Clear `.next` cache and start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (single run) |
| `npm run test:watch` | Vitest (watch mode) |
| `npm run validate` | test + lint + build (full check) |

## Project Structure

```
src/
  app/          # Next.js App Router pages and server actions
  components/   # Shared React components
  lib/          # Pure business logic and utilities
    supabase/   # Supabase client factories
  test/         # Vitest test files
  middleware.ts # Auth middleware
supabase/
  migrations/   # SQL migration files (applied in order)
```

## Features

- League creation with invite-code join flow
- Snake-style draft (live with pick timer, or auto)
- Configurable scoring rules per league
- Episode scoring by league admin
- 1-for-1 castaway trades (player proposes → receiver accepts → admin approves)
- Waiver wire for picking up unowned castaways
- Weekly trivia/prediction challenges
- Leaderboard with aggregated scores

## Troubleshooting

If the dev server feels stale after code changes (pages not updating, console.log not appearing), stop the server and run:

```bash
npm run dev:clean
```

This clears the `.next` build cache and restarts fresh.
