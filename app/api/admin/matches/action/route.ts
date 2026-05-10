import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { sendMatchInvites } from "@/lib/match-notifications";

export const dynamic = "force-dynamic";

type ActionBody = {
  action?: string;
  matchId?: string;
  userAId?: string;
  userBId?: string;
  score?: number;
  reasons?: string[];
  reasoning?: string | null;
  risks?: string[] | null;
  suggested_intro_hook?: string | null;
  dimensions?: Record<string, number> | null;
};

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as ActionBody;
  const { action, matchId, userAId, userBId } = body;

  if (action !== "approve" && action !== "reject" && action !== "delete") {
    return NextResponse.json({ error: "action must be 'approve', 'reject', or 'delete'" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // ── Delete: hard-remove by matchId or by user pair ────────────────────────
  if (action === "delete") {
    if (!matchId && (!userAId || !userBId)) {
      return NextResponse.json({ error: "matchId or userAId+userBId required" }, { status: 400 });
    }
    let deleteQuery = supabase.from("proposed_matches").delete();
    if (matchId) {
      deleteQuery = deleteQuery.eq("id", matchId);
    } else {
      const [canonicalA, canonicalB] = [userAId!, userBId!].sort();
      deleteQuery = deleteQuery.eq("user_a_id", canonicalA).eq("user_b_id", canonicalB);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  if (!userAId || !userBId) {
    return NextResponse.json({ error: "userAId and userBId are required" }, { status: 400 });
  }
  if (userAId === userBId) {
    return NextResponse.json({ error: "userAId and userBId must be different" }, { status: 400 });
  }

  // Canonical ordering: lower UUID first so (A,B) and (B,A) map to the same row
  const [canonicalA, canonicalB] = [userAId, userBId].sort();

  const status = action === "approve" ? "approved" : "rejected_by_founder";
  const now = new Date().toISOString();

  const upsertData: Record<string, unknown> = {
    user_a_id: canonicalA,
    user_b_id: canonicalB,
    compatibility_score: body.score ?? 0,
    score_breakdown: body.dimensions ?? null,
    reasoning: body.reasoning ?? null,
    risks: body.risks ?? null,
    suggested_intro_hook: body.suggested_intro_hook ?? null,
    reasons: body.reasons ?? [],
    status,
    updated_at: now,
  };

  if (action === "approve") {
    upsertData.approved_by_founder_at = now;
  }

  const { data: matchData, error: matchError } = await supabase
    .from("proposed_matches")
    .upsert(upsertData, { onConflict: "user_a_id,user_b_id" })
    .select("id")
    .single();

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 });
  }

  const savedMatchId = matchData!.id as string;

  if (action === "reject") {
    const { error: excludeError } = await supabase
      .from("excluded_pairs")
      .upsert(
        {
          user_a_id: canonicalA,
          user_b_id: canonicalB,
          reason: "rejected_by_founder",
          match_id: savedMatchId,
        },
        { onConflict: "user_a_id,user_b_id" },
      );

    if (excludeError) {
      return NextResponse.json({ error: excludeError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status, match_id: savedMatchId });
  }

  // ── Approve: send invite messages to both users ────────────────────────────
  try {
    const inviteResult = await sendMatchInvites(
      savedMatchId,
      canonicalA,
      canonicalB,
      body.reasons ?? [],
    );

    return NextResponse.json({
      ok: true,
      status: "awaiting_responses",
      match_id: savedMatchId,
      invites: {
        user_a_chat_id: inviteResult.userAInviteChatId,
        user_b_chat_id: inviteResult.userBInviteChatId,
        expires_at: inviteResult.expiresAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send match invites.";
    console.error("[approve] sendMatchInvites failed:", err);

    // Roll back status to approved so admin can retry
    await supabase
      .from("proposed_matches")
      .update({ status: "approved" })
      .eq("id", savedMatchId);

    return NextResponse.json({ error: `Match saved but invites failed: ${message}` }, { status: 502 });
  }
}
