/* Basic matchmaking pipeline with staged filtering and optional LLM scoring.
 *
 * Goal:
 * - Avoid O(n^2) LLM matchmaking calls
 * - Use cheap filters first (hard constraints + embeddings + MBTI preference gates)
 * - Run agent/LLM scoring only on shortlisted pairs
 */

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const MBTI_TYPES = [
  "INTJ",
  "INTP",
  "ENTJ",
  "ENTP",
  "INFJ",
  "INFP",
  "ENFJ",
  "ENFP",
  "ISTJ",
  "ISFJ",
  "ESTJ",
  "ESFJ",
  "ISTP",
  "ISFP",
  "ESTP",
  "ESFP",
] as const;

type MbtiType = (typeof MBTI_TYPES)[number];

export type UserProfile = {
  user_id: string;
  name: string;
  age?: number | null;
  gender?: string | null;
  preferred_genders: string[];
  height?: string | null;                   // e.g. "5'10"
  preferred_height_min?: string | null;     // e.g. "5'8" — shortest acceptable
  preferred_height_max?: string | null;     // e.g. "6'2" — tallest acceptable
  preferred_age_min?: number | null;
  preferred_age_max?: number | null;
  questionnaire_answers: Record<string, unknown>;
  onairos_data: Record<string, unknown>;
  embedding?: number[] | null;
  mbti?: string | null;
  mbti_preferences: Record<string, number>;
  mbti_source?: "questionnaire" | "onairos" | "inferred" | "none" | null;
};

export type MatchScore = {
  user_a_id: string;
  user_b_id: string;
  score: number;           // 0–1
  reasons: string[];       // 2–4 concise strings for quick display
  filtered_stage?: string | null;
  reasoning?: Record<string, string> | null; // one sentence per dimension
  risks?: string[] | null;
  suggested_intro_hook?: string | null;
  dimensions?: {
    lifestyle?: number;
    values?: number;
    personality?: number;
    energy?: number;
    communication?: number;
  } | null;
};

type LlmMessage = {
  role: "system" | "user";
  content: string;
};

type LlmCreateInput = {
  model: string;
  messages: LlmMessage[];
  max_completion_tokens: number;
  temperature: number;
  reasoning_effort: "none" | "low" | "medium" | "high";
  response_format?: { type: "json_object" };
};

