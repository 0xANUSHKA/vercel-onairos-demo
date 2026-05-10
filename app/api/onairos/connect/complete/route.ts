import { NextResponse } from "next/server";
import { parseOnairosLinkToken } from "@/lib/onairos-link-token";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Body = {
  token?: string;
  onairosCompletion?: unknown;
};

export async function POST(req: Request) {
  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const body = (await req.json()) as Body;
  const token = String(body.token ?? "").trim();
  const parsed = parseOnairosLinkToken(token);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid or expired Onairos link." }, { status: 400 });
  }
  if (body.onairosCompletion === undefined) {
    return NextResponse.json({ error: "onairosCompletion is required." }, { status: 400 });
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
  if (!(waitlistRows ?? [])[0]) {
    return NextResponse.json({ error: "Waitlist record not found for this link." }, { status: 404 });
  }

  const { error: updateErr } = await supabase
    .from("waitlist")
    .update({
      onairos_completion: body.onairosCompletion,
      onairos_traits_status: "pending",
      onairos_traits_error: null,
    })
    .eq("id", parsed.waitlistId)
    .eq("value", parsed.participantPhone);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
