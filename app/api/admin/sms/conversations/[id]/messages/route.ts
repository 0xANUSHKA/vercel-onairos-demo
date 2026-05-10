import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
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

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Conversation id is required." }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("sms_messages")
      .select(
        "id, conversation_id, direction, from_phone_e164, to_phone_e164, body, provider, event_type, status, created_at"
      )
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
