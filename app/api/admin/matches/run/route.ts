import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { runMatchmaking, type UserProfile } from "@/lib/matchmaking";
import { getCompletedProfilesForTrack } from "@/lib/onboarding-completion";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_SCORING_MODEL = "gpt-4.1-mini";
const EMBEDDING_BATCH_SIZE = 100;

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

function preferredGendersForProfile(gender: "MALE" | "FEMALE" | null): string[] {
  if (gender === "MALE") return ["FEMALE"];
  if (gender === "FEMALE") return ["MALE"];
  return [];
}

function cleanAnswerText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
  return trimmed.replace(/\s+/g, " ");
}

function buildEmbeddingInput(profile: ProfileRow, answers: string[]): string {
  const intro = cleanAnswerText(profile.intro_reply_raw);
  const answerBlob = answers.filter(Boolean).join(" | ").slice(0, 2500);
  return [
    `name:${profile.display_name ?? ""}`,
    `age:${profile.age ?? ""}`,
    `gender:${profile.gender ?? ""}`,
    `intro:${intro}`,
    `answers:${answerBlob}`,
  ]
    .join("\n")
    .slice(0, 3000);
}

async function fetchOpenAiEmbeddingsBatch(
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE);
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: batch }),
    });
    const body = (await res.json()) as {
      error?: { message?: string };
      data?: Array<{ embedding?: number[] }>;
    };
    if (!res.ok) throw new Error(body.error?.message ?? "OpenAI embeddings request failed.");
    const vectors = (body.data ?? []).map((row) => row.embedding ?? []);
    if (vectors.length !== batch.length) throw new Error("OpenAI embeddings count mismatch.");
    results.push(...vectors);
  }
  return results;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({ stage: "error", message: `Server misconfigured: missing ${missing.join(", ")}` }) + "\n",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) {
    return new Response(
      JSON.stringify({ stage: "error", message: "Server misconfigured: missing OPENAI_API_KEY." }) + "\n",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as {
    minScore?: number;
    perUserTopK?: number;
    finalTopNPerUser?: number;
    maxTotalPairs?: number;
    reset?: boolean;
  };

  const minScore = Math.max(0, Math.min(1, Number(payload.minScore ?? 0.5) || 0.5));
  const perUserTopK = Math.max(3, Math.min(30, Number(payload.perUserTopK ?? 5) || 5));
  const finalTopNPerUser = Math.max(1, Math.min(10, Number(payload.finalTopNPerUser ?? 5) || 5));
  const maxTotalPairs = Math.max(50, Math.min(1000, Number(payload.maxTotalPairs ?? 300) || 300));
  const reset = payload.reset === true;

  const supabase = getSupabaseAdmin();
  const embeddingModel = (process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL).trim();
  const scoringModel = (process.env.OPENAI_SCORING_MODEL ?? DEFAULT_SCORING_MODEL).trim();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      }

      try {
        // ── Optional reset ─────────────────────────────────────────────────
        if (reset) {
          send({ stage: "reset", message: "Clearing pending_review proposals…", progress: 2 });
          const { error: resetError } = await supabase
            .from("proposed_matches")
            .delete()
            .eq("status", "pending_review");
          if (resetError) {
            send({ stage: "error", message: `Reset failed: ${resetError.message}` });
            controller.close();
            return;
          }
          send({ stage: "reset", message: "Cleared. Starting fresh run…", progress: 4 });
        }

        // ── Stage 1: Load profiles ─────────────────────────────────────────
        send({ stage: "profiles", message: "Loading completed profiles…", progress: 5 });

        const [male, female] = await Promise.all([
          getCompletedProfilesForTrack(supabase, "MALE"),
          getCompletedProfilesForTrack(supabase, "FEMALE"),
        ]);
        const allProfiles = ([...male, ...female] as ProfileRow[]).filter((p) => p?.id);

        if (allProfiles.length < 2) {
          send({ stage: "error", message: `Not enough completed profiles to run matchmaking (found ${allProfiles.length}).` });
          controller.close();
          return;
        }

        send({ stage: "profiles", message: `Loaded ${allProfiles.length} profiles (${male.length} male · ${female.length} female)`, progress: 15 });

        // ── Stage 2: Load answers ──────────────────────────────────────────
        send({ stage: "answers", message: "Loading answer data…", progress: 18 });

        const profileIds = allProfiles.map((p) => p.id);
        const { data: answerRows, error: answerError } = await supabase
          .from("onboarding_answers")
          .select("profile_id, response_text")
          .in("profile_id", profileIds);

        if (answerError) {
          send({ stage: "error", message: answerError.message });
          controller.close();
          return;
        }

        const byProfileAnswers = new Map<string, string[]>();
        for (const row of (answerRows ?? []) as AnswerRow[]) {
          const cleaned = cleanAnswerText(row.response_text);
          if (!cleaned) continue;
          if (!byProfileAnswers.has(row.profile_id)) byProfileAnswers.set(row.profile_id, []);
          byProfileAnswers.get(row.profile_id)?.push(cleaned);
        }

        send({ stage: "answers", message: "Answers loaded", progress: 25 });

        // ── Stage 3: Generate embeddings ───────────────────────────────────
        send({ stage: "embeddings", message: `Generating embeddings for ${allProfiles.length} profiles…`, progress: 30 });

        const embeddingInputs = allProfiles.map((p) =>
          buildEmbeddingInput(p, byProfileAnswers.get(p.id) ?? []),
        );

        let embeddings: number[][];
        try {
          embeddings = await fetchOpenAiEmbeddingsBatch(openAiApiKey, embeddingModel, embeddingInputs);
        } catch (err) {
          send({ stage: "error", message: err instanceof Error ? err.message : "Embedding generation failed." });
          controller.close();
          return;
        }

        send({ stage: "embeddings", message: "Embeddings ready", progress: 50 });

        // ── Stage 4: LLM scoring ───────────────────────────────────────────
        const users: UserProfile[] = allProfiles.map((p, idx) => ({
          user_id: p.id,
          name: p.display_name ?? p.id.slice(0, 8),
          age: p.age,
          gender: p.gender,
          preferred_genders: preferredGendersForProfile(p.gender),
          questionnaire_answers: Object.fromEntries(
            (byProfileAnswers.get(p.id) ?? []).map((ans, i) => [`q${i + 1}`, ans]),
          ),
          onairos_data: {},
          embedding: embeddings[idx],
          mbti: null,
          mbti_preferences: {},
        }));

        send({ stage: "scoring", message: `Scoring up to ${maxTotalPairs} top candidate pairs across ${users.length} users…`, progress: 55 });

        let lastReported = 0;
        const rankings = await runMatchmaking(users, {
          perUserTopK,
          finalTopNPerUser,
          minScore,
          llmModel: scoringModel,
          llmClient: makeOpenAiChatClient(openAiApiKey),
          llmConcurrency: 8,
          maxTotalPairs,
          onProgress(scored, total) {
            if (scored - lastReported >= 10 || scored === total) {
              lastReported = scored;
              const progress = 55 + Math.round((scored / total) * 27);
              send({ stage: "scoring", message: `Scored ${scored} / ${total} pairs…`, progress });
            }
          },
        });

        send({ stage: "scoring", message: "Scoring complete", progress: 82 });

        // ── Stage 5: Deduplicate & save ────────────────────────────────────
        const pairMap = new Map<
          string,
          {
            user_a_id: string;
            user_b_id: string;
            score: number;
            reasons: string[];
            reasoning: Record<string, string> | null;
            risks: string[] | null;
            suggested_intro_hook: string | null;
            dimensions: Record<string, number> | null;
          }
        >();

        for (const matches of Object.values(rankings)) {
          for (const m of matches) {
            const [a, b] = [m.user_a_id, m.user_b_id].sort();
            const key = `${a}::${b}`;
            const existing = pairMap.get(key);
            if (!existing || m.score > existing.score) {
              pairMap.set(key, {
                user_a_id: a,
                user_b_id: b,
                score: m.score,
                reasons: m.reasons,
                reasoning: m.reasoning ?? null,
                risks: m.risks ?? null,
                suggested_intro_hook: m.suggested_intro_hook ?? null,
                dimensions: m.dimensions
                  ? Object.fromEntries(
                      Object.entries(m.dimensions).filter(([, v]) => v != null) as [string, number][],
                    )
                  : null,
              });
            }
          }
        }

        const uniquePairs = Array.from(pairMap.values());

        if (uniquePairs.length === 0) {
          send({ stage: "done", inserted: 0, skipped: 0, total_users: users.length, total_pairs: 0, progress: 100 });
          controller.close();
          return;
        }

        send({ stage: "saving", message: `Saving ${uniquePairs.length} candidate pairs…`, progress: 88 });

        const now = new Date().toISOString();
        const rows = uniquePairs.map((p) => ({
          user_a_id: p.user_a_id,
          user_b_id: p.user_b_id,
          status: "pending_review",
          compatibility_score: p.score,
          score_breakdown: p.dimensions,
          reasons: p.reasons,
          reasoning: p.reasoning,
          risks: p.risks,
          suggested_intro_hook: p.suggested_intro_hook,
          updated_at: now,
        }));

        const BATCH = 50;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const { error: insertError, data: insertedData } = await supabase
            .from("proposed_matches")
            .upsert(batch, { onConflict: "user_a_id,user_b_id", ignoreDuplicates: true })
            .select("id");
          if (insertError) {
            console.error("[run-matchmaking] insert error:", insertError.message);
          } else {
            inserted += (insertedData ?? []).length;
          }
        }

        send({
          stage: "done",
          inserted,
          skipped: uniquePairs.length - inserted,
          total_users: users.length,
          total_pairs: uniquePairs.length,
          progress: 100,
        });
      } catch (err) {
        send({ stage: "error", message: err instanceof Error ? err.message : "Matchmaking failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
