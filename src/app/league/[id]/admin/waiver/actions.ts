"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLeagueAdmin } from "../helpers";
import { processLeagueWaivers } from "@/lib/waiver-processing";

export async function updateWaiverScheduleAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/waiver`;

  const processDays = formData.getAll("waiver_process_days") as string[];
  const processHour = parseInt(formData.get("waiver_process_hour") as string, 10);
  const processMinute = parseInt(formData.get("waiver_process_minute") as string, 10);

  const { error } = await supabase
    .from("leagues")
    .update({
      waiver_process_days: processDays.length > 0 ? processDays.join(",") : null,
      waiver_process_hour: processHour,
      waiver_process_minute: processMinute,
    })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to update schedule.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=schedule_updated`);
}

export async function processWaiversAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/waiver`;

  const count = await processLeagueWaivers(leagueId);

  if (count === 0) {
    redirect(`${basePath}?error=No pending claims to process.`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=claims_processed`);
}
