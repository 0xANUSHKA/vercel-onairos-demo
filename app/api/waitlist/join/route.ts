import { NextResponse } from "next/server";
import { normalizePhoneForStorage, phoneLookupCandidates } from "@/lib/phone-e164";
import { isPhoneSmsBanned } from "@/lib/sms-phone-ban";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { buildWaitlistJoinRow } from "@/lib/waitlist-join";

export const dynamic = "force-dynamic";

type JoinBody = {
  phoneE164?: string;
  consent?: {
    is18Plus?: boolean;
    termsAccepted?: boolean;
    smsConsent?: boolean;
    liabilityUnderstood?: boolean;
  };
  onairosCompletion?: unknown;
};

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseAdminEnv();
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 503 }
      );
    }

    const body = (await req.json()) as JoinBody;
    const phoneE164 = String(body.phoneE164 ?? "").trim();
    if (!phoneE164) {
      return NextResponse.json({ error: "phoneE164 is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const normalized = normalizePhoneForStorage(phoneE164);
    if (await isPhoneSmsBanned(supabase, phoneLookupCandidates(phoneE164))) {
      return NextResponse.json({ error: "not_accepted" }, { status: 403 });
    }

    const row = buildWaitlistJoinRow({
      phoneE164: normalized,
      consent: body.consent,
      onairosCompletion: body.onairosCompletion,
    });

    const { data, error } = await supabase
      .from("waitlist")
      .insert([row])
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, waitlistId: data?.id ?? null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
