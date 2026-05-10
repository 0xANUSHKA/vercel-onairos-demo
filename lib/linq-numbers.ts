import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { normalizePhoneForStorage } from "@/lib/phone-e164";

/** All configured Linq from-numbers in priority order. */
export function getLinqFromNumbers(): string[] {
  return [
    process.env.LINQ_FROM_NUMBER?.trim(),
    process.env.LINQ_FROM_NUMBER_2?.trim(),
  ].filter(Boolean) as string[];
}

/**
 * Returns the Linq from-number that should be used when sending to a participant.
 *
 * - If the participant already has a Linq conversation, returns whichever bot number
 *   they last used (so replies always come from the same number they know).
 * - For new participants with no conversation yet, assigns them deterministically
 *   by hashing their phone number across the available pool — same participant
 *   always gets the same number on retry, and load is spread evenly.
 */
export async function resolveLinqFromNumber(participantPhone: string): Promise<string> {
  const numbers = getLinqFromNumbers();
  if (numbers.length === 0) throw new Error("No Linq from-numbers configured (LINQ_FROM_NUMBER is missing)");
  if (numbers.length === 1) return numbers[0];

  const normalized = normalizePhoneForStorage(participantPhone);

  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("sms_conversations")
      .select("telnyx_phone_e164")
      .eq("participant_phone_e164", normalized)
      .eq("provider", "linq")
      .order("last_message_at", { ascending: false })
      .limit(1);

    const assigned = data?.[0]?.telnyx_phone_e164 as string | null | undefined;
    if (assigned && numbers.includes(assigned)) return assigned;
  } catch {
    // Non-fatal — fall through to deterministic assignment
  }

  // New user: deterministic assignment so the same phone always maps to the same number
  const hash = normalized.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return numbers[hash % numbers.length];
}
