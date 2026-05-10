import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { runMatchmaking, llmPairScore, type UserProfile } from "@/lib/matchmaking";
import { getCompletedProfilesForTrack } from "@/lib/onboarding-completion";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_SCORING_MODEL = "gpt-4.1-mini";

function makeOpenAiChatClient(apiKey: string) {
  return {
    chat: {
      completions: {
        async create(input: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          max_completion_tokens: number;
          temperature: number;
          reasoning_effort?: string;
          response_format?: { type: string };
        }) {
          const body: Record<string, unknown> = {
            model: input.model,
            messages: input.messages,
            max_completion_tokens: input.max_completion_tokens,
            temperature: input.temperature,
          };
          if (input.response_format) body.response_format = input.response_format;

          const res = await fetch(OPENAI_CHAT_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new Error(err.error?.message ?? `OpenAI chat completions failed: ${res.status}`);
          }
          return res.json() as Promise<{
            choices?: Array<{ message?: { content?: string | null } | null }>;
          }>;
        },
      },
    },
  };
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  age: number | null;
  gender: "MALE" | "FEMALE" | null;
  intro_reply_raw: string | null;
  updated_at?: string;
};

type AnswerRow = {
  profile_id: string;
  response_text: string | null;
};

function toDateValue(value?: string): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function preferredGendersForProfile(gender: "MALE" | "FEMALE" | null): string[] {
  if (gender === "MALE") return ["FEMALE"];
  if (gender === "FEMALE") return ["MALE"];
  return [];
}

function cleanAnswerText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Keep plain text only for embeddings; media JSON blobs are noisy.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
  return trimmed.replace(/\s+/g, " ");
}

function buildEmbeddingInput(profile: ProfileRow, answers: string[]): string {
  const intro = cleanAnswerText(profile.intro_reply_raw);
  const answerBlob = answers.filter(Boolean).join(" | ").slice(0, 2500);
  const parts = [
    `name:${profile.display_name ?? ""}`,
    `age:${profile.age ?? ""}`,
    `gender:${profile.gender ?? ""}`,
    `intro:${intro}`,
    `answers:${answerBlob}`,
  ];
  return parts.join("\n").slice(0, 3000);
}

async function fetchOpenAiEmbeddings(
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: inputs,
    }),
  });
  const body = (await res.json()) as {
    error?: { message?: string };
    data?: Array<{ embedding?: number[] }>;
  };
  if (!res.ok) {
    throw new Error(body.error?.message ?? "OpenAI embeddings request failed.");
  }
  const vectors = (body.data ?? []).map((row) => row.embedding ?? []);
  if (vectors.length !== inputs.length) {
    throw new Error("OpenAI embeddings count mismatch.");
  }
  return vectors;
}

