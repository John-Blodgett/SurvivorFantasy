"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateScoringRule } from "@/lib/scoring-rules";
import { requireLeagueAdmin } from "../helpers";

export async function createRuleAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/rules`;

  const name = (formData.get("name") as string | null) ?? "";
  const points = parseInt((formData.get("points") as string | null) ?? "", 10);

  const validation = validateScoringRule({ name, points });
  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase.from("scoring_rules").insert({
    league_id: leagueId,
    name: name.trim(),
    points,
  });

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to create rule.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=created`);
}

export async function updateRuleAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/rules`;

  const ruleId = (formData.get("rule_id") as string | null) ?? "";
  const name = (formData.get("name") as string | null) ?? "";
  const points = parseInt((formData.get("points") as string | null) ?? "", 10);

  if (!ruleId) redirect(`${basePath}?error=Missing+rule+ID`);

  const validation = validateScoringRule({ name, points });
  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase
    .from("scoring_rules")
    .update({ name: name.trim(), points })
    .eq("id", ruleId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to update rule.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=updated`);
}

export async function deleteRuleAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/rules`;

  const ruleId = (formData.get("rule_id") as string | null) ?? "";
  if (!ruleId) redirect(`${basePath}?error=Missing+rule+ID`);

  await supabase
    .from("episode_events")
    .update({ scoring_rule_id: null })
    .eq("scoring_rule_id", ruleId);

  const { error } = await supabase
    .from("scoring_rules")
    .delete()
    .eq("id", ruleId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to delete rule.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=deleted`);
}
