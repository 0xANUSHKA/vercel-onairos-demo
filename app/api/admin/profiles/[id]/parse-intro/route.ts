import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import {
  applyIntroExtractionToUpdates,
  extractIntroFieldsWithOpenAI,
  getOpenAILlmConfig,
} from "@/lib/intro-reply-llm";
import { isProfileIntroTextLocked, syncFirstQuestionAnswerForTrack } from "@/lib/onboarding-first-question";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * POST body:
 * - text?: string — if omitted, uses stored intro_reply_raw
 * - apply?: boolean — if true, write extracted fields to onboarding_profiles
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const adminMissing = missingSupabaseAdminEnv();
  if (adminMissing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${adminMissing.join(", ")}` },
      { status: 503 }
    );
  }

  const { apiKey, model } = getOpenAILlmConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "NLP is not configured: set OPENAI_API_KEY on the server." },
      { status: 503 }
    );
  }

  const { id: profileId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    apply?: boolean;
  };

  const supabase = getSupabaseAdmin();
  const { data: prof, error: pErr } = await supabase
    .from("onboarding_profiles")
    .select(
      "id, intro_reply_raw, phone_e164, updated_at, waitlist_id, gender, display_name, age, height, created_at, intro_nlp_version, intro_nlp_model"
    )
    .eq("id", profileId)
    .single();

  if (pErr || !prof) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const text = (body.text?.trim() ?? (prof as { intro_reply_raw?: string | null }).intro_reply_raw?.trim() ?? "");
  if (!text) {
    return NextResponse.json(
      { error: "Add a first reply (raw) or pass text in the request body." },
      { status: 400 }
    );
  }

  let extracted: Awaited<ReturnType<typeof extractIntroFieldsWithOpenAI>>;
  try {
    extracted = await extractIntroFieldsWithOpenAI({ text, apiKey, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : "NLP request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!body.apply) {
    return NextResponse.json({
      data: {
        ...extracted,
        model,
        profile_id: profileId,
      },
    });
  }

  if (
    isProfileIntroTextLocked(
      prof as {
        gender: string | null;
        intro_nlp_version: string | null;
        intro_reply_raw: string | null;
      }
    )
  ) {
    return NextResponse.json(
      { error: "The first intro is locked after the track is confirmed; it can’t be re-parsed in place." },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {
    ...applyIntroExtractionToUpdates(extracted, model),
    intro_reply_raw: text,
  };

  const { data: updated, error: uErr } = await supabase
    .from("onboarding_profiles")
    .update(updates)
    .eq("id", profileId)
    .select("*, waitlist (id, value, city, created_at)")
    .single();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  const g = (updated as { gender?: string | null }).gender;
  if (g === "MALE" || g === "FEMALE") {
    try {
      await syncFirstQuestionAnswerForTrack(supabase, {
        profileId,
        gender: g,
        text,
      });
    } catch {
      // profile fields still saved; Q1 can be fixed on next save
    }
  }

  return NextResponse.json({
    data: {
      ...extracted,
      model,
      profile_id: profileId,
      profile: updated,
    },
  });
}
