import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { phoneLookupCandidates } from "@/lib/phone-e164";
import { isPhoneSmsBanned } from "@/lib/sms-phone-ban";
import { isNanpE164 } from "@/lib/sms-onboarding-helpers";
import { startSmsOnboardingForParticipant } from "@/lib/sms-onboarding-inbound";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function normalizeUsPhone(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function POST(req: Request) {
  const auth = await verifyAdminApiRequest(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as { to?: unknown };
  const normalized = normalizeUsPhone(String(body.to ?? ""));
  if (!normalized || !isNanpE164(normalized)) {
    return NextResponse.json(
      { error: "SMS onboarding is US +1 (NANP) only during beta. Use 10 digits, 1+10, or +1… E.164." },
      { status: 400 }
    );
  }

  const missing = missingSupabaseAdminEnv();
  if (missing.length === 0) {
    const supabase = getSupabaseAdmin();
    if (await isPhoneSmsBanned(supabase, phoneLookupCandidates(normalized))) {
      return NextResponse.json({ error: "This number is banned from SMS onboarding." }, { status: 403 });
    }
  }

  try {
    await startSmsOnboardingForParticipant(normalized);
    return NextResponse.json({ ok: true, to: normalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start onboarding.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