type LlmClient = {
  chat: {
    completions: {
      create(input: LlmCreateInput): Promise<{
        choices?: Array<{ message?: { content?: string | null } | null }>;
      }>;
    };
  };
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function fetchUsersFromDb(): Promise<UserProfile[]> {
  const supabase = getSupabaseAdmin();

  const { data: profiles, error: profilesError } = await supabase
    .from("onboarding_profiles")
    .select("id, display_name, age, gender, height, waitlist_id")
    .eq("sms_onboarding_stage", "sms_onboarding_complete");

  if (profilesError) throw new Error(`fetchUsersFromDb profiles: ${profilesError.message}`);
  if (!profiles?.length) return [];

  const profileIds = profiles.map((p) => p.id as string);
  const waitlistIds = profiles.map((p) => p.waitlist_id).filter(Boolean) as (string | number)[];

  const [answersResult, waitlistResult] = await Promise.all([
    supabase
      .from("onboarding_answers")
      .select("profile_id, response_text, questions!inner(sort_order, response_type)")
      .in("profile_id", profileIds)
      .eq("questions.response_type", "TEXT"),
    waitlistIds.length > 0
      ? supabase.from("waitlist").select("id, onairos_traits").in("id", waitlistIds)
      : Promise.resolve({ data: [] }),
  ]);

  const answersByProfile: Record<string, Record<string, string>> = {};
  for (const row of answersResult.data ?? []) {
    const pid = row.profile_id as string;
    if (!answersByProfile[pid]) answersByProfile[pid] = {};
    const q = row.questions as { sort_order?: number } | null;
    if (q?.sort_order != null) {
      answersByProfile[pid][`q${q.sort_order}`] = String(row.response_text ?? "");
    }
  }

  const onairosById: Record<string, Record<string, unknown>> = {};
  for (const wl of (waitlistResult as { data?: Array<{ id: unknown; onairos_traits: unknown }> }).data ?? []) {
    if (wl.onairos_traits && typeof wl.onairos_traits === "object") {
      onairosById[String(wl.id)] = wl.onairos_traits as Record<string, unknown>;
    }
  }

  return profiles.map((p) => ({
    user_id: p.id as string,
    name: (p.display_name as string | null) ?? "",
    age: (p.age as number | null) ?? null,
    gender: (p.gender as string | null) ?? null,
    height: (p.height as string | null) ?? null,
    preferred_genders: [],
    questionnaire_answers: answersByProfile[p.id as string] ?? {},
    onairos_data: onairosById[String(p.waitlist_id)] ?? {},
    embedding: null,
    mbti: null,
    mbti_preferences: {},
    mbti_source: null,
  }));
}

export async function fetchEmbeddingForProfile(user: UserProfile): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const parts: string[] = [];
  if (user.name) parts.push(`Name: ${user.name}`);
  if (user.age) parts.push(`Age: ${user.age}`);
  if (user.gender) parts.push(`Gender: ${user.gender}`);
  if (user.mbti) parts.push(`MBTI: ${user.mbti}`);

  for (const [key, value] of Object.entries(user.questionnaire_answers)) {
    if (key === "mbti") continue;
    parts.push(`${key}: ${String(value)}`);
  }

  const traits = asRecord(user.onairos_data?.traits);
  const positiveTraits = asRecord(traits.positive_traits);
  const topTraits = Object.entries(positiveTraits)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 5)
    .map(([k]) => k)
    .join(", ");
  if (topTraits) parts.push(`Traits: ${topTraits}`);

  if (parts.length === 0) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: parts.join("\n") }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a?: number[] | null, b?: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0;
  const dot = a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
  const normA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));
  const normB = Math.sqrt(b.reduce((sum, y) => sum + y * y, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

function normalizedMbti(value: unknown): MbtiType | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toUpperCase();
  return (MBTI_TYPES as readonly string[]).includes(token) ? (token as MbtiType) : null;
}

export function extractMbtiPreferences(onairosData: Record<string, unknown>): Record<string, number> {
  /* Looks through likely payload paths and keeps scores in [0,1]. */
  if (!onairosData || Object.keys(onairosData).length === 0) return {};

  const traits = asRecord(onairosData.traits);
  const userTraits = asRecord(onairosData.userTraits);
  const preferences = asRecord(onairosData.preferences);

  const candidates = [
    onairosData.mbti_preferences,
    traits.mbti_preferences,
    userTraits.mbti_preferences,
    asRecord(preferences.mbti),
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;

    const cleaned: Record<string, number> = {};
    for (const [mbti, score] of Object.entries(candidate)) {
      const mbtiType = normalizedMbti(mbti);
      if (!mbtiType) continue;
      const numeric = Number(score);
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
        cleaned[mbtiType] = numeric;
      }
    }

    if (Object.keys(cleaned).length > 0) return cleaned;
  }

  return {};
}

const DEALBREAKER_KEYS = new Set(["wants_kids", "smoking", "drinking", "religion", "relationship_type"]);

