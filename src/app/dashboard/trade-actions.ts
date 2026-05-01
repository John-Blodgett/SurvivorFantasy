"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Accept a pending trade (receiver action).
 * Requirements: 13.2
 */
export async function acceptTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/dashboard?error=Missing+trade+ID");

  // Verify the trade exists and the current user is the receiver
  const { data: trade } = await supabase
    .from("trades")
    .select("id, receiver_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect("/dashboard?error=Trade+not+found");
  }

  if (trade.status !== "pending") {
    redirect("/dashboard?error=Trade+is+no+longer+pending");
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "accepted" })
    .eq("id", tradeId);

  if (error) {
    redirect("/dashboard?error=Failed+to+accept+trade");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?success=trade_accepted");
}

/**
 * Reject a pending trade (receiver action).
 * Requirements: 13.2
 */
export async function rejectTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/dashboard?error=Missing+trade+ID");

  const { data: trade } = await supabase
    .from("trades")
    .select("id, receiver_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect("/dashboard?error=Trade+not+found");
  }

  if (trade.status !== "pending") {
    redirect("/dashboard?error=Trade+is+no+longer+pending");
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) {
    redirect("/dashboard?error=Failed+to+reject+trade");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?success=trade_rejected");
}
