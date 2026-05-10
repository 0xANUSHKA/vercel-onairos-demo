import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminApiRequest(req);
    if (!auth.ok) return auth.response;

    const missing = missingSupabaseAdminEnv();
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 503 }
      );
    }

    const url = new URL(req.url);
    const phone = (url.searchParams.get("phone") ?? "").trim();
    if (!phone) {
      return NextResponse.json({ error: "phone is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("sms_conversations")
      .select("id, participant_phone_e164, telnyx_phone_e164, provider, created_at, updated_at, last_message_at")
      .eq("participant_phone_e164", phone)
      .order("last_message_at", { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
