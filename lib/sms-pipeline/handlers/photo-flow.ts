import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAutomatedSms } from "@/lib/sms-pipeline/send-automated";

const PHOTO_SKIP_LIMIT = 3;

const DECLINE_REPLIES = [
  "totally ok. photos are optional — they just help with introductions. want to skip them for now and continue?",
  "no worries at all. we can move on without them. just reply PHOTOS any time if you change your mind.",
  "got it. skipping photos for now. you can always send them later by replying PHOTOS.",
];

const SKIP_CONFIRMATION =
  "photos skipped. we'll introduce you based on everything else you've shared — works just as well.";

const QUESTION_REPLY =
  "photos are completely optional. they just help the person you're matched with feel more comfortable saying yes. " +
  "you can send up to 5, and only your match sees them. reply PHOTOS to add them, or just keep going without.";

export async function handlePhotoDecline(
  profileId: string,
  phone: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("onboarding_profiles")
    .select("photo_decline_count, photos_skipped")
    .eq("id", profileId)
    .single();

  const count = (data?.photo_decline_count ?? 0) + 1;
  const alreadySkipped = data?.photos_skipped ?? false;

  if (alreadySkipped) return;

  if (count >= PHOTO_SKIP_LIMIT) {
    await supabase
      .from("onboarding_profiles")
      .update({ photo_decline_count: count, photos_skipped: true })
      .eq("id", profileId);

    await sendAutomatedSms(phone, SKIP_CONFIRMATION, "photo_skipped");
    return;
  }

  await supabase
    .from("onboarding_profiles")
    .update({ photo_decline_count: count })
    .eq("id", profileId);

  const reply = DECLINE_REPLIES[Math.min(count - 1, DECLINE_REPLIES.length - 1)];
  await sendAutomatedSms(phone, reply, "photo_decline_reply");
}

export async function handlePhotoQuestion(phone: string): Promise<void> {
  await sendAutomatedSms(phone, QUESTION_REPLY, "photo_question_reply");
}

/** Called when user texts "PHOTOS" — clears skip flag and re-prompts for photos */
export async function handlePhotosKeyword(
  profileId: string,
  phone: string,
  currentPhotoQuestion: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  await supabase
    .from("onboarding_profiles")
    .update({ photos_skipped: false, photo_decline_count: 0 })
    .eq("id", profileId);

  await sendAutomatedSms(phone, currentPhotoQuestion, "photo_reprompt");
}
