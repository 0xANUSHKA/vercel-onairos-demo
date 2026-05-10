import type { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * True if any of `phoneCandidates` is listed in `sms_phone_bans`.
 * On lookup errors (e.g. table not migrated yet), returns false so SMS is not accidentally bricked.
 */
export async function isPhoneSmsBanned(
  supabase: AdminClient,
  phoneCandidates: string[]
): Promise<boolean> {
  const uniq = [...new Set(phoneCandidates.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (uniq.length === 0) return false;
  const { data, error } = await supabase.from("sms_phone_bans").select("phone_e164").in("phone_e164", uniq).limit(1);
  if (error) {
    if (!/relation|does not exist|schema cache/i.test(error.message)) {
      console.error("sms-phone-ban: lookup failed", error.message);
    }
    return false;
  }
  return (data ?? []).length > 0;
}
