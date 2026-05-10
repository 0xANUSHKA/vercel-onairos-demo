import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { matchId?: string };
  if (!body.matchId)
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("proposed_matches")
    .update({ admin_read_at: new Date().toISOString() })
    .eq("id", body.matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
