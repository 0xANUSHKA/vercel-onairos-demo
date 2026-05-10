import { NextResponse } from "next/server";
import { parseOnairosLinkToken } from "@/lib/onairos-link-token";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const parsed = parseOnairosLinkToken(token);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or expired Onairos link." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: waitlistRows, error: waitlistErr } = await supabase
    .from("waitlist")
    .select("id, value")
    .eq("id", parsed.waitlistId)
    .eq("value", parsed.participantPhone)
    .limit(1);
  if (waitlistErr) {
    return NextResponse.json({ error: waitlistErr.message }, { status: 500 });
  }
  const waitlistRow = (waitlistRows ?? [])[0];
  if (!waitlistRow) {
    return NextResponse.json({ error: "Waitlist record not found for this link." }, { status: 404 });
  }

  const { data: profileRows, error: profileErr } = await supabase
    .from("onboarding_profiles")
    .select("id, waitlist_id, phone_e164")
    .eq("id", parsed.profileId)
    .eq("waitlist_id", parsed.waitlistId)
    .limit(1);
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }
  const profileRow = (profileRows ?? [])[0];
  if (!profileRow) {
    return NextResponse.json({ error: "Profile record not found for this link." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    phone: parsed.participantPhone,
  });
}