export async function GET(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });
  }

  const supabase = getSupabaseAdmin();
  const [male, female] = await Promise.all([
    getCompletedProfilesForTrack(supabase, "MALE"),
    getCompletedProfilesForTrack(supabase, "FEMALE"),
  ]);

  const users = ([...male, ...female] as ProfileRow[])
    .filter((p) => p?.id)
    .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
    .map((p) => ({
      id: p.id,
      name: p.display_name ?? p.id.slice(0, 8),
      age: p.age ?? null,
      gender: p.gender ?? null,
    }));

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Server misconfigured: missing ${missing.join(", ")}` },
      { status: 503 },
    );
  }

  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) {
    return NextResponse.json({ error: "Server misconfigured: missing OPENAI_API_KEY." }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    userLimit?: number;
    topNPerUser?: number;
    perUserTopK?: number;
    userAId?: string;
    userBId?: string;
  };

  // ── Pair mode: score a specific two users ─────────────────────────────────
  if (payload.userAId && payload.userBId) {
    if (payload.userAId === payload.userBId) {
      return NextResponse.json({ error: "User A and User B must be different." }, { status: 400 });
    }

    const embeddingModel = (process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL).trim();
    const supabase = getSupabaseAdmin();

    const { data: profiles, error: profileError } = await supabase
      .from("onboarding_profiles")
      .select("id, display_name, age, gender, intro_reply_raw")
      .in("id", [payload.userAId, payload.userBId]);

    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
    if (!profiles || profiles.length < 2) {
      return NextResponse.json({ error: "One or both users not found." }, { status: 400 });
    }

    const pickedProfiles = profiles as ProfileRow[];
    const profileIds = pickedProfiles.map((p) => p.id);

    const { data: answerRows } = await supabase
      .from("onboarding_answers")
      .select("profile_id, response_text")
      .in("profile_id", profileIds);

    const byProfileAnswers = new Map<string, string[]>();
    for (const row of (answerRows ?? []) as AnswerRow[]) {
      const cleaned = cleanAnswerText(row.response_text);
      if (!cleaned) continue;
      if (!byProfileAnswers.has(row.profile_id)) byProfileAnswers.set(row.profile_id, []);
      byProfileAnswers.get(row.profile_id)?.push(cleaned);
    }

    let embeddings: number[][];
    try {
      embeddings = await fetchOpenAiEmbeddings(
        openAiApiKey,
        embeddingModel,
        pickedProfiles.map((p) => buildEmbeddingInput(p, byProfileAnswers.get(p.id) ?? [])),
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Embedding generation failed." },
        { status: 502 },
      );
    }

    const [userA, userB] = pickedProfiles.map((p, idx) => ({
      user_id: p.id,
      name: p.display_name ?? p.id.slice(0, 8),
      age: p.age,
      gender: p.gender,
      preferred_genders: preferredGendersForProfile(p.gender),
      questionnaire_answers: {},
      onairos_data: {},
      embedding: embeddings[idx],
      mbti: null,
      mbti_preferences: {},
    })) as [UserProfile, UserProfile];

    const scoringModel = (process.env.OPENAI_SCORING_MODEL ?? DEFAULT_SCORING_MODEL).trim();
    const match = await llmPairScore(userA, userB, {
      model: scoringModel,
      client: makeOpenAiChatClient(openAiApiKey),
    });

    return NextResponse.json({
      pair_mode: true,
      user_a: { id: userA.user_id, name: userA.name, age: userA.age ?? null, gender: userA.gender ?? null },
      user_b: { id: userB.user_id, name: userB.name, age: userB.age ?? null, gender: userB.gender ?? null },
      match,
      model_usage: { embeddings_model: embeddingModel, llm_scoring: scoringModel },
    });
  }
  // ── End pair mode ──────────────────────────────────────────────────────────

  const userLimit = Math.max(2, Math.min(50, Number(payload.userLimit ?? 10) || 10));
  const topNPerUser = Math.max(1, Math.min(10, Number(payload.topNPerUser ?? 3) || 3));
  const perUserTopK = Math.max(3, Math.min(30, Number(payload.perUserTopK ?? 10) || 10));
  const embeddingModel = (process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL).trim();

  const supabase = getSupabaseAdmin();

  const [male, female] = await Promise.all([
    getCompletedProfilesForTrack(supabase, "MALE"),
    getCompletedProfilesForTrack(supabase, "FEMALE"),
  ]);
  const allProfiles = [...male, ...female] as ProfileRow[];

  const pickedProfiles = allProfiles
    .filter((p) => p?.id)
    .sort((a, b) => toDateValue(b.updated_at) - toDateValue(a.updated_at))
    .slice(0, userLimit);

  if (pickedProfiles.length < 2) {
    return NextResponse.json(
      {
        error: "Not enough eligible completed profiles to run matchmaking preview.",
        count: pickedProfiles.length,
      },
      { status: 400 },
    );
  }

  const profileIds = pickedProfiles.map((p) => p.id);
  const { data: answerRows, error: answerError } = await supabase
    .from("onboarding_answers")
    .select("profile_id, response_text")
    .in("profile_id", profileIds);

  if (answerError) {
    return NextResponse.json({ error: answerError.message }, { status: 500 });
  }

  const byProfileAnswers = new Map<string, string[]>();
  for (const row of (answerRows ?? []) as AnswerRow[]) {
    const cleaned = cleanAnswerText(row.response_text);
    if (!cleaned) continue;
    if (!byProfileAnswers.has(row.profile_id)) byProfileAnswers.set(row.profile_id, []);
    byProfileAnswers.get(row.profile_id)?.push(cleaned);
  }

  const embeddingInputs = pickedProfiles.map((p) => buildEmbeddingInput(p, byProfileAnswers.get(p.id) ?? []));
  let embeddings: number[][];
  try {
    embeddings = await fetchOpenAiEmbeddings(openAiApiKey, embeddingModel, embeddingInputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const users: UserProfile[] = pickedProfiles.map((p, idx) => ({
    user_id: p.id,
    name: p.display_name ?? p.id.slice(0, 8),
    age: p.age,
    gender: p.gender,
    preferred_genders: preferredGendersForProfile(p.gender),
    questionnaire_answers: {},
    onairos_data: {},
    embedding: embeddings[idx],
    mbti: null,
    mbti_preferences: {},
  }));

  const scoringModel = (process.env.OPENAI_SCORING_MODEL ?? DEFAULT_SCORING_MODEL).trim();
  const llmClient = makeOpenAiChatClient(openAiApiKey);

  const rankings = await runMatchmaking(users, {
    perUserTopK,
    finalTopNPerUser: topNPerUser,
    llmModel: scoringModel,
    llmClient,
  });

  const cleanedRankings = Object.fromEntries(
    Object.entries(rankings).map(([userId, matches]) => [
      userId,
      matches.map((m) => ({
        ...m,
        reasons: m.reasons.filter((r) => !r.toLowerCase().includes("no llm client configured")),
      })),
    ]),
  );

  const usersById = Object.fromEntries(
    users.map((u) => [
      u.user_id,
      {
        name: u.name,
        age: u.age ?? null,
        gender: u.gender ?? "—",
      },
    ]),
  );

  return NextResponse.json({
    dry_run: true,
    notifications_sent: false,
    persisted: false,
    user_count: users.length,
    model_usage: {
      embeddings_model: embeddingModel,
      llm_scoring: scoringModel,
    },
    users_by_id: usersById,
    rankings: cleanedRankings,
  });
}
