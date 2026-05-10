import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import {
  destroyCloudinaryAsset,
  isCloudinaryConfigured,
  missingCloudinaryEnv,
} from "@/lib/cloudinary-server";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const RESOURCE_TYPES = new Set(["image", "video", "raw"]);

/**
 * Admin: delete one Cloudinary asset by public_id (used for rollbacks on failed multi-upload).
 * Body: JSON { publicId: string, resourceType: "image" | "video" | "raw" }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  if (missingSupabaseAdminEnv().length > 0) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 503 });
  }
  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      { error: `Cloudinary is not configured: set ${missingCloudinaryEnv().join(", ")}.` },
      { status: 503 }
    );
  }

  const { id: profileId } = await params;
  const supabase = getSupabaseAdmin();
  const { data: prof, error: pe } = await supabase
    .from("onboarding_profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();
  if (pe || !prof) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { publicId?: string; resourceType?: string };
  const publicId = (body.publicId ?? "").trim();
  const resourceType = (body.resourceType ?? "image").toLowerCase() as "image" | "video" | "raw";
  if (!publicId) {
    return NextResponse.json({ error: "publicId is required." }, { status: 400 });
  }
  if (!RESOURCE_TYPES.has(resourceType)) {
    return NextResponse.json(
      { error: "resourceType must be image, video, or raw." },
      { status: 400 }
    );
  }

  try {
    await destroyCloudinaryAsset({ publicId, resourceType });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
