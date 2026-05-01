import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createRuleAction, updateRuleAction, deleteRuleAction } from "./actions";
import type { ScoringRule } from "@/lib/scoring-rules";

interface SearchParams {
  error?: string;
  success?: string;
  edit?: string; // rule id being edited
}

export default async function AdminRulesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  const { data: rules } = await supabase
    .from("scoring_rules")
    .select("*")
    .eq("league_id", league.id)
    .order("created_at", { ascending: true });

  const allRules: ScoringRule[] = rules ?? [];
  const editingId = searchParams.edit ?? null;

  const successMessage =
    searchParams.success === "created"
      ? "Rule created successfully."
      : searchParams.success === "updated"
      ? "Rule updated successfully."
      : searchParams.success === "deleted"
      ? "Rule deleted successfully."
      : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Scoring Rules — {league.name}</h1>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-8">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {successMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {successMessage}
          </p>
        )}

        {/* Create new rule */}
        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-base font-semibold mb-3">
            Add Rule
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            <form action={createRuleAction} className="flex flex-col sm:flex-row gap-3">
              <input
                name="name"
                type="text"
                required
                placeholder="Rule name (e.g. Immunity Win)"
                aria-label="Rule name"
                className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                name="points"
                type="number"
                required
                placeholder="Points"
                aria-label="Point value"
                className="w-28 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="submit"
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Negative values are allowed (e.g. −2 for a penalty).
            </p>
          </div>
        </section>

        {/* Rules list */}
        <section aria-labelledby="rules-heading">
          <h2 id="rules-heading" className="text-base font-semibold mb-3">
            Rules ({allRules.length})
          </h2>

          {allRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules yet.</p>
          ) : (
            <ul className="space-y-2">
              {allRules.map((rule) =>
                editingId === rule.id ? (
                  <EditRuleRow key={rule.id} rule={rule} />
                ) : (
                  <RuleRow key={rule.id} rule={rule} />
                )
              )}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

/** Read-only row with Edit and Delete buttons. */
function RuleRow({ rule }: { rule: ScoringRule }) {
  const isNegative = rule.points < 0;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{rule.name}</p>
        {rule.is_default && (
          <p className="text-xs text-muted-foreground">Default rule</p>
        )}
      </div>

      <span
        className={`text-sm font-semibold tabular-nums shrink-0 ${
          isNegative ? "text-destructive" : "text-green-700"
        }`}
      >
        {rule.points > 0 ? `+${rule.points}` : rule.points}
      </span>

      {/* Edit link — uses query param to open inline edit form */}
      <Link
        href={`/admin/rules?edit=${rule.id}`}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors shrink-0"
      >
        Edit
      </Link>

      {/* Delete */}
      <form action={deleteRuleAction} className="shrink-0">
        <input type="hidden" name="rule_id" value={rule.id} />
        <button
          type="submit"
          className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors"
          onClick={(e) => {
            if (
              !confirm(
                `Delete "${rule.name}"? Existing episode events will be preserved.`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          Delete
        </button>
      </form>
    </li>
  );
}

/** Inline edit form row. */
function EditRuleRow({ rule }: { rule: ScoringRule }) {
  return (
    <li className="rounded-lg border border-primary bg-card px-4 py-3">
      <form
        action={updateRuleAction}
        className="flex flex-col sm:flex-row gap-3 items-start sm:items-center"
      >
        <input type="hidden" name="rule_id" value={rule.id} />
        <input
          name="name"
          type="text"
          required
          defaultValue={rule.name}
          aria-label="Rule name"
          className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          name="points"
          type="number"
          required
          defaultValue={rule.points}
          aria-label="Point value"
          className="w-28 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-2 shrink-0">
          <button
            type="submit"
            className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Save
          </button>
          <Link
            href="/admin/rules"
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </li>
  );
}
