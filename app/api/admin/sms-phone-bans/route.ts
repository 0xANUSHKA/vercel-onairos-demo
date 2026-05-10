import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { normalizePhoneForStorage } from "@/lib/phone-e164";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await verifyAdminApiRequest(req);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sms_phone_bans")
    .select("phone_e164, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await verifyAdminApiRequest(req);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });
  }

  const body = (await req.json()) as { phone_e164?: unknown; reason?: unknown };
  const raw = String(body.phone_e164 ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "phone_e164 is required." }, { status: 400 });
  }
  const phone_e164 = normalizePhoneForStorage(raw);
  const reason = String(body.reason ?? "").trim() || null;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("sms_phone_bans").upsert({ phone_e164, reason }, { onConflict: "phone_e164" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, phone_e164 });
}

export async function DELETE(req: Request) {
  const auth = await verifyAdminApiRequest(req);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });
  }

  const body = (await req.json()) as { phone_e164?: unknown };
  const raw = String(body.phone_e164 ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "phone_e164 is required." }, { status: 400 });
  }
  const phone_e164 = normalizePhoneForStorage(raw);

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase.from("sms_phone_bans").delete({ count: "exact" }).eq("phone_e164", phone_e164);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: (count ?? 0) > 0 });
}
