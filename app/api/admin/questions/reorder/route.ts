import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { assertUniqueSortOrderInTracks } from "@/lib/questions-placement";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type ReorderItem = {
  id: string;
  sort_order: number;
};

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const body = (await request.json()) as { updates?: ReorderItem[] };
  const updates = body.updates ?? [];

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "No reorder updates provided." }, { status: 400 });
  }

  const invalid = updates.some(
    (u) => !u?.id || !Number.isInteger(u.sort_order) || u.sort_order < 1
  );
  if (invalid) {
    return NextResponse.json(
      { error: "Each update must include a valid id and positive integer sort_order." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  for (const update of updates) {
    const { error } = await supabase
      .from("questions")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id);

    if (error) {
      return NextResponse.json(
        { error: `Failed to update question ${update.id}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  try {
    await assertUniqueSortOrderInTracks(supabase);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Invalid order.";
    return NextResponse.json({ error: m }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updated: updates.length });
}
