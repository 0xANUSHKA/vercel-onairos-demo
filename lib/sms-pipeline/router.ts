import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhoneForStorage } from "@/lib/phone-e164";
import { processSmsOnboardingInbound } from "@/lib/sms-onboarding-inbound";
import { classifySms } from "@/lib/sms-pipeline/classifier";
import { handlePhotoDecline, handlePhotoQuestion, handlePhotosKeyword } from "@/lib/sms-pipeline/handlers/photo-flow";
import { handleCancel, handlePause } from "@/lib/sms-pipeline/handlers/cancel-pause-flow";
import { handlePreferenceCapture } from "@/lib/sms-pipeline/handlers/preference-capture";
import { handleFaq } from "@/lib/sms-pipeline/handlers/faq";
import { isFileLikeResponseType } from "@/lib/question-response";

export type SmsRouterArgs = {
  participantPhone: string;
  inboundText: string;
  inboundMediaUrls?: string[];
  inboundEventType: string;
  isInbound: boolean;
};

type ProfileRow = {
  id: string;
  account_status: string | null;
  photos_skipped: boolean | null;
  sms_active_question_id: string | null;
};

type QuestionRow = {
  response_type: string | null;
  question: string | null;
};

async function fetchProfile(phone: string): Promise<ProfileRow | null> {
  const supabase = getSupabaseAdmin();
  const normalized = normalizePhoneForStorage(phone);

  const { data } = await supabase
    .from("onboarding_profiles")
    .select("id, account_status, photos_skipped, sms_active_question_id")
    .eq("phone_e164", normalized)
    .maybeSingle();

  return (data as ProfileRow | null) ?? null;
}

async function fetchActiveQuestion(questionId: string): Promise<QuestionRow | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("questions")
    .select("response_type, question")
    .eq("id", questionId)
    .maybeSingle();
  return (data as QuestionRow | null) ?? null;
}

/**
 * Main SMS entry point.
 * When SMS_PIPELINE_V2=true, this intercepts recognized intents before
 * falling through to processSmsOnboardingInbound for everything else.
 * When the flag is off, it delegates directly to the existing handler.
 */
export async function routeSmsInbound(args: SmsRouterArgs): Promise<void> {
  if (!args.isInbound) return;

  const v2Enabled = process.env.SMS_PIPELINE_V2 === "true";

  if (!v2Enabled) {
    await processSmsOnboardingInbound(args);
    return;
  }

  const text = args.inboundText.trim();
  const phone = args.participantPhone;

  // PHOTOS keyword: re-prompts the current photo question
  if (text.toUpperCase() === "PHOTOS") {
    const profile = await fetchProfile(phone);
    if (profile?.id && profile.sms_active_question_id) {
      const qRow = await fetchActiveQuestion(profile.sms_active_question_id);
      if (qRow?.question && isFileLikeResponseType(qRow.response_type)) {
        await handlePhotosKeyword(profile.id, phone, qRow.question);
        return;
      }
    }
    // No active photo question — fall through
    await processSmsOnboardingInbound(args);
    return;
  }

  const { intent } = await classifySms(text);

  // Unknown intent → fall through to existing pipeline unchanged
  if (intent === "unknown") {
    await processSmsOnboardingInbound(args);
    return;
  }

  // Fetch profile for handlers that need it
  const profile = await fetchProfile(phone);

  switch (intent) {
    case "photo_decline": {
      if (profile?.id) {
        await handlePhotoDecline(profile.id, phone);
      }
      break;
    }
    case "photo_question": {
      await handlePhotoQuestion(phone);
      break;
    }
    case "cancel": {
      if (profile?.id) {
        await handleCancel(profile.id, phone);
      }
      break;
    }
    case "pause": {
      if (profile?.id) {
        await handlePause(profile.id, phone);
      }
      break;
    }
    case "preference_capture": {
      if (profile?.id) {
        await handlePreferenceCapture(profile.id, phone, text);
      }
      break;
    }
    case "faq": {
      await handleFaq(phone, text);
      break;
    }
    default: {
      await processSmsOnboardingInbound(args);
    }
  }
}
