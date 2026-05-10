import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { matchId?: string; slot?: string; enabled?: boolean };
  if (!body.matchId) return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  if (body.slot !== "a" && body.slot !== "b")
    return NextResponse.json({ error: "slot must be 'a' or 'b'" }, { status: 400 });
  if (typeof body.enabled !== "boolean")
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });

  const column = body.slot === "a" ? "user_a_auto_reply_enabled" : "user_b_auto_reply_enabled";
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("proposed_matches")
    .update({ [column]: body.enabled })
    .eq("id", body.matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
