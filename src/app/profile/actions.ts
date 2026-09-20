"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const MAX_DISPLAY_NAME_LENGTH = 40;

/** Update the signed-in user's global display name (profiles.display_name). */
export async function updateDisplayNameAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const displayName = ((formData.get("display_name") as string) ?? "").trim();

  if (!displayName) {
    redirect(
      `/profile?error=${encodeURIComponent("Display name is required.")}`
    );
  }

  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    redirect(
      `/profile?error=${encodeURIComponent(
        `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`
      )}`
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (error) {
    redirect(
      `/profile?error=${encodeURIComponent(
        "Failed to update display name. Please try again."
      )}`
    );
  }

  revalidatePath("/profile");
  redirect(
    `/profile?success=${encodeURIComponent("Display name updated.")}`
  );
}
