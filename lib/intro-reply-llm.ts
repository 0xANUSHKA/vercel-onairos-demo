/**
 * First-reply NLP: structured extraction via OpenAI (name, age, height, city, gender).
 * Server-only: pass OPENAI_API_KEY in env, never to the client.
 *
 * Bump `INTRO_NLP_PROMPT_VERSION` when the system prompt or post-processing changes
 * (stored on each successful run in `onboarding_profiles.intro_nlp_version`).
 */
export const INTRO_NLP_PROMPT_VERSION = "4";

export type IntroLlmExtraction = {
  display_name: string | null;
  age: number | null;
  height: string | null;
  city: string | null;
  gender: "MALE" | "FEMALE" | null;
  /** When the model was unsure, we still assign a track from the higher of these (0-100, sum 100). */
  male_confidence: number | null;
  female_confidence: number | null;
  confidence_note: string | null;
};

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM = `You parse SMS/short text replies to a matchmaker (Andy) who asked for the user's name, age, height, and optionally where they live. Users may be informal, use emojis, typos, or list info out of order.

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "display_name": string | null,
  "age": number | null,
  "height": string | null,
  "city": string | null,
  "gender": "MALE" | "FEMALE" | "UNISEX" | null,
  "male_confidence": number,
  "female_confidence": number,
  "confidence_note": string | null
}

Rules:
- display_name: the name they use for themselves; first name or full name, no titles unless that is all they give.
- age: integer 1-120, or null if not stated; never invent an age.
- height: their height in short free text (e.g. 5'10, 5ft 10, 5-10, 178 cm) or null if not stated. Normalize a bit to readable form if obvious.
- city: user's city or general area if stated (e.g. "Lagos", "NYC", "Bay Area"), else null. If they only name a region without a city, put the best short label in city.
- gender: "MALE" or "FEMALE" when they clearly self-identify. Use "UNISEX" when the reply is ambiguous, could be read either way, or has no clear gender cue—the downstream system will pick a track from male_confidence vs female_confidence. Use null only when there is truly no basis to split (rare; prefer UNISEX with a soft split).
- male_confidence and female_confidence: non-negative numbers that **must sum to 100** (e.g. 60 and 40). For clear male identity use something like 92/8; clear female 8/92. For **UNISEX** or **ambiguous** text, still allocate all 100 points between the two: lean toward whichever reading is **slightly** more likely from phrasing, pronouns, or context. Avoid exact 50/50; if you must, use 51/49 toward the slightly more likely.
- Do not infer from name stereotypes alone; linguistic or explicit cues are required for high confidence. confidence_note: one short line, or null.`;

function parseConfidence(n: unknown): number | null {
  if (n == null) return null;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n))) {
    const v = Number(n);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

/**
 * Picks MALE or FEMALE from the model, or from higher male_confidence vs female_confidence when UNISEX/ambiguous.
 */
function resolveResolvedGender(
  o: Record<string, unknown>
): { gender: "MALE" | "FEMALE" | null; male_confidence: number | null; female_confidence: number | null } {
  const mRaw = parseConfidence(o.male_confidence);
  const fRaw = parseConfidence(o.female_confidence);
  let m = mRaw;
  let f = fRaw;
  if (m != null && f != null) {
    const sum = m + f;
    if (sum > 0 && (sum < 99.5 || sum > 100.5)) {
      m = (m / sum) * 100;
      f = (f / sum) * 100;
    }
  }

  const gStr =
    o.gender == null ? "" : String(o.gender).toUpperCase().trim();
  const explicit: "MALE" | "FEMALE" | "UNISEX" | null =
    gStr === "MALE" || gStr === "FEMALE" ? gStr : gStr === "UNISEX" ? "UNISEX" : null;

  if (m != null && f != null) {
    if (m > f) {
      return { gender: "MALE", male_confidence: m, female_confidence: f };
    }
    if (f > m) {
      return { gender: "FEMALE", male_confidence: m, female_confidence: f };
    }
    // tie: use explicit MALE/FEMALE if the model set it; else default MALE for deterministic product behavior
    if (explicit === "MALE" || explicit === "FEMALE") {
      return { gender: explicit, male_confidence: m, female_confidence: f };
    }
    return { gender: "MALE", male_confidence: m, female_confidence: f };
  }

  if (explicit === "MALE" || explicit === "FEMALE") {
    return { gender: explicit, male_confidence: m, female_confidence: f };
  }
  return { gender: null, male_confidence: m, female_confidence: f };
}

function normalizeAge(age: unknown): number | null {
  if (age === null || age === undefined) return null;
  if (typeof age === "number" && Number.isInteger(age) && age >= 1 && age <= 120) return age;
  if (typeof age === "string" && /^\d+$/.test(age)) {
    const n = parseInt(age, 10);
    if (n >= 1 && n <= 120) return n;
  }
  return null;
}

function cleanStr(s: unknown, max: number): string | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export async function extractIntroFieldsWithOpenAI(input: {
  text: string;
  apiKey: string;
  model: string;
}): Promise<IntroLlmExtraction> {
  const userText = input.text.trim();
  if (!userText) {
    throw new Error("Empty first reply text.");
  }

  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Extract from this reply (may be all one line or multiple):\n\n${userText.slice(0, 6_000)}` },
      ],
    }),
  });

  const body = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    throw new Error(`OpenAI error: ${msg}`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No model output.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Model did not return valid JSON.");
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("Model JSON shape invalid.");
  }

  const o = raw as Record<string, unknown>;
  const { gender, male_confidence, female_confidence } = resolveResolvedGender(o);
  const rawG = o.gender == null ? "" : String(o.gender).toUpperCase().trim();
  let note = cleanStr(o.confidence_note, 300);
  if (rawG === "UNISEX" && (gender === "MALE" || gender === "FEMALE")) {
    const mN = male_confidence != null ? Math.round(male_confidence) : "—";
    const fN = female_confidence != null ? Math.round(female_confidence) : "—";
    const suffix = `Unisex/ambiguous: track ${gender} (M ${mN}% / F ${fN}%).`;
    note = note ? `${note} ${suffix}` : suffix;
  }
  if (note && note.length > 300) note = note.slice(0, 297) + "…";
  return {
    display_name: cleanStr(o.display_name, 200),
    age: normalizeAge(o.age),
    height: cleanStr(o.height, 64),
    city: cleanStr(o.city, 120),
    gender,
    male_confidence,
    female_confidence,
    confidence_note: note,
  };
}

export function getOpenAILlmConfig(): { apiKey: string | null; model: string } {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || null;
  const model = (process.env.OPENAI_NLP_MODEL ?? "gpt-4o-mini").trim() || "gpt-4o-mini";
  return { apiKey, model };
}

/** Metadata persisted on the profile for audit when an NLP run completes. */
export function getIntroNlpRunMetadata(model: string): { intro_nlp_model: string; intro_nlp_version: string } {
  return {
    intro_nlp_model: model,
    intro_nlp_version: INTRO_NLP_PROMPT_VERSION,
  };
}

/** Apply extraction fields + audit columns; used on auto-parse and parse-intro apply. */
export function applyIntroExtractionToUpdates(
  extracted: IntroLlmExtraction,
  model: string
): Record<string, unknown> {
  return {
    display_name: extracted.display_name,
    age: extracted.age,
    height: extracted.height,
    city: extracted.city,
    gender: extracted.gender,
    ...getIntroNlpRunMetadata(model),
  };
}
