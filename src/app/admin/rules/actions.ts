"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateScoringRule } from "@/lib/scoring-rules";

/** Returns the league where the current user is admin, or redirects. */
async function getAdminLeague() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  return { supabase, user, leagueId: league.id };
}

/** Create a new scoring rule. */
export async function createRuleAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const name = (formData.get("name") as string | null) ?? "";
  const pointsRaw = (formData.get("points") as string | null) ?? "";
  const points = parseInt(pointsRaw, 10);

  const validation = validateScoringRule({ name, points });
  if (!validation.valid) {
    redirect(`/admin/rules?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase.from("scoring_rules").insert({
    league_id: leagueId,
    name: name.trim(),
    points,
  });

  if (error) {
    redirect(
      `/admin/rules?error=${encodeURIComponent("Failed to create rule. Please try again.")}`
    );
  }

  revalidatePath("/admin/rules");
  redirect("/admin/rules?success=created");
}

/** Update an existing scoring rule's name and/or point value. */
export async function updateRuleAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const ruleId = (formData.get("rule_id") as string | null) ?? "";
  const name = (formData.get("name") as string | null) ?? "";
  const pointsRaw = (formData.get("points") as string | null) ?? "";
  const points = parseInt(pointsRaw, 10);

  if (!ruleId) redirect("/admin/rules?error=Missing+rule+ID");

  const validation = validateScoringRule({ name, points });
  if (!validation.valid) {
    redirect(`/admin/rules?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase
    .from("scoring_rules")
    .update({ name: name.trim(), points })
    .eq("id", ruleId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(
      `/admin/rules?error=${encodeURIComponent("Failed to update rule. Please try again.")}`
    );
  }

  revalidatePath("/admin/rules");
  redirect("/admin/rules?success=updated");
}

/**
 * Delete a scoring rule.
 * Per Req 5.5: existing episode_events rows must be preserved.
 * We null out scoring_rule_id on episode_events (the points snapshot is already stored
 * in the episode_events.points column), then delete the rule.
 */
export async function deleteRuleAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const ruleId = (formData.get("rule_id") as string | null) ?? "";
  if (!ruleId) redirect("/admin/rules?error=Missing+rule+ID");

  // Null out the FK on any episode_events that reference this rule
  // (points are already snapshotted in episode_events.points)
  const { error: nullifyError } = await supabase
    .from("episode_events")
    .update({ scoring_rule_id: null })
    .eq("scoring_rule_id", ruleId);

  if (nullifyError) {
    redirect(
      `/admin/rules?error=${encodeURIComponent("Failed to detach rule from events.")}`
    );
  }

  const { error } = await supabase
    .from("scoring_rules")
    .delete()
    .eq("id", ruleId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(
      `/admin/rules?error=${encodeURIComponent("Failed to delete rule. Please try again.")}`
    );
  }

  revalidatePath("/admin/rules");
  redirect("/admin/rules?success=deleted");
}
