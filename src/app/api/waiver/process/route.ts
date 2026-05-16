import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { shouldProcessLeague, processLeagueWaivers } from "@/lib/waiver-processing";

/**
 * GET /api/waiver/process
 *
 * Cron endpoint that runs hourly. Checks all leagues to see if their
 * waiver schedule matches the current Pacific time, and processes
 * pending claims for matching leagues.
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch all leagues with a waiver schedule configured
  const { data: leagues, error } = await supabase
    .from("leagues")
    .select("id, waiver_process_days, waiver_process_hour, waiver_process_minute")
    .not("waiver_process_days", "is", null);

  if (error) {
    console.error("[waiver-cron] Failed to fetch leagues:", error.message);
    return NextResponse.json({ error: "Failed to fetch leagues" }, { status: 500 });
  }

  const now = new Date();
  const processed: string[] = [];

  for (const league of leagues ?? []) {
    if (
      shouldProcessLeague(
        league.waiver_process_days,
        league.waiver_process_hour,
        league.waiver_process_minute,
        now
      )
    ) {
      try {
        const count = await processLeagueWaivers(league.id);
        if (count > 0) {
          processed.push(league.id);
          console.log(`[waiver-cron] Processed ${count} claims for league ${league.id}`);
        }
      } catch (err) {
        console.error(`[waiver-cron] Error processing league ${league.id}:`, err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: (leagues ?? []).length,
    processed: processed.length,
    leagueIds: processed,
  });
}
