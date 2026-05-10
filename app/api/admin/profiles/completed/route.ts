import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getCompletedProfilesForTrack } from "@/lib/onboarding-completion";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

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

  const g = (new URL(request.url).searchParams.get("gender") ?? "").toUpperCase();
  if (g !== "MALE" && g !== "FEMALE") {
    return NextResponse.json(
      { error: "Query parameter gender is required: MALE or FEMALE." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const data = await getCompletedProfilesForTrack(supabase, g);
  return NextResponse.json({ data });
}
