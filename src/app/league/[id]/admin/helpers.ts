import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Verifies the current user is the admin of the given league.
 * Returns the supabase client, user, and league ID.
 * Redirects to dashboard if not authorized.
 */
export async function requireLeagueAdmin(leagueId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) {
    redirect("/dashboard");
  }

  return { supabase, user, leagueId: league.id };
}
