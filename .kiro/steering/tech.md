# Tech Stack

## Framework & runtime

- Next.js 14 (App Router) with React 18
- TypeScript (strict mode)
- Node.js

## Backend & database

- Supabase (PostgreSQL + Auth + Storage)
  - `@supabase/ssr` for server/client Supabase clients
  - Row Level Security enforced via migrations
- Database migrations in `supabase/migrations/`

## Styling

- Tailwind CSS 3 with CSS variables for theming (shadcn/ui convention)
- shadcn/ui component system (Radix UI primitives, `class-variance-authority`, `clsx`, `tailwind-merge`)
- Geist font (local woff files)

## Testing

- Vitest with jsdom environment
- `@testing-library/react` + `@testing-library/jest-dom`
- `fast-check` for property-based testing
- Tests live in `src/test/` and mirror `src/lib/` modules

## Linting

- ESLint with `next/core-web-vitals` and `next/typescript` configs

## Key libraries

- `lucide-react` for icons
- `next/font` for local font loading

## Common commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
npm run validate     # test + lint + build (full check)
```

## Path aliases

- `@/*` maps to `./src/*` (configured in tsconfig and vitest)
