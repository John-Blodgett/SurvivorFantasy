import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createLeagueAction } from "@/app/leagues/actions";

interface Props {
  searchParams: { error?: string };
}

export default async function NewLeaguePage({ searchParams }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const error = searchParams.error ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Create a League</h1>
      </header>

      <main className="p-6 max-w-md mx-auto">
        <form action={createLeagueAction} className="space-y-5">
          {error && (
            <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              League Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Survivor Season 47 Fantasy"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="season_number" className="text-sm font-medium">
              Season Number
            </label>
            <input
              id="season_number"
              name="season_number"
              type="number"
              required
              min={1}
              defaultValue={47}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="roster_size" className="text-sm font-medium">
              Roster Size (castaways per team)
            </label>
            <input
              id="roster_size"
              name="roster_size"
              type="number"
              required
              min={1}
              max={20}
              defaultValue={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">Between 1 and 20</p>
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create League
          </button>
        </form>
      </main>
    </div>
  );
}
