import type { SupabaseClient } from "@supabase/supabase-js";

export type QuestionTrack = "MALE" | "FEMALE";

/**
 * Remap onboarding_answers from one gender question list to the other by sort-order index.
 * Clears source-track rows after copying. If the destination track has no questions, still clears source answers.
 */
export async function migrateAnswersAcrossTracks(args: {
  supabase: SupabaseClient;
  profileId: string;
  fromTrack: QuestionTrack;
  toTrack: QuestionTrack;
}): Promise<void> {
  const { supabase, profileId, fromTrack, toTrack } = args;

  const { data: fromQs, error: fromErr } = await supabase
    .from("questions")
    .select("id, sort_order, created_at")
    .eq("gender", fromTrack)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (fromErr) throw new Error(fromErr.message);

  const { data: toQs, error: toErr } = await supabase
    .from("questions")
    .select("id, sort_order, created_at")
    .eq("gender", toTrack)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (toErr) throw new Error(toErr.message);

  const fromList = (fromQs ?? []) as { id: string }[];
  const toList = (toQs ?? []) as { id: string }[];
  const fromIds = fromList.map((q) => q.id);

  let sourceAnswers = new Map<string, string>();
  if (fromIds.length > 0) {
    const { data: ans, error: ansErr } = await supabase
      .from("onboarding_answers")
      .select("question_id, response_text")
      .eq("profile_id", profileId)
      .in("question_id", fromIds);
    if (ansErr) throw new Error(ansErr.message);
    sourceAnswers = new Map(
      (ans ?? []).map((row) => {
        const r = row as { question_id: string; response_text: string | null };
        return [r.question_id, String(r.response_text ?? "")] as const;
      })
    );
  }

  if (toList.length === 0) {
    if (fromIds.length > 0) {
      const { error: clearFromErr } = await supabase
        .from("onboarding_answers")
        .delete()
        .eq("profile_id", profileId)
        .in("question_id", fromIds);
      if (clearFromErr) throw new Error(clearFromErr.message);
    }
    return;
  }

  const toIds = toList.map((q) => q.id);

  if (toIds.length > 0) {
    const { error: clearToErr } = await supabase
      .from("onboarding_answers")
      .delete()
      .eq("profile_id", profileId)
      .in("question_id", toIds);
    if (clearToErr) throw new Error(clearToErr.message);
  }

  const upserts: { profile_id: string; question_id: string; response_text: string }[] = [];
  for (let i = 0; i < toList.length; i += 1) {
    const toQ = toList[i];
    const fromQ = fromList[i];
    if (!toQ || !fromQ) continue;
    const text = (sourceAnswers.get(fromQ.id) ?? "").trim();
    if (!text) continue;
    upserts.push({
      profile_id: profileId,
      question_id: toQ.id,
      response_text: text,
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from("onboarding_answers")
      .upsert(upserts, { onConflict: "profile_id,question_id" });
    if (upsertErr) throw new Error(upsertErr.message);
  }

  if (fromIds.length > 0) {
    const { error: clearFromErr } = await supabase
      .from("onboarding_answers")
      .delete()
      .eq("profile_id", profileId)
      .in("question_id", fromIds);
    if (clearFromErr) throw new Error(clearFromErr.message);
  }
}