export function questionnaireOverlapScore(a: UserProfile, b: UserProfile): number {
  const aAns = Object.fromEntries(
    Object.entries(a.questionnaire_answers)
      .filter(([k]) => k !== "mbti")
      .map(([k, v]) => [k, String(v).toLowerCase().trim()]),
  );
  const bAns = Object.fromEntries(
    Object.entries(b.questionnaire_answers)
      .filter(([k]) => k !== "mbti")
      .map(([k, v]) => [k, String(v).toLowerCase().trim()]),
  );
  const shared = Object.keys(aAns).filter((k) => k in bAns);
  if (shared.length === 0) return 0.5;
  const scores: number[] = shared.map((key) => {
    const av = aAns[key];
    const bv = bAns[key];
    if (key === "wants_kids") {
      if (av === bv) return 1.0;
      if (av.includes("maybe") || bv.includes("maybe")) return 0.6;
      return 0.0;
    }
    if (DEALBREAKER_KEYS.has(key)) return av === bv ? 1.0 : 0.2;
    return av === bv ? 1.0 : 0.4;
  });
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

/** Parses height strings like "5'10", "5'10\"", "5ft 10", "70in" → total inches. */
export function parseHeightInches(h: unknown): number | null {
  if (!h || typeof h !== "string") return null;
  const s = h.trim();

  // "5'10", "5'10\"", "5' 10", "5ft10", "5ft 10in"
  const feetInches = s.match(/^(\d)\s*['’ft]\s*(\d{1,2})\s*(?:"|in|inches?)?$/i);
  if (feetInches) {
    const inches = parseInt(feetInches[1]) * 12 + parseInt(feetInches[2]);
    return inches >= 48 && inches <= 96 ? inches : null;
  }

  // "5'", "5 feet"
  const feetOnly = s.match(/^(\d)\s*['’]?\s*(?:ft|feet|foot)?$/i);
  if (feetOnly) {
    const inches = parseInt(feetOnly[1]) * 12;
    return inches >= 48 && inches <= 96 ? inches : null;
  }

  // "70in", "70\""
  const inchesOnly = s.match(/^(\d{2})\s*(?:"|in|inches?)?$/i);
  if (inchesOnly) {
    const inches = parseInt(inchesOnly[1]);
    return inches >= 48 && inches <= 96 ? inches : null;
  }

  return null;
}

/**
 * How well does candidate's height match user's preference?
 * Returns 1.0 if within range, decays 0.15 per inch outside, floors at 0.
 */
export function heightPreferenceScore(user: UserProfile, candidate: UserProfile): number {
  const candidateIn = parseHeightInches(candidate.height);
  if (candidateIn == null) return 0.5; // unknown height → neutral
  const minIn = parseHeightInches(user.preferred_height_min);
  const maxIn = parseHeightInches(user.preferred_height_max);
  if (minIn == null && maxIn == null) return 0.5; // no preference → neutral

  let deviation = 0;
  if (minIn != null && candidateIn < minIn) deviation = minIn - candidateIn;
  if (maxIn != null && candidateIn > maxIn) deviation = candidateIn - maxIn;
  return Math.max(0, 1 - deviation * 0.15);
}

export function ageGapScore(a: UserProfile, b: UserProfile): number {
  if (!a.age || !b.age) return 0.5;
  const gap = Math.abs(a.age - b.age);
  if (gap <= 2) return 1.0;
  if (gap >= 10) return 0.0;
  // steeper decay: 0–2 perfect, 10+ zero, linear between
  return 1.0 - (gap - 2) / 8.0;
}

type MbtiInferResult = { mbti: string | null; source: "questionnaire" | "onairos" | "inferred" | "none" };

export function inferMbti(user: UserProfile): MbtiInferResult {
  /* Infer MBTI with source precedence:
   * 1) questionnaire explicit MBTI → source "questionnaire"
   * 2) Onairos explicit MBTI       → source "onairos"
   * 3) heuristic from trait signals → source "inferred"
   */
  const explicitFromQuestionnaire = normalizedMbti(user.questionnaire_answers?.mbti);
  if (explicitFromQuestionnaire) return { mbti: explicitFromQuestionnaire, source: "questionnaire" };

  const traits = asRecord(user.onairos_data?.traits);
  const userTraits = asRecord(user.onairos_data?.userTraits);
  const explicitFromOnairos = normalizedMbti(traits.mbti ?? user.onairos_data?.mbti ?? userTraits.mbti);
  if (explicitFromOnairos) return { mbti: explicitFromOnairos, source: "onairos" };

  const positiveTraits = asRecord(traits.positive_traits);
  if (Object.keys(positiveTraits).length === 0) return { mbti: null, source: "none" };

  const scoreFor = (keys: string[]): number => {
    let total = 0;
    for (const [k, v] of Object.entries(positiveTraits)) {
      if (!keys.some((part) => k.toLowerCase().includes(part.toLowerCase()))) continue;
      const numeric = Number(v);
      if (Number.isFinite(numeric)) total += numeric;
    }
    return total;
  };

  const iScore = scoreFor(["deep", "reflect", "stoic", "independent"]);
  const eScore = scoreFor(["social", "group", "outgoing"]); // "spontaneous" lives only in P-dimension
  const nScore = scoreFor(["strategic", "long-term", "abstract", "curiosity"]);
  const sScore = scoreFor(["practical", "detail", "routine", "concrete"]);
  const tScore = scoreFor(["logic", "analysis", "system", "reason"]);
  const fScore = scoreFor(["empathy", "care", "emotional", "kind"]);
  const jScore = scoreFor(["discipline", "plan", "structured", "consistent"]);
  const pScore = scoreFor(["adaptable", "spontaneous", "flexible", "explore"]);

  const guess = [
    iScore >= eScore ? "I" : "E",
    nScore >= sScore ? "N" : "S",
    tScore >= fScore ? "T" : "F",
    jScore >= pScore ? "J" : "P",
  ].join("");

  const mbti = normalizedMbti(guess);
  return mbti ? { mbti, source: "inferred" } : { mbti: null, source: "none" };
}

export function passesHardFilters(a: UserProfile, b: UserProfile): boolean {
  if (a.user_id === b.user_id) return false;
  if (a.gender && b.gender && a.gender === b.gender) return false;
  if (a.preferred_genders.length > 0 && b.gender && !a.preferred_genders.includes(b.gender)) return false;
  if (b.preferred_genders.length > 0 && a.gender && !b.preferred_genders.includes(a.gender)) return false;
  if (a.age && b.age && Math.abs(a.age - b.age) > 12) return false;
  // Preferred age range hard gate (only when both ages known)
  if (a.preferred_age_min != null && b.age && b.age < a.preferred_age_min) return false;
  if (a.preferred_age_max != null && b.age && b.age > a.preferred_age_max) return false;
  if (b.preferred_age_min != null && a.age && a.age < b.preferred_age_min) return false;
  if (b.preferred_age_max != null && a.age && a.age > b.preferred_age_max) return false;
  return true;
}

export function mbtiPreferenceGate(a: UserProfile, b: UserProfile, threshold = 0.2): boolean {
  /* Reject pairs where either side has an explicit low MBTI preference.
   * When the target's MBTI was inferred (not self-reported), halve the
   * effective threshold to avoid over-filtering on uncertain data.
   */
  if (Object.keys(a.mbti_preferences).length > 0 && b.mbti) {
    const confidence = b.mbti_source === "inferred" ? 0.5 : 1.0;
    if ((a.mbti_preferences[b.mbti] ?? 1) < threshold * confidence) return false;
  }
  if (Object.keys(b.mbti_preferences).length > 0 && a.mbti) {
    const confidence = a.mbti_source === "inferred" ? 0.5 : 1.0;
    if ((b.mbti_preferences[a.mbti] ?? 1) < threshold * confidence) return false;
  }
  return true;
}

export async function llmPairScore(
  a: UserProfile,
  b: UserProfile,
  {
    model = "gpt-5.4",
    client,
  }: {
    model?: string;
    client?: LlmClient | null;
  } = {},
): Promise<MatchScore> {
  /* Final-stage pair scoring.
   * If client is not provided, uses deterministic heuristic fallback.
   */
  const hasEmbeddings = a.embedding != null && b.embedding != null;
  const sim = hasEmbeddings ? cosineSimilarity(a.embedding, b.embedding) : 0;
  const prefA = Object.keys(a.mbti_preferences).length > 0 ? (a.mbti_preferences[b.mbti ?? ""] ?? 0.5) : 0.5;
  const prefB = Object.keys(b.mbti_preferences).length > 0 ? (b.mbti_preferences[a.mbti ?? ""] ?? 0.5) : 0.5;
  const qOverlap = questionnaireOverlapScore(a, b);
  const ageSc = ageGapScore(a, b);
  // Average of both directions: does A's height match B's preference, and vice versa
  const heightSc = (heightPreferenceScore(a, b) + heightPreferenceScore(b, a)) / 2;
  // With embeddings: sim=0.30, mbti=0.15+0.15, questionnaire=0.15, age=0.10, height=0.15
  // Without: redistribute embedding weight proportionally
  const heuristic = hasEmbeddings
    ? 0.30 * sim + 0.15 * prefA + 0.15 * prefB + 0.15 * qOverlap + 0.10 * ageSc + 0.15 * heightSc
    : 0.22 * prefA + 0.22 * prefB + 0.22 * qOverlap + 0.16 * ageSc + 0.18 * heightSc;

  if (!client) {
    return {
      user_a_id: a.user_id,
      user_b_id: b.user_id,
      score: clampScore(heuristic),
      reasons: [
        "heuristic fallback (no LLM client configured)",
        `embedding similarity=${sim.toFixed(3)}`,
        `mbti preference blend=${((prefA + prefB) / 2).toFixed(3)}`,
        `questionnaire overlap=${qOverlap.toFixed(3)}  age score=${ageSc.toFixed(3)}`,
      ],
    };
  }

  const system =
    "You are a dating compatibility scorer for inyo, a human-in-the-loop matchmaking service.\n" +
    "Output strict JSON with exactly these keys:\n" +
    "  score: float 0-1 (weighted average of dimensions),\n" +
    "  dimensions: { values: 0-1, personality: 0-1, lifestyle: 0-1, communication: 0-1, energy: 0-1 },\n" +
    "  reasons: string[] — exactly 2-4 strings; reasons[0] must be a shared trait phrase (e.g. 'both value deep conversations'), reasons[1] must be a shared want phrase starting with a verb (e.g. 'is emotionally available'), remaining entries are additional highlights,\n" +
    "  reasoning: { values: string, personality: string, lifestyle: string, communication: string, energy: string }\n" +
    "    — one short sentence per dimension explaining specifically how that score was derived,\n" +
    "  risks: string[] — 1-3 genuine concerns or friction points (empty array if none),\n" +
    "  suggested_intro_hook: string — one sentence highlighting the strongest connection point.\n" +
    "Dimension weights: values=0.30, personality=0.20, lifestyle=0.20, communication=0.15, energy=0.15.\n" +
    "Flag risks only for real incompatibilities (wants_kids conflict, irreconcilable life stage, etc.).\n" +
    "Set score < 0.4 if a clear dealbreaker exists.";

  const prompt = {
    user_a: {
      id: a.user_id,
      age: a.age,
      height: a.height ?? null,
      preferred_height_min: a.preferred_height_min ?? null,
      preferred_height_max: a.preferred_height_max ?? null,
      preferred_age_min: a.preferred_age_min ?? null,
      preferred_age_max: a.preferred_age_max ?? null,
      mbti: a.mbti,
      mbti_source: a.mbti_source,
      questionnaire_answers: Object.fromEntries(Object.entries(a.questionnaire_answers).filter(([k]) => k !== "mbti")),
      onairos: asRecord(a.onairos_data.traits) || a.onairos_data,
      mbti_preferences: a.mbti_preferences,
    },
    user_b: {
      id: b.user_id,
      age: b.age,
      height: b.height ?? null,
      preferred_height_min: b.preferred_height_min ?? null,
      preferred_height_max: b.preferred_height_max ?? null,
      preferred_age_min: b.preferred_age_min ?? null,
      preferred_age_max: b.preferred_age_max ?? null,
      mbti: b.mbti,
      mbti_source: b.mbti_source,
      questionnaire_answers: Object.fromEntries(Object.entries(b.questionnaire_answers).filter(([k]) => k !== "mbti")),
      onairos: asRecord(b.onairos_data.traits) || b.onairos_data,
      mbti_preferences: b.mbti_preferences,
    },
    prior: {
      embedding_similarity: Math.round(sim * 10000) / 10000,
      questionnaire_overlap: Math.round(qOverlap * 10000) / 10000,
      age_gap_score: Math.round(ageSc * 10000) / 10000,
    },
    instruction:
      "Score compatibility for a first intro. Penalize clear dealbreakers (conflicting wants_kids, irreconcilable values). Reward genuine complementarity in communication style and life goals.",
  };

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(prompt) },
      ],
      max_completion_tokens: 600,
      temperature: 0,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as {
      score?: unknown;
      dimensions?: Record<string, unknown>;
      reasons?: unknown;
      reasoning?: unknown;
      risks?: unknown;
      suggested_intro_hook?: unknown;
    };
    const dims = (typeof parsed.dimensions === "object" && parsed.dimensions) ? parsed.dimensions : {};
    let score = Number(parsed.score);
    if (!Number.isFinite(score)) {
      const w = { values: 0.30, personality: 0.20, lifestyle: 0.20, communication: 0.15, energy: 0.15 };
      score = Object.entries(w).reduce((acc, [k, wt]) => acc + wt * Number((dims as Record<string, unknown>)[k] ?? 0.5), 0);
    }
    const reasonsRaw = Array.isArray(parsed.reasons) ? parsed.reasons : [];
    const risksRaw = Array.isArray(parsed.risks) ? parsed.risks : [];

    // reasoning is now a per-dimension map { values: "...", personality: "...", ... }
    let reasoning: Record<string, string> | null = null;
    if (parsed.reasoning && typeof parsed.reasoning === "object" && !Array.isArray(parsed.reasoning)) {
      const raw = parsed.reasoning as Record<string, unknown>;
      const entries = Object.entries(raw)
        .filter(([, v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => [k, String(v)] as [string, string]);
      if (entries.length > 0) reasoning = Object.fromEntries(entries);
    }

    return {
      user_a_id: a.user_id,
      user_b_id: b.user_id,
      score: clampScore(Number.isFinite(score) ? score : heuristic),
      reasons: reasonsRaw.map((r) => String(r)).slice(0, 4),
      reasoning,
      risks: risksRaw.map((r) => String(r)).slice(0, 3),
      suggested_intro_hook: typeof parsed.suggested_intro_hook === "string" ? parsed.suggested_intro_hook : null,
      dimensions: Object.keys(dims).length > 0 ? {
        lifestyle: Number(dims.lifestyle) || undefined,
        values: Number(dims.values) || undefined,
        personality: Number(dims.personality) || undefined,
        energy: Number(dims.energy) || undefined,
        communication: Number(dims.communication) || undefined,
      } : null,
    };
  } catch (err) {
    console.error("[llmPairScore] LLM call failed:", err);
    return {
      user_a_id: a.user_id,
      user_b_id: b.user_id,
      score: clampScore(heuristic),
      reasons: ["LLM scoring failed; heuristic fallback used."],
    };
  }
}

export function candidatePairs(
  users: UserProfile[],
  {
    perUserTopK = 20,
    embeddingThreshold = 0.1,
    skipPairKeys = new Set<string>(),
  }: { perUserTopK?: number; embeddingThreshold?: number; skipPairKeys?: Set<string> } = {},
): Array<[UserProfile, UserProfile]> {
  /* Generate shortlist for expensive LLM scoring. */
  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const shortlist = new Set<string>();

  for (const a of users) {
    const scoredNeighbors: Array<[number, string]> = [];
    for (const b of users) {
      if (!passesHardFilters(a, b)) continue;
      if (!mbtiPreferenceGate(a, b)) continue;

      const [u1, u2] = [a.user_id, b.user_id].sort();
      if (skipPairKeys.has(`${u1}::${u2}`)) continue;

      const sim = cosineSimilarity(a.embedding, b.embedding);
      // When embeddings are absent every pair has sim=0; skip the threshold check
      if (a.embedding != null && b.embedding != null && sim < embeddingThreshold) continue;
      scoredNeighbors.push([sim, b.user_id]);
    }

    scoredNeighbors.sort((lhs, rhs) => rhs[0] - lhs[0]);
    for (const [, bId] of scoredNeighbors.slice(0, perUserTopK)) {
      const [u1, u2] = [a.user_id, bId].sort();
      shortlist.add(`${u1}::${u2}`);
    }
  }

  const result: Array<[UserProfile, UserProfile]> = [];
  for (const pair of Array.from(shortlist).sort()) {
    const [aId, bId] = pair.split("::");
    const a = userMap.get(aId);
    const b = userMap.get(bId);
    if (a && b) result.push([a, b]);
  }
  return result;
}

function createConcurrencyLimiter(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--;
            if (queue.length > 0) queue.shift()!();
          });
      };
      if (running < max) run();
      else queue.push(run);
    });
  };
}

