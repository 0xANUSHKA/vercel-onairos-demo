import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { isCloudinaryConfigured, missingCloudinaryEnv, uploadImageBuffer } from "@/lib/cloudinary-server";
import {
  RESPONSE_TYPE_AUDIO,
  RESPONSE_TYPE_FILE,
  RESPONSE_TYPE_IMAGE,
  RESPONSE_TYPE_VIDEO,
} from "@/lib/question-response";
import { responseTypeToCloudinaryResource } from "@/lib/cloudinary-resource-type";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_FILE = 40 * 1024 * 1024;

function maxBytesForExpected(expected: string): number {
  if (expected === RESPONSE_TYPE_IMAGE) return MAX_IMAGE;
  if (expected === RESPONSE_TYPE_VIDEO) return MAX_VIDEO;
  if (expected === RESPONSE_TYPE_AUDIO) return MAX_AUDIO;
  return MAX_FILE;
}

function validateMimeForExpected(
  expected: string,
  mime: string
): { ok: boolean; error?: string } {
  const m = String(mime ?? "").toLowerCase();
  if (expected === RESPONSE_TYPE_IMAGE) {
    if (!m.startsWith("image/")) return { ok: false, error: "Expected an image file." };
  } else if (expected === RESPONSE_TYPE_VIDEO) {
    if (!m.startsWith("video/")) return { ok: false, error: "Expected a video file." };
  } else if (expected === RESPONSE_TYPE_AUDIO) {
    if (
      !m.startsWith("audio/") &&
      !m.startsWith("video/") &&
      m !== "application/octet-stream"
    ) {
      return { ok: false, error: "Expected an audio (or supported media) file." };
    }
  }
  return { ok: true };
}

/**
 * Admin: upload one file for a profile answer. FormData: `file`, `expected_type` (IMAGE|AUDIO|VIDEO|FILE).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missingS = missingSupabaseAdminEnv();
  if (missingS.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missingS.join(", ")}` },
      { status: 503 }
    );
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data with `file` and `expected_type`." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Field `file` is required." }, { status: 400 });
  }
  const expected = String(form.get("expected_type") ?? "IMAGE")
    .toUpperCase()
    .trim();
  if (
    expected !== RESPONSE_TYPE_IMAGE &&
    expected !== RESPONSE_TYPE_VIDEO &&
    expected !== RESPONSE_TYPE_AUDIO &&
    expected !== RESPONSE_TYPE_FILE
  ) {
    return NextResponse.json(
      { error: "expected_type must be IMAGE, AUDIO, VIDEO, or FILE." },
      { status: 400 }
    );
  }
  if (file.size > maxBytesForExpected(expected)) {
    return NextResponse.json(
      { error: "File is too large for this type (check size limits on the server)." },
      { status: 400 }
    );
  }
  const v = validateMimeForExpected(expected, file.type);
  if (!v.ok) {
    return NextResponse.json({ error: v.error ?? "File type not allowed for this question type." }, { status: 400 });
  }
  if (expected === RESPONSE_TYPE_FILE && !file.size) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const rtype = responseTypeToCloudinaryResource(expected);
  try {
    const { secureUrl, publicId } = await uploadImageBuffer(buf, {
      folder: `inyo/profiles/${profileId}`,
      resourceType: rtype,
    });
    return NextResponse.json({ url: secureUrl, publicId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
