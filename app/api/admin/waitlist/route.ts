import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminApiRequest(req);
    if (!auth.ok) return auth.response;

    const missingAdminEnv = missingSupabaseAdminEnv();
    if (missingAdminEnv.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingAdminEnv.join(", ")}` },
        { status: 503 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [
      { count: waitlist_total_count, error: countErr },
      { count: waitlist_linked_count, error: linkedErr },
      { data, error },
      { data: profiles, error: pErr },
    ] = await Promise.all([
      supabaseAdmin.from("waitlist").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("onboarding_profiles")
        .select("id", { count: "exact", head: true })
        .not("waitlist_id", "is", null),
      supabaseAdmin
        .from("waitlist")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseAdmin.from("onboarding_profiles").select("id, waitlist_id"),
    ]);

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }
    if (linkedErr) {
      return NextResponse.json({ error: linkedErr.message }, { status: 500 });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }

    const rows = data ?? [];
    const byWaitlist = new Map<string, string>();
    for (const p of profiles ?? []) {
      const wid = p.waitlist_id as string | number | null | undefined;
      if (wid == null) continue;
      byWaitlist.set(String(wid), String(p.id));
    }

    const merged = rows.map((w) => {
      const wId = w.id;
      if (wId == null) return w;
      return {
        ...w,
        onboarding_profile_id: byWaitlist.get(String(wId)) ?? null,
      };
    });

    const total = waitlist_total_count ?? 0;
    const linked = waitlist_linked_count ?? 0;
    /** Rows in `waitlist` with no `onboarding_profiles.waitlist_id` (matches admin “waitlist only”). */
    const waitlist_active_only_count = Math.max(0, total - linked);

    return NextResponse.json({
      data: merged,
      waitlist_total_count: total,
      waitlist_active_only_count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await verifyAdminApiRequest(req);
    if (!auth.ok) return auth.response;

    const missingAdminEnv = missingSupabaseAdminEnv();
    if (missingAdminEnv.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingAdminEnv.join(", ")}` },
        { status: 503 }
      );
    }

    const body = (await req.json()) as { waitlist_ids?: Array<string | number> };
    const ids = (body.waitlist_ids ?? [])
      .map((id) => String(id).trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ error: "waitlist_ids is required." }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from("onboarding_profiles")
      .select("waitlist_id")
      .in("waitlist_id", ids);

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 });
    }

    const blocked = new Set(
      (profiles ?? [])
        .map((p) => p.waitlist_id)
        .filter((v): v is string | number => v != null)
        .map((v) => String(v))
    );
    const deletable = ids.filter((id) => !blocked.has(id));

    let deletedCount = 0;
    if (deletable.length > 0) {
      const { error: deleteErr, count } = await supabaseAdmin
        .from("waitlist")
        .delete({ count: "exact" })
        .in("id", deletable);
      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 });
      }
      deletedCount = count ?? 0;
    }

    return NextResponse.json({
      deleted_count: deletedCount,
      skipped_onboarding_ids: [...blocked],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