export const DEFAULT_MIN_MATCH_SCORE = 0.5;

export async function runMatchmaking(
  users: UserProfile[],
  {
    perUserTopK = 20,
    finalTopNPerUser = 5,
    minScore = DEFAULT_MIN_MATCH_SCORE,
    llmModel = "gpt-5.4",
    llmClient,
    llmConcurrency = 5,
    maxTotalPairs,
    onProgress,
  }: {
    perUserTopK?: number;
    finalTopNPerUser?: number;
    minScore?: number;
    llmModel?: string;
    llmClient?: LlmClient | null;
    llmConcurrency?: number;
    /** Hard cap on LLM calls. Pairs are sorted by cosine similarity descending before truncation. */
    maxTotalPairs?: number;
    onProgress?: (scored: number, total: number) => void;
  } = {},
): Promise<Record<string, MatchScore[]>> {
  // Enrich copies — never mutate the caller's array
  const enriched = await Promise.all(
    users.map(async (u) => {
      const copy = { ...u };
      if (!copy.embedding) copy.embedding = await fetchEmbeddingForProfile(copy);
      if (!copy.mbti) {
        const { mbti, source } = inferMbti(copy);
        copy.mbti = mbti;
        copy.mbti_source = source;
      } else if (!copy.mbti_source || copy.mbti_source === "none") {
        copy.mbti_source = "questionnaire";
      }
      if (Object.keys(copy.mbti_preferences).length === 0) {
        copy.mbti_preferences = extractMbtiPreferences(copy.onairos_data);
      }
      return copy;
    }),
  );

  // Load skip-set: excluded pairs + already-active proposed matches
  const supabase = getSupabaseAdmin();
  const skipPairKeys = new Set<string>();

  const [excludedResult, existingResult] = await Promise.all([
    supabase.from("excluded_pairs").select("user_a_id, user_b_id"),
    supabase
      .from("proposed_matches")
      .select("user_a_id, user_b_id")
      .not("status", "in", "(rejected_by_founder,declined,expired)"),
  ]);

  for (const r of excludedResult.data ?? []) {
    skipPairKeys.add(`${r.user_a_id}::${r.user_b_id}`);
  }
  for (const r of existingResult.data ?? []) {
    const [a, b] = [r.user_a_id as string, r.user_b_id as string].sort();
    skipPairKeys.add(`${a}::${b}`);
  }

  let pairs = candidatePairs(enriched, { perUserTopK, skipPairKeys });

  if (maxTotalPairs && pairs.length > maxTotalPairs) {
    pairs = pairs
      .map((pair) => ({ pair, sim: cosineSimilarity(pair[0].embedding, pair[1].embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, maxTotalPairs)
      .map(({ pair }) => pair);
  }

  const byUser: Record<string, MatchScore[]> = Object.fromEntries(enriched.map((u) => [u.user_id, []]));

  const limit = createConcurrencyLimiter(llmConcurrency);
  let scored = 0;
  const scores = await Promise.all(
    pairs.map(([a, b]) =>
      limit(async () => {
        const result = await llmPairScore(a, b, { model: llmModel, client: llmClient });
        onProgress?.(++scored, pairs.length);
        return result;
      }),
    ),
  );

  for (const score of scores) {
    byUser[score.user_a_id]?.push(score);
    byUser[score.user_b_id]?.push(score);
  }

  for (const userId of Object.keys(byUser)) {
    byUser[userId] = byUser[userId]
      .filter((m) => m.score >= minScore)
      .sort((x, y) => y.score - x.score)
      .slice(0, finalTopNPerUser);
  }
  return byUser;
}

export function demoUsers(): UserProfile[] {
  /* 10 distinct NYC-beta dry-run users. 5 male + 5 female, varied profiles. */
  return [
    // ── Males ─────────────────────────────────────────────────────────────────
    {
      user_id: "m1",
      name: "Marcus",
      age: 29,
      gender: "MALE",
      height: "5'11",
      preferred_genders: ["FEMALE"],
      preferred_height_min: "5'2", preferred_height_max: "5'8",
      preferred_age_min: 24, preferred_age_max: 33,
      questionnaire_answers: { wants_kids: "maybe", relationship_type: "serious", smoking: "no" },
      onairos_data: { traits: { positive_traits: { "Strategic Thinking": 85, "Deep Focus": 78 } } },
      embedding: [0.85, 0.30, 0.75, 0.88],
      mbti: "INTJ", mbti_source: "questionnaire",
      mbti_preferences: { ENFP: 0.9, INFJ: 0.85, ESFP: 0.15 },
    },
    {
      user_id: "m2",
      name: "Jordan",
      age: 27,
      gender: "MALE",
      height: "6'0",
      preferred_genders: ["FEMALE"],
      preferred_height_min: "5'4", preferred_height_max: "5'9",
      preferred_age_min: 23, preferred_age_max: 30,
      questionnaire_answers: { wants_kids: "yes", relationship_type: "serious", smoking: "no", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Social Intelligence": 88, "Expressive Warmth": 82 } } },
      embedding: [0.30, 0.90, 0.30, 0.70],
      mbti: "ENFP", mbti_source: "questionnaire",
      mbti_preferences: { INFJ: 0.9, INTJ: 0.75, ESTP: 0.2 },
    },
    {
      user_id: "m3",
      name: "Devon",
      age: 31,
      gender: "MALE",
      height: "5'10",
      preferred_genders: ["FEMALE"],
      preferred_height_min: "5'2", preferred_height_max: "5'8",
      preferred_age_min: 26, preferred_age_max: 34,
      questionnaire_answers: { wants_kids: "no", relationship_type: "serious", smoking: "no", drinking: "rarely" },
      onairos_data: { traits: { positive_traits: { "Empathic Listening": 84, "Creative Vision": 77 } } },
      embedding: [0.65, 0.40, 0.70, 0.60],
      mbti: "INFJ", mbti_source: "questionnaire",
      mbti_preferences: { ENFJ: 0.88, ENTJ: 0.7, ESTP: 0.15 },
    },
    {
      user_id: "m4",
      name: "Tyler",
      age: 26,
      gender: "MALE",
      height: "5'8",
      preferred_genders: ["FEMALE"],
      preferred_height_min: "5'0", preferred_height_max: "5'6",
      preferred_age_min: 22, preferred_age_max: 30,
      questionnaire_answers: { wants_kids: "maybe", relationship_type: "casual", smoking: "social", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Spontaneous Energy": 83, "Adaptable Mindset": 79 } } },
      embedding: [0.35, 0.78, 0.28, 0.65],
      mbti: "ESTP", mbti_source: "questionnaire",
      mbti_preferences: { ISFP: 0.85, ESFP: 0.8, INTJ: 0.15 },
    },
    {
      user_id: "m5",
      name: "Caleb",
      age: 33,
      gender: "MALE",
      height: "6'2",
      preferred_genders: ["FEMALE"],
      preferred_height_min: "5'4", preferred_height_max: "5'10",
      preferred_age_min: 27, preferred_age_max: 36,
      questionnaire_answers: { wants_kids: "yes", relationship_type: "serious", smoking: "no", drinking: "no" },
      onairos_data: { traits: { positive_traits: { "Analytical Depth": 90, "Structured Discipline": 86 } } },
      embedding: [0.88, 0.28, 0.82, 0.92],
      mbti: "INTJ", mbti_source: "questionnaire",
      mbti_preferences: { ENFJ: 0.88, INFJ: 0.82, ESFP: 0.1 },
    },
    // ── Females ───────────────────────────────────────────────────────────────
    {
      user_id: "f1",
      name: "Zoe",
      age: 25,
      gender: "FEMALE",
      height: "5'4",
      preferred_genders: ["MALE"],
      preferred_height_min: "5'10", preferred_height_max: "6'2",
      preferred_age_min: 25, preferred_age_max: 33,
      questionnaire_answers: { wants_kids: "maybe", relationship_type: "serious", smoking: "no" },
      onairos_data: { traits: { positive_traits: { "Joyful Presence": 87, "Creative Expression": 81 } } },
      embedding: [0.28, 0.92, 0.25, 0.72],
      mbti: "ENFP", mbti_source: "questionnaire",
      mbti_preferences: { INTJ: 0.9, INFJ: 0.82, ESTP: 0.2 },
    },
    {
      user_id: "f2",
      name: "Maya",
      age: 28,
      gender: "FEMALE",
      height: "5'6",
      preferred_genders: ["MALE"],
      preferred_height_min: "5'11", preferred_height_max: "6'3",
      preferred_age_min: 27, preferred_age_max: 35,
      questionnaire_answers: { wants_kids: "yes", relationship_type: "serious", smoking: "no", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Quiet Strength": 83, "Long-Term Thinking": 88 } } },
      embedding: [0.78, 0.35, 0.65, 0.82],
      mbti: "INFJ", mbti_source: "questionnaire",
      mbti_preferences: { ENFP: 0.85, ENTJ: 0.75, ESTP: 0.15 },
    },
    {
      user_id: "f3",
      name: "Sofia",
      age: 30,
      gender: "FEMALE",
      height: "5'7",
      preferred_genders: ["MALE"],
      preferred_height_min: "5'10", preferred_height_max: "6'1",
      preferred_age_min: 28, preferred_age_max: 36,
      questionnaire_answers: { wants_kids: "no", relationship_type: "serious", smoking: "no", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Executive Drive": 89, "Systems Thinking": 85 } } },
      embedding: [0.82, 0.72, 0.77, 0.85],
      mbti: "ENTJ", mbti_source: "questionnaire",
      mbti_preferences: { INFJ: 0.88, INTJ: 0.82, ESFP: 0.12 },
    },
    {
      user_id: "f4",
      name: "Imani",
      age: 24,
      gender: "FEMALE",
      height: "5'3",
      preferred_genders: ["MALE"],
      preferred_height_min: "5'8", preferred_height_max: "6'0",
      preferred_age_min: 23, preferred_age_max: 30,
      questionnaire_answers: { wants_kids: "maybe", relationship_type: "casual", smoking: "no", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Artistic Sensitivity": 84, "Emotional Depth": 79 } } },
      embedding: [0.40, 0.72, 0.32, 0.60],
      mbti: "ISFP", mbti_source: "questionnaire",
      mbti_preferences: { ESTP: 0.88, ISTP: 0.75, INTJ: 0.2 },
    },
    {
      user_id: "f5",
      name: "Chloe",
      age: 29,
      gender: "FEMALE",
      height: "5'5",
      preferred_genders: ["MALE"],
      preferred_height_min: "5'9", preferred_height_max: "6'2",
      preferred_age_min: 27, preferred_age_max: 36,
      questionnaire_answers: { wants_kids: "yes", relationship_type: "serious", smoking: "no", drinking: "social" },
      onairos_data: { traits: { positive_traits: { "Nurturing Leadership": 86, "Warm Communication": 83 } } },
      embedding: [0.55, 0.45, 0.65, 0.55],
      mbti: "ENFJ", mbti_source: "questionnaire",
      mbti_preferences: { INTJ: 0.85, INFJ: 0.88, ESTP: 0.18 },
    },
  ];
}
