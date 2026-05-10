import type { getSupabaseAdmin } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * No duplicate sort order within the same gender track (drag–drop reorder can otherwise collide).
 */
export async function assertUniqueSortOrderInTracks(supabase: AdminClient) {
  const { data, error } = await supabase.from("questions").select("id, gender, sort_order");
  if (error) throw new Error(error.message);
  const byGender = new Map<string, number[]>();
  for (const r of (data ?? []) as { id: string; gender: string; sort_order: number }[]) {
    if (r.gender !== "MALE" && r.gender !== "FEMALE") continue;
    if (!byGender.has(r.gender)) byGender.set(r.gender, []);
    byGender.get(r.gender)!.push(r.sort_order);
  }
  for (const [gender, sorts] of byGender) {
    const seen = new Set<number>();
    for (const s of sorts) {
      if (seen.has(s)) {
        throw new Error(
          `Duplicate sort order ${String(s)} for ${gender} — set unique order for each step in that track.`
        );
      }
      seen.add(s);
    }
  }
}
