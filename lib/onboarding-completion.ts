import { countFileUrlsInAnswerString, defaultResponseType } from "@/lib/question-response";
import type { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

type QuestionRow = { id: string; response_type: string | null; min_file_count?: number | null };

/** A profile is complete once they have uploaded the required number of photos. */
export async function isProfileOnboardingComplete(
  supabase: AdminClient,
  params: { profileId: string; gender: "MALE" | "FEMALE" }
): Promise<boolean> {
  const { data: qs, error: qe } = await supabase
    .from("questions")
    .select("id, response_type, min_file_count")
    .eq("gender", params.gender);
  if (qe || !qs?.length) return false;

  const imageQuestions = (qs as QuestionRow[]).filter(
    (q) => defaultResponseType(q.response_type) === "IMAGE"
  );
  if (!imageQuestions.length) return false;

  const imageQIds = imageQuestions.map((q) => q.id);
  const { data: rows, error: ae } = await supabase
    .from("onboarding_answers")
    .select("question_id, response_text")
    .eq("profile_id", params.profileId)
    .in("question_id", imageQIds);
  if (ae) return false;

  const byQ = new Map(
    (rows ?? []).map((r) => {
      const x = r as { question_id: string; response_text: string | null };
      return [x.question_id, x.response_text] as const;
    })
  );

  return imageQuestions.some((q) => {
    const required = q.min_file_count ?? 1;
    const uploaded = countFileUrlsInAnswerString(byQ.get(q.id) ?? null);
    return uploaded >= required;
  });
}

/**
 * Returns all profiles for a track that have uploaded the required number of photos.
 * Gender filter is relaxed to also include re-onboarded profiles with null gender
 * that have completed the stage.
 */
export async function getCompletedProfilesForTrack(
  supabase: AdminClient,
  track: "MALE" | "FEMALE"
): Promise<unknown[]> {
  const { data: qs, error: qe } = await supabase
    .from("questions")
    .select("id, response_type, min_file_count")
    .eq("gender", track);
  if (qe || !qs?.length) return [];

  const qList = qs as QuestionRow[];
  const imageQuestions = qList.filter((q) => defaultResponseType(q.response_type) === "IMAGE");

  // Fetch profiles matching the gender track, plus null-gender profiles that
  // finished the flow (re-onboarded after deletion with failed gender extraction).
  const { data: profiles, error: pe } = await supabase
    .from("onboarding_profiles")
    .select("*, waitlist (id, value, city, created_at)")
    .or(`gender.eq.${track},and(gender.is.null,sms_onboarding_stage.eq.sms_onboarding_complete)`);
  if (pe || !profiles?.length) return [];

  const typedProfiles = profiles as { id: string; sms_onboarding_stage?: string | null }[];
  const pids = typedProfiles.map((p) => p.id);

  // Only need image question answers to evaluate completion
  const imageQIds = imageQuestions.map((q) => q.id);

  let answerRows: { profile_id: string; question_id: string; response_text: string | null }[] = [];
  if (imageQIds.length > 0) {
    const { data, error: ae } = await supabase
      .from("onboarding_answers")
      .select("profile_id, question_id, response_text")
      .in("profile_id", pids)
      .in("question_id", imageQIds);
    if (ae) return [];
    answerRows = (data ?? []) as typeof answerRows;
  }

  // Build profile_id → question_id → response_text map
  const byProfile = new Map<string, Map<string, string | null>>();
  for (const r of answerRows) {
    if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, new Map());
    byProfile.get(r.profile_id)!.set(r.question_id, r.response_text);
  }

  return typedProfiles.filter((p) => {
    const amap = byProfile.get(p.id);

    // Primary criterion: uploaded the required number of photos
    if (imageQuestions.length > 0 && amap) {
      const hasRequiredPhotos = imageQuestions.some((q) => {
        const required = q.min_file_count ?? 1;
        const uploaded = countFileUrlsInAnswerString(amap.get(q.id) ?? null);
        return uploaded >= required;
      });
      if (hasRequiredPhotos) return true;
    }

    // Fallback: completed the full SMS flow (covers edge cases where photo
    // question was skipped but stage is explicitly marked done)
    return p.sms_onboarding_stage === "sms_onboarding_complete";
  });
}
