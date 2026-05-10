import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WaitlistRow = { id: string; value: string };

export async function GET(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("onboarding_profiles")
    .select("*, waitlist (id, value, city, created_at)")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

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

  const body = (await request.json()) as { waitlist_id?: string };
  const waitlistId = body.waitlist_id?.trim();
  if (!waitlistId) {
    return NextResponse.json({ error: "waitlist_id is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: existingRows } = await supabase
    .from("onboarding_profiles")
    .select("id")
    .eq("waitlist_id", waitlistId)
    .order("created_at", { ascending: false })
    .limit(1);
  const existing = (existingRows ?? [])[0];
  if (existing) {
    return NextResponse.json(
      { error: "An onboarding profile already exists for this waitlist entry." },
      { status: 409 }
    );
  }

  const { data: wl, error: wlError } = await supabase
    .from("waitlist")
    .select("id, value")
    .eq("id", waitlistId)
    .single();

  if (wlError || !wl) {
    return NextResponse.json({ error: "Waitlist entry not found." }, { status: 404 });
  }

  const row = wl as WaitlistRow;
  const { data: created, error: insError } = await supabase
    .from("onboarding_profiles")
    .insert({
      waitlist_id: row.id,
      phone_e164: row.value,
    })
    .select("*, waitlist (id, value, city, created_at)")
    .single();

  if (insError) {
    return NextResponse.json({ error: insError.message }, { status: 500 });
  }
  return NextResponse.json({ data: created }, { status: 201 });
}
