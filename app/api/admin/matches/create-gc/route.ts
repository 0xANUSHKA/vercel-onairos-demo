import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { createMatchGroupChat } from "@/lib/match-notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { matchId?: string };
  if (!body.matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: match, error } = await supabase
    .from("proposed_matches")
    .select("id, user_a_id, user_b_id, status")
    .eq("id", body.matchId)
    .single();

  if (error || !match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (match.status !== "mutual_yes") return NextResponse.json({ error: `Match status is '${match.status}', expected 'mutual_yes'` }, { status: 400 });

  const { data: profiles } = await supabase
    .from("onboarding_profiles")
    .select("id, phone_e164")
    .in("id", [match.user_a_id, match.user_b_id]);

  const pMap = new Map((profiles ?? []).map((p: { id: string; phone_e164: string }) => [p.id, p.phone_e164]));
  const phoneA = pMap.get(match.user_a_id);
  const phoneB = pMap.get(match.user_b_id);

  if (!phoneA || !phoneB) return NextResponse.json({ error: "Could not fetch phone numbers" }, { status: 500 });

  try {
    const result = await createMatchGroupChat(match.id, match.user_a_id, match.user_b_id, phoneA, phoneB);
    return NextResponse.json({ ok: true, linq_chat_id: result.linqChatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Group chat creation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
