import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import SubmitButton from "@/components/submit-button";
import { updateDisplayNameAction } from "./actions";

interface PageProps {
  searchParams: { error?: string; success?: string };
}

export default async function ProfilePage({ searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <AppShell title="Profile" backHref="/dashboard" backLabel="Dashboard">
      <div className="p-4 sm:p-6 max-w-md mx-auto space-y-4">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}
        {searchParams.success && (
          <p
            role="status"
            className="text-sm text-green-800 bg-green-100 rounded-md px-3 py-2"
          >
            {searchParams.success}
          </p>
        )}

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Display name</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              This name is shown across all your leagues.
            </p>
          </div>

          <form action={updateDisplayNameAction} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="display_name" className="text-xs font-medium">
                Name
              </label>
              <input
                id="display_name"
                name="display_name"
                type="text"
                required
                maxLength={40}
                defaultValue={profile?.display_name ?? ""}
                aria-label="Display name"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Your name"
              />
            </div>
            <SubmitButton
              pendingText="Saving…"
              className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50"
            >
              Save
            </SubmitButton>
          </form>
        </div>

        <p className="text-xs text-muted-foreground px-1">
          Signed in as {user.email}
        </p>
      </div>
    </AppShell>
  );
}
