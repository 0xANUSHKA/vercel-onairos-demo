import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/** True once the first reply is committed: track is set and NLP ran or we have stored intro text. */
export function isProfileIntroTextLocked(row: {
  gender: string | null | undefined;
  intro_nlp_version: string | null | undefined;
  intro_reply_raw: string | null | undefined;
}): boolean {
  const g = row.gender;
  if (g !== "MALE" && g !== "FEMALE") return false;
  if (row.intro_nlp_version != null && String(row.intro_nlp_version).trim() !== "") {
    return true;
  }
  if ((row.intro_reply_raw?.trim() ?? "") !== "") return true;
  return false;
}

/**
 * When intro text is set and a track (gender) is known, keep question sort_order=1
 * in sync for that track (onboarding_answers).
 */
export async function syncFirstQuestionAnswerForTrack(
  supabase: AdminClient,
  params: { profileId: string; gender: "MALE" | "FEMALE"; text: string }
) {
  const t = params.text.trim();
  if (!t) return;
  const { data: firstQ, error: qe } = await supabase
    .from("questions")
    .select("id")
    .eq("gender", params.gender)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (qe || !firstQ) return;
  const qid = (firstQ as { id: string }).id;
  const { error } = await supabase.from("onboarding_answers").upsert(
    {
      profile_id: params.profileId,
      question_id: qid,
      response_text: t,
    },
    { onConflict: "profile_id, question_id" }
  );
  if (error) throw new Error(error.message);
}
