import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("proposed_matches")
    .select("id, user_a_id, user_b_id, linq_chat_id, gc_created_at, last_inbound_at, admin_read_at, user_a_auto_reply_enabled, user_b_auto_reply_enabled")
    .eq("status", "introduced")
    .order("gc_created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data?.length) return NextResponse.json({ data: [] });

  // Fetch both profiles for each match
  const profileIds = [...new Set(data.flatMap((m) => [m.user_a_id, m.user_b_id]))];
  const { data: profiles } = await supabase
    .from("onboarding_profiles")
    .select("id, display_name, age, gender, city, phone_e164")
    .in("id", profileIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const enriched = data.map((m) => ({
    ...m,
    user_a: profileMap.get(m.user_a_id) ?? null,
    user_b: profileMap.get(m.user_b_id) ?? null,
  }));

  return NextResponse.json({ data: enriched });
}
