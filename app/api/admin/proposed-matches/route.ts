import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "pending";
  const supabase = getSupabaseAdmin();

  // ── Counts tab ──────────────────────────────────────────────────────────────
  if (tab === "counts") {
    const [pendingResult, activeResult, mutualYesResult] = await Promise.all([
      supabase
        .from("proposed_matches")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_review"),
      supabase
        .from("proposed_matches")
        .select("*", { count: "exact", head: true })
        .in("status", ["awaiting_responses", "awaiting_one_response", "mutual_yes", "declined_awaiting_feedback"]),
      supabase
        .from("proposed_matches")
        .select("*", { count: "exact", head: true })
        .eq("status", "mutual_yes"),
    ]);
    return NextResponse.json({
      pending: pendingResult.count ?? 0,
      active: activeResult.count ?? 0,
      mutual_yes: mutualYesResult.count ?? 0,
    });
  }

  // ── Active tab ──────────────────────────────────────────────────────────────
  if (tab === "active") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
    const perPage = Math.max(1, Math.min(100, parseInt(url.searchParams.get("per_page") ?? "20")));
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const ACTIVE_STATUSES = ["awaiting_responses", "awaiting_one_response", "mutual_yes", "declined_awaiting_feedback"];

    const [countResult, dataResult] = await Promise.all([
      supabase
        .from("proposed_matches")
        .select("*", { count: "exact", head: true })
        .in("status", ACTIVE_STATUSES),
      supabase
        .from("proposed_matches")
        .select(
          "id, user_a_id, user_b_id, compatibility_score, suggested_intro_hook, status, user_a_response, user_b_response, user_a_responded_at, user_b_responded_at, updated_at, last_inbound_at, admin_read_at, user_a_auto_reply_enabled, user_b_auto_reply_enabled",
        )
        .in("status", ACTIVE_STATUSES)
        // mutual_yes first, then by updated_at desc
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .range(from, to),
    ]);

    if (dataResult.error)
      return NextResponse.json({ error: dataResult.error.message }, { status: 500 });

    const data = dataResult.data ?? [];
    const total = countResult.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (!data.length)
      return NextResponse.json({ data: [], total, page, per_page: perPage, total_pages: totalPages });

    const statusOrder: Record<string, number> = {
      mutual_yes: 0,
      awaiting_one_response: 1,
      awaiting_responses: 2,
      declined_awaiting_feedback: 3,
    };
    data.sort((a, b) => {
      const oa = statusOrder[a.status] ?? 99;
      const ob = statusOrder[b.status] ?? 99;
      if (oa !== ob) return oa - ob;
      return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
    });

    const profileIds = [...new Set(data.flatMap((m) => [m.user_a_id, m.user_b_id]))];
    const { data: profiles } = await supabase
      .from("onboarding_profiles")
      .select("id, display_name, age, gender, city, phone_e164")
      .in("id", profileIds);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const enriched = data.map((m) => ({
      ...m,
      user_a: profileMap.get(m.user_a_id) ?? null,
      user_b: profileMap.get(m.user_b_id) ?? null,
    }));

    return NextResponse.json({ data: enriched, total, page, per_page: perPage, total_pages: totalPages });
  }

  // ── Pending tab (default) ───────────────────────────────────────────────────
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const perPage = Math.max(1, Math.min(100, parseInt(url.searchParams.get("per_page") ?? "20")));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const [countResult, dataResult] = await Promise.all([
    supabase
      .from("proposed_matches")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_review"),
    supabase
      .from("proposed_matches")
      .select(
        "id, user_a_id, user_b_id, compatibility_score, reasons, reasoning, risks, suggested_intro_hook, score_breakdown, created_at",
      )
      .eq("status", "pending_review")
      .order("compatibility_score", { ascending: false })
      .range(from, to),
  ]);

  if (dataResult.error)
    return NextResponse.json({ error: dataResult.error.message }, { status: 500 });

  const data = dataResult.data ?? [];
  const total = countResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (!data.length)
    return NextResponse.json({ data: [], total, page, per_page: perPage, total_pages: totalPages });

  const profileIds = [...new Set(data.flatMap((m) => [m.user_a_id, m.user_b_id]))];
  const { data: profiles } = await supabase
    .from("onboarding_profiles")
    .select("id, display_name, age, gender, city, phone_e164")
    .in("id", profileIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const enriched = data.map((m) => ({
    ...m,
    user_a: profileMap.get(m.user_a_id) ?? null,
    user_b: profileMap.get(m.user_b_id) ?? null,
  }));

  return NextResponse.json({ data: enriched, total, page, per_page: perPage, total_pages: totalPages });
}
