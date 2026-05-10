import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import {
  ALL_RESPONSE_TYPES,
  RESPONSE_TYPE_TEXT,
  defaultResponseType,
  type ResponseType,
} from "@/lib/question-response";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const body = (await request.json()) as {
    question?: string;
    gender?: string;
    sort_order?: number;
    response_type?: string;
    min_file_count?: number | null;
  };

  const parseMinFileCount = (raw: unknown): number | null => {
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(20, Math.floor(n));
  };

  const question = body.question?.trim();
  const gender = (body.gender ?? "").toUpperCase();
  const sortOrder = Number(body.sort_order);
  const responseType = (() => {
    if (body.response_type === undefined) return null;
    const r = String(body.response_type).toUpperCase().trim();
    if (ALL_RESPONSE_TYPES.includes(r as ResponseType)) return r as ResponseType;
    return RESPONSE_TYPE_TEXT;
  })();

  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }
  if (gender !== "MALE" && gender !== "FEMALE") {
    return NextResponse.json(
      { error: "Gender must be MALE or FEMALE." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 1) {
    return NextResponse.json(
      { error: "Sort order must be a positive integer." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: exErr } = await supabase
    .from("questions")
    .select("response_type")
    .eq("id", id)
    .maybeSingle();
  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }
  const finalType: ResponseType =
    responseType === null
      ? defaultResponseType((existing as { response_type: string | null }).response_type)
      : responseType;
  const minFileCount =
    body.min_file_count !== undefined ? parseMinFileCount(body.min_file_count) : undefined;
  const { data, error } = await supabase
    .from("questions")
    .update({
      question,
      gender,
      sort_order: sortOrder,
      response_type: finalType,
      ...(minFileCount !== undefined ? { min_file_count: minFileCount } : {}),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("questions").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
