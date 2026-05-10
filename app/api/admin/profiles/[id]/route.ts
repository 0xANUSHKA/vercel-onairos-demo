import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import {
  applyIntroExtractionToUpdates,
  extractIntroFieldsWithOpenAI,
  getOpenAILlmConfig,
} from "@/lib/intro-reply-llm";
import { isProfileOnboardingComplete } from "@/lib/onboarding-completion";
import { isProfileIntroTextLocked, syncFirstQuestionAnswerForTrack } from "@/lib/onboarding-first-question";
import {
  migrateAnswersAcrossTracks,
  type QuestionTrack,
} from "@/lib/migrate-answers-across-tracks";
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

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: rows, error } = await supabase
    .from("onboarding_profiles")
    .select("*, waitlist (id, value, city, created_at)")
    .eq("id", id)
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const data = (rows ?? [])[0];
  if (!data) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  const row = data as { gender?: string | null };
  let onboarding_complete = false;
  if (row.gender === "MALE" || row.gender === "FEMALE") {
    onboarding_complete = await isProfileOnboardingComplete(supabase, {
      profileId: id,
      gender: row.gender,
    });
  }
  return NextResponse.json({ data: { ...data, onboarding_complete } });
}

export async function PATCH(
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

  const { id } = await params;
  const body = (await request.json()) as {
    gender?: string | null;
    display_name?: string | null;
    age?: number | null;
    height?: string | null;
    intro_reply_raw?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if ("gender" in body) {
    if (body.gender === null || body.gender === "" || body.gender === undefined) {
      updates.gender = null;
    } else {
      const g = String(body.gender).toUpperCase();
      if (g !== "MALE" && g !== "FEMALE") {
        return NextResponse.json(
          { error: "gender must be MALE, FEMALE, or empty." },
          { status: 400 }
        );
      }
      updates.gender = g;
    }
  }
  if ("display_name" in body) updates.display_name = body.display_name?.trim() || null;
  if ("age" in body) {
    if (body.age == null) updates.age = null;
    else {
      const n = Number(body.age);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        return NextResponse.json({ error: "age must be between 1 and 120 or empty." }, { status: 400 });
      }
      updates.age = n;
    }
  }
  if ("height" in body) updates.height = body.height?.trim() || null;
  if ("intro_reply_raw" in body) {
    updates.intro_reply_raw = body.intro_reply_raw?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: before, error: beforeError } = await supabase
    .from("onboarding_profiles")
    .select("intro_reply_raw, gender, intro_nlp_version")
    .eq("id", id)
    .single();

  if (beforeError) {
    const st = (beforeError as { code?: string }).code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: beforeError.message }, { status: st });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (
    "intro_reply_raw" in body &&
    isProfileIntroTextLocked(
      before as { gender: string | null; intro_nlp_version: string | null; intro_reply_raw: string | null }
    )
  ) {
    const beforeIntro = (before as { intro_reply_raw?: string | null }).intro_reply_raw?.trim() ?? "";
    const nextIntro =
      body.intro_reply_raw == null ? "" : String(body.intro_reply_raw).trim();
    if (nextIntro !== beforeIntro) {
      return NextResponse.json(
        { error: "First intro text can’t be changed after the track and intro are confirmed." },
        { status: 400 }
      );
    }
  }

  const beforeG = (before as { gender?: string | null }).gender;
  const introInBody = "intro_reply_raw" in body;
  const newIntroText = introInBody
    ? body.intro_reply_raw == null
      ? ""
      : String(body.intro_reply_raw).trim()
    : "";

  let intro_nlp_error: string | null = null;
  let intro_nlp_auto = false;
  const nextG = (updates.gender as string | null | undefined) ?? beforeG ?? null;
  const shouldMigrateTrackAnswers =
    (beforeG === "MALE" || beforeG === "FEMALE") &&
    (nextG === "MALE" || nextG === "FEMALE") &&
    beforeG !== nextG;
  const needTrackFromNlp = introInBody && newIntroText.length > 0 && !beforeG;
  if (needTrackFromNlp) {
    const { apiKey, model } = getOpenAILlmConfig();
    if (apiKey) {
      try {
        const extracted = await extractIntroFieldsWithOpenAI({ text: newIntroText, apiKey, model });
        Object.assign(updates, applyIntroExtractionToUpdates(extracted, model));
        intro_nlp_auto = true;
      } catch (e) {
        intro_nlp_error = e instanceof Error ? e.message : "NLP failed.";
      }
    }
  }

  const { data, error } = await supabase
    .from("onboarding_profiles")
    .update(updates)
    .eq("id", id)
    .select("*, waitlist (id, value, city, created_at)")
    .single();

  if (error) {
    const st = error.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status: st });
  }

  if (shouldMigrateTrackAnswers) {
    try {
      await migrateAnswersAcrossTracks({
        supabase,
        profileId: id,
        fromTrack: beforeG as QuestionTrack,
        toTrack: nextG as QuestionTrack,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to migrate answers for switched track.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const { data: reloaded, error: reloadErr } = await supabase
    .from("onboarding_profiles")
    .select("*, waitlist (id, value, city, created_at)")
    .eq("id", id)
    .single();
  if (reloadErr) {
    const st = reloadErr.code === "PGRST116" ? 404 : 500;
    return NextResponse.json({ error: reloadErr.message }, { status: st });
  }

  const outG = (reloaded as { gender?: string | null; intro_reply_raw?: string | null })?.gender;
  const outIntro = (reloaded as { intro_reply_raw?: string | null })?.intro_reply_raw;
  if ((outG === "MALE" || outG === "FEMALE") && outIntro?.trim()) {
    try {
      await syncFirstQuestionAnswerForTrack(supabase, {
        profileId: id,
        gender: outG,
        text: outIntro,
      });
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({
    data: reloaded,
    intro_nlp_auto: intro_nlp_auto || false,
    intro_nlp_error: intro_nlp_error ?? undefined,
  });
}

export async function DELETE(
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

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Profile id is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingErr } = await supabase
    .from("onboarding_profiles")
    .select("id, phone_e164, waitlist_id")
    .eq("id", id)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (!existing?.id) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const phone = String((existing as { phone_e164?: string | null }).phone_e164 ?? "").trim();
  const waitlistId = (existing as { waitlist_id?: string | number | null }).waitlist_id;

  // 1) Delete the profile (cascades onboarding_answers and onboarding_sms_transcript).
  const { error: deleteProfileErr } = await supabase
    .from("onboarding_profiles")
    .delete()
    .eq("id", id);

  if (deleteProfileErr) {
    return NextResponse.json({ error: deleteProfileErr.message }, { status: 500 });
  }

  // 2) Delete related waitlist rows by id and/or matching phone.
  const waitlistDeletedIds = new Set<string>();
  if (waitlistId != null) {
    const waitlistIdStr = String(waitlistId);
    const { data: deletedById, error: waitlistByIdErr } = await supabase
      .from("waitlist")
      .delete()
      .eq("id", waitlistIdStr)
      .select("id");
    if (waitlistByIdErr) {
      return NextResponse.json({ error: waitlistByIdErr.message }, { status: 500 });
    }
    for (const row of deletedById ?? []) {
      waitlistDeletedIds.add(String((row as { id: string | number }).id));
    }
  }
  if (phone) {
    const { data: deletedByPhone, error: waitlistByPhoneErr } = await supabase
      .from("waitlist")
      .delete()
      .eq("value", phone)
      .select("id");
    if (waitlistByPhoneErr) {
      return NextResponse.json({ error: waitlistByPhoneErr.message }, { status: 500 });
    }
    for (const row of deletedByPhone ?? []) {
      waitlistDeletedIds.add(String((row as { id: string | number }).id));
    }
  }

  // 3) Delete SMS conversations + messages connected to this number.
  const conversationIds = new Set<string>();
  if (phone) {
    const { data: convoRows, error: convoErr } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("participant_phone_e164", phone);
    if (convoErr) {
      return NextResponse.json({ error: convoErr.message }, { status: 500 });
    }
    for (const row of convoRows ?? []) {
      const cid = (row as { id?: string | null }).id;
      if (cid) conversationIds.add(cid);
    }

    // Also remove message rows that may exist outside conversation links.
    const { error: msgFromErr } = await supabase
      .from("sms_messages")
      .delete()
      .eq("from_phone_e164", phone);
    if (msgFromErr) {
      return NextResponse.json({ error: msgFromErr.message }, { status: 500 });
    }
    const { error: msgToErr } = await supabase
      .from("sms_messages")
      .delete()
      .eq("to_phone_e164", phone);
    if (msgToErr) {
      return NextResponse.json({ error: msgToErr.message }, { status: 500 });
    }

    const { error: convoDeleteErr } = await supabase
      .from("sms_conversations")
      .delete()
      .eq("participant_phone_e164", phone);
    if (convoDeleteErr) {
      return NextResponse.json({ error: convoDeleteErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    deleted_profile_id: id,
    deleted_waitlist_ids: [...waitlistDeletedIds],
    deleted_sms_conversation_ids: [...conversationIds],
  });
}
