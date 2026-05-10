import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import {
  applyIntroExtractionToUpdates,
  extractIntroFieldsWithOpenAI,
  getOpenAILlmConfig,
} from "@/lib/intro-reply-llm";
import { isProfileIntroTextLocked } from "@/lib/onboarding-first-question";
import {
  migrateAnswersAcrossTracks,
  type QuestionTrack,
} from "@/lib/migrate-answers-across-tracks";
import {
  RESPONSE_TYPE_TEXT,
  defaultResponseType,
  isNonEmptyAnswerForType,
} from "@/lib/question-response";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(_request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id: profileId } = await params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("onboarding_answers")
    .select("id, question_id, response_text, updated_at")
    .eq("profile_id", profileId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

type AnswerItem = { question_id: string; response_text: string };

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id: profileId } = await params;
  const body = (await request.json()) as {
    answers?: AnswerItem[];
    /** Saved with the same request so a separate profile PATCH is not required. */
    gender?: "MALE" | "FEMALE" | null | string;
  };
  const answers = body.answers;
  if (!Array.isArray(answers)) {
    return NextResponse.json({ error: "answers must be an array." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: profBefore, error: pErr } = await supabase
    .from("onboarding_profiles")
    .select("id, gender, intro_nlp_version, intro_nlp_model, intro_reply_raw")
    .eq("id", profileId)
    .single();
  if (pErr || !profBefore) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  type ProfRow = {
    id: string;
    gender: string | null;
    intro_nlp_version: string | null;
    intro_nlp_model: string | null;
    intro_reply_raw: string | null;
  };
  const prof = profBefore as ProfRow;
  const beforeGender = prof.gender;

  if ("gender" in body) {
    const gIn = body.gender;
    const updateG: { gender: string | null } = { gender: null };
    if (gIn == null || (typeof gIn === "string" && gIn.trim() === "")) {
      updateG.gender = null;
    } else {
      const g = String(gIn).toUpperCase();
      if (g !== "MALE" && g !== "FEMALE") {
        return NextResponse.json({ error: "gender must be MALE, FEMALE, or null." }, { status: 400 });
      }
      updateG.gender = g;
    }
    const { error: uE } = await supabase
      .from("onboarding_profiles")
      .update(updateG)
      .eq("id", profileId);
    if (uE) return NextResponse.json({ error: uE.message }, { status: 500 });
    prof.gender = updateG.gender;

    const nextG = prof.gender;
    const shouldMigrate =
      (beforeGender === "MALE" || beforeGender === "FEMALE") &&
      (nextG === "MALE" || nextG === "FEMALE") &&
      beforeGender !== nextG;
    if (shouldMigrate) {
      try {
        await migrateAnswersAcrossTracks({
          supabase,
          profileId,
          fromTrack: beforeGender as QuestionTrack,
          toTrack: nextG as QuestionTrack,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to migrate answers for switched track.";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
  }

  if (!prof.gender) {
    return NextResponse.json(
      {
        error:
          "Track not set. Save a first reply (NLP) so we know MALE or FEMALE, or set track manually in the participant screen.",
      },
      { status: 400 }
    );
  }

  const g = prof.gender;

  const { data: allTrackQuestions, error: tqErr } = await supabase
    .from("questions")
    .select("id, gender, sort_order, response_type, created_at")
    .eq("gender", g)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (tqErr) {
    return NextResponse.json({ error: tqErr.message }, { status: 500 });
  }
  const trackQList = (allTrackQuestions ?? []) as {
    id: string;
    gender: string;
    sort_order: number;
    response_type: string | null;
  }[];
  const expectedIds = trackQList.map((q) => q.id);
  if (expectedIds.length === 0) {
    return NextResponse.json(
      { error: "No questions are defined for this track. Add them in the Questions screen first." },
      { status: 400 }
    );
  }

  const byId = new Map<string, string>();
  for (const a of answers) {
    if (!a.question_id) {
      return NextResponse.json(
        { error: "Each answer must include a question_id." },
        { status: 400 }
      );
    }
    byId.set(a.question_id, a.response_text == null ? "" : String(a.response_text));
  }
  for (const qid of expectedIds) {
    if (!byId.has(qid)) {
      return NextResponse.json(
        { error: "All questions for this track are required. Add an answer for each item before saving." },
        { status: 400 }
      );
    }
  }
  for (const a of answers) {
    if (a.question_id && !expectedIds.includes(a.question_id)) {
      return NextResponse.json(
        { error: "Each question_id must match a question for this track (MALE or FEMALE)." },
        { status: 400 }
      );
    }
  }

  const firstQ = trackQList[0];
  const firstQId = firstQ?.id;
  const firstQIsText = !firstQ || defaultResponseType(firstQ.response_type) === RESPONSE_TYPE_TEXT;
  const introLocked = isProfileIntroTextLocked({
    gender: prof.gender,
    intro_nlp_version: prof.intro_nlp_version,
    intro_reply_raw: prof.intro_reply_raw,
  });
  if (firstQId && firstQIsText && introLocked) {
    const introText = (prof.intro_reply_raw?.trim() ?? byId.get(firstQId) ?? "").trim();
    if (!introText) {
      return NextResponse.json(
        { error: "First intro text is missing; it can’t be empty while locked." },
        { status: 400 }
      );
    }
    byId.set(firstQId, introText);
  }

  for (const q of trackQList) {
    const raw = byId.get(q.id) ?? "";
    if (!isNonEmptyAnswerForType(raw, defaultResponseType(q.response_type))) {
      return NextResponse.json(
        {
          error:
            "All questions for this track are required. For image/audio/video/file steps, upload at least one file before saving.",
        },
        { status: 400 }
      );
    }
  }

  const rows = expectedIds.map((qid) => ({
    profile_id: profileId,
    question_id: qid,
    response_text: byId.get(qid) ?? "",
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("onboarding_answers")
      .upsert(rows, { onConflict: "profile_id, question_id" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  let intro_nlp_auto = false;
  let intro_nlp_error: string | undefined;

  const { data: firstAnsRow } = firstQId
    ? await supabase
        .from("onboarding_answers")
        .select("response_text")
        .eq("profile_id", profileId)
        .eq("question_id", firstQId)
        .maybeSingle()
    : { data: null };

  const firstText = (firstAnsRow as { response_text?: string } | null | undefined)?.response_text?.trim() ?? "";
  const { apiKey, model } = getOpenAILlmConfig();
  if (apiKey && firstQId && firstText && !prof.intro_nlp_version && firstQIsText) {
    try {
      const extracted = await extractIntroFieldsWithOpenAI({ text: firstText, apiKey, model });
      const nlpUp = {
        ...applyIntroExtractionToUpdates(extracted, model),
        intro_reply_raw: firstText,
      } as Record<string, unknown>;
      const { error: pU } = await supabase
        .from("onboarding_profiles")
        .update(nlpUp)
        .eq("id", profileId);
      if (!pU) {
        intro_nlp_auto = true;
      }
    } catch (e) {
      intro_nlp_error = e instanceof Error ? e.message : "NLP failed.";
    }
  }

  const { data: outAnswers } = await supabase
    .from("onboarding_answers")
    .select("id, question_id, response_text, updated_at")
    .eq("profile_id", profileId);

  const { data: profileOut, error: prE } = await supabase
    .from("onboarding_profiles")
    .select("*, waitlist (id, value, city, created_at)")
    .eq("id", profileId)
    .single();
  if (prE) {
    return NextResponse.json({ error: prE.message }, { status: 500 });
  }

  return NextResponse.json({
    data: outAnswers ?? [],
    profile: profileOut,
    intro_nlp_auto,
    intro_nlp_error,
  });
}