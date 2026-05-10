import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { ALL_RESPONSE_TYPES, RESPONSE_TYPE_TEXT, type ResponseType } from "@/lib/question-response";
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

  const supabase = getSupabaseAdmin();
  const url = new URL(request.url);
  const genderParam = (url.searchParams.get("gender") ?? "").toUpperCase().trim();
  const genderFilter = genderParam === "MALE" || genderParam === "FEMALE" ? genderParam : null;

  let query = supabase
    .from("questions")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (genderFilter) query = query.eq("gender", genderFilter);

  const { data, error } = await query;

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
    const r = (body.response_type ?? RESPONSE_TYPE_TEXT).toString().toUpperCase().trim();
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

  const minFileCount = parseMinFileCount(body.min_file_count);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("questions")
    .insert({
      question,
      gender,
      sort_order: sortOrder,
      response_type: responseType,
      min_file_count: minFileCount,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
