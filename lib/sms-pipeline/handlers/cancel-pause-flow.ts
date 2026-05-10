import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAutomatedSms } from "@/lib/sms-pipeline/send-automated";

// Default pause duration: 24 hours
const PAUSE_DURATION_MS = 24 * 60 * 60 * 1000;

const CANCEL_CONFIRM =
  "got it. we've removed you from inyo. if you ever change your mind, just text us again and we'll get you set back up.";

const PAUSE_CONFIRM =
  "no problem. we'll pause things for 24 hours. we'll check back in tomorrow — if you want to extend your break just let us know.";

const ALREADY_PAUSED =
  "you're already on a break. we'll check in soon. if you want to cancel entirely, reply CANCEL.";

export async function handleCancel(profileId: string, phone: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from("onboarding_profiles")
    .update({
      account_status: "cancelled",
      scheduled_delete_at: deleteAt,
    })
    .eq("id", profileId);

  await sendAutomatedSms(phone, CANCEL_CONFIRM, "account_cancelled");
}

export async function handlePause(profileId: string, phone: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("onboarding_profiles")
    .select("account_status, paused_at")
    .eq("id", profileId)
    .single();

  if (data?.account_status === "paused") {
    await sendAutomatedSms(phone, ALREADY_PAUSED, "pause_already_active");
    return;
  }

  const now = new Date();
  const reengageAt = new Date(now.getTime() + PAUSE_DURATION_MS).toISOString();

  await supabase
    .from("onboarding_profiles")
    .update({
      account_status: "paused",
      paused_at: now.toISOString(),
      pause_reengagement_at: reengageAt,
    })
    .eq("id", profileId);

  await sendAutomatedSms(phone, PAUSE_CONFIRM, "account_paused");
}
