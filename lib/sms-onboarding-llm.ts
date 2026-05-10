/**
 * SMS onboarding: OpenAI judges whether a reply is satisfactory, and drafts short clarifications.
 * Server-only; use OPENAI_API_KEY from env in callers.
 */
import { applyIntroExtractionToUpdates, getOpenAILlmConfig, type IntroLlmExtraction } from "@/lib/intro-reply-llm";
import { truncateSmsText } from "@/lib/sms-onboarding-helpers";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export type TranscriptLine = { role: "user" | "assistant"; content: string };

export type IntroEvaluationJson = {
  satisfactory: boolean;
  clarify_message: string | null;
  extraction: {
    display_name: string | null;
    age: number | null;
    height: string | null;
    city: string | null;
    gender: "MALE" | "FEMALE" | "UNISEX" | null;
    male_confidence?: number;
    female_confidence?: number;
  } | null;
};

export type QuestionEvaluationJson = {
  satisfactory: boolean;
  clarify_message: string | null;
  answer_text: string | null;
};

async function chatJson<T>(apiKey: string, model: string, system: string, user: string): Promise<T> {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user.slice(0, 12_000) },
      ],
    }),
  });
  const body = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    throw new Error(body.error?.message ?? res.statusText);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("No model output.");
  return JSON.parse(content) as T;
}

function buildTranscriptBlock(lines: TranscriptLine[]): string {
  if (lines.length === 0) return "(no prior messages)";
  return lines
    .map((l) => `${l.role === "user" ? "User" : "Andy"}: ${l.content}`)
    .join("\n");
}

const INTRO_SYSTEM = `You are a strict but warm SMS assistant for matchmaker "Andy" on Inyo (text-only mobile beta). Your job is to:
1) Decide if the user has given a direct enough answer to Andy's first question. **Required across the thread:** display name, age, and height. **City / where they live is optional** — if they omit location, that is still satisfactory once name, age, and height are present. Answers may be split across a short back-and-forth. Off-topic, hostile-only, or empty = not satisfactory.
2) If not satisfactory, write ONE short SMS (Andy voice: casual, one sentence usually) asking only for what is still missing among **name, age, height** — never ask for location as a requirement. **Never ask for their name again** if they already stated it in any earlier user message in the conversation; reuse it in extraction.display_name and only clarify age/height (or vice versa: never re-ask for fields already clearly given in the thread). Clarify messages must stay about name/age/height/location only—never mention third-party integrations, social account linking, or external APIs.
3) If satisfactory, extract structured fields (merge info from the full conversation, not only the latest message). Never invent age. Height can be free text. City may be null. For gender: only MALE, FEMALE, or UNISEX; give male_confidence and female_confidence 0-100 summing to 100.

Return ONLY valid JSON:
{
  "satisfactory": boolean,
  "clarify_message": string | null,
  "extraction": {
    "display_name": string | null,
    "age": number | null,
    "height": string | null,
    "city": string | null,
    "gender": "MALE" | "FEMALE" | "UNISEX" | null,
    "male_confidence": number,
    "female_confidence": number
  } | null
}
If satisfactory is true, extraction must be non-null with best-effort values. If false, extraction should be null and clarify_message must be a non-empty string.`;

/**
 * One-shot evaluation of intro step (name/age/height) with optional clarify message.
 */
export async function evaluateIntroStep(args: {
  apiKey: string;
  model: string;
  firstQuestionText: string;
  priorTranscript: TranscriptLine[];
  latestUserMessage: string;
}): Promise<IntroEvaluationJson> {
  const user = `Andy's first question was:\n${args.firstQuestionText}\n\nConversation so far:\n${buildTranscriptBlock(
    args.priorTranscript
  )}\n\nLatest user message (just received):\n${args.latestUserMessage}\n\nEvaluate and return JSON.`;

  return chatJson<IntroEvaluationJson>(args.apiKey, args.model, INTRO_SYSTEM, user);
}

const Q_SYSTEM = (question: string) =>
  `You are a warm SMS assistant for matchmaker "Inyo". The user was asked this exact question:\n\n"${question}"\n\n1) Decide if their latest message is a direct, usable answer.\n2) Treat brief but honest answers as valid when they still answer the question (for example: "nobody", "none", "I've never been in a relationship", "not yet"). Do NOT force extra detail after a clear honest answer.\n3) Only mark not satisfactory when the reply is unrelated, pure refusal/hostility, or too ambiguous to store.\n4) If not satisfactory, write ONE short, natural follow-up SMS (Inyo voice) to get a usable answer. Keep it conversational, not exam-like. Max 280 characters. Never mention third-party integrations, social account linking, or external APIs in clarify_message.\n5) If satisfactory, set answer_text to a cleaned version to store (trim, one paragraph max).\n\nReturn ONLY valid JSON:\n{\n  "satisfactory": boolean,\n  "clarify_message": string | null,\n  "answer_text": string | null\n}\nIf satisfactory is true, answer_text must be non-empty. If false, clarify_message must be non-empty.`;

function isExplicitNoExperienceAnswer(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(nobody|no one|none|never|not yet)\b/.test(t) ||
    /i\s*(have|ve)\s*never/.test(t) ||
    /never\s+been\s+(with|in)/.test(t) ||
    /haven'?t\s+been\s+(with|in)/.test(t)
  );
}

function questionAllowsNoExperience(questionText: string): boolean {
  const q = questionText.toLowerCase();
  return (
    q.includes("last person") ||
    q.includes("were into") ||
    q.includes("fell for") ||
    q.includes("relationship") ||
    q.includes("situationship") ||
    q.includes("who's the last") ||
    q.includes("who is the last")
  );
}

export async function evaluateTextQuestionStep(args: {
  apiKey: string;
  model: string;
  questionText: string;
  priorTranscript: TranscriptLine[];
  latestUserMessage: string;
}): Promise<QuestionEvaluationJson> {
  const user = `Conversation for this question:\n${buildTranscriptBlock(
    args.priorTranscript
  )}\n\nLatest user message:\n${args.latestUserMessage}\n\nReturn JSON.`;
  return chatJson<QuestionEvaluationJson>(args.apiKey, args.model, Q_SYSTEM(args.questionText), user);
}

/**
 * Map intro JSON extraction to profile updates + {@link IntroLlmExtraction} for {@link applyIntroExtractionToUpdates} via compatible shape.
 */
function normAge(age: unknown): number | null {
  if (age == null) return null;
  if (typeof age === "number" && Number.isInteger(age) && age >= 1 && age <= 120) return age;
  if (typeof age === "string" && /^\d{1,3}$/.test(age)) {
    const n = parseInt(age, 10);
    if (n >= 1 && n <= 120) return n;
  }
  return null;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

function getMissingIntroFields(extraction: NonNullable<IntroEvaluationJson["extraction"]>): string[] {
  const missing: string[] = [];
  if (!hasMeaningfulValue(extraction.display_name)) missing.push("name");
  if (!hasMeaningfulValue(extraction.age)) missing.push("age");
  if (!hasMeaningfulValue(extraction.height)) missing.push("height");
  return missing;
}

function buildMissingIntroClarifyMessage(missing: string[]): string {
  if (missing.length === 0) {
    return "Quick one—what’s your name, age, and height? (Where you live is optional.)";
  }
  if (missing.length === 1) {
    return `Quick one—what's your ${missing[0]}?`;
  }
  const head = missing.slice(0, -1).join(", ");
  const tail = missing[missing.length - 1];
  return `Quick one—what's your ${head}, and ${tail}?`;
}

export function introJsonToLlmExtraction(
  o: NonNullable<IntroEvaluationJson["extraction"]>
): IntroLlmExtraction {
  const m = Number(o.male_confidence);
  const f = Number(o.female_confidence);
  const mOk = Number.isFinite(m) && m >= 0 ? m : 50;
  const fOk = Number.isFinite(f) && f >= 0 ? f : 50;
  const sum = mOk + fOk;
  const mN = sum > 0 ? (mOk / sum) * 100 : 50;
  const fN = sum > 0 ? (fOk / sum) * 100 : 50;
  const gStr = o.gender == null ? null : String(o.gender).toUpperCase();
  const gender: "MALE" | "FEMALE" | null =
    gStr === "MALE" || gStr === "FEMALE"
      ? gStr
      : gStr === "UNISEX"
        ? mN >= fN
          ? "MALE"
          : "FEMALE"
        : mN > fN
          ? "MALE"
          : "FEMALE";
  return {
    display_name: o.display_name,
    age: normAge(o.age),
    height: o.height,
    city: o.city,
    gender,
    male_confidence: mN,
    female_confidence: fN,
    confidence_note: gStr === "UNISEX" ? "Unisex/ambiguous; split for track." : null,
  };
}

/**
 * With OpenAI: use {@link evaluateIntroStep}. Without: heuristic accept if looks like a real reply, else clarify.
 * When heuristics accept, tries {@link extractIntroFieldsWithOpenAI} if key exists (sub-branch).
 */
export async function runIntroWithFallback(args: {
  firstQuestionText: string;
  priorTranscript: TranscriptLine[];
  latestUserMessage: string;
}): Promise<{
  satisfactory: boolean;
  clarifyMessage: string | null;
  profilePatch: Record<string, unknown> | null;
  extractionForStorage: string;
}> {
  const { apiKey, model } = getOpenAILlmConfig();
  const text = args.latestUserMessage.trim();

  if (apiKey) {
    let ev: IntroEvaluationJson;
    try {
      ev = await evaluateIntroStep({
        apiKey,
        model,
        firstQuestionText: args.firstQuestionText,
        priorTranscript: args.priorTranscript,
        latestUserMessage: text,
      });
    } catch (e) {
      console.error("evaluateIntroStep failed", e);
      return {
        satisfactory: false,
        clarifyMessage: "Small hiccup—can you resend your name, age, and height in one text? (Where you live is optional.)",
        profilePatch: null,
        extractionForStorage: text,
      };
    }
    if (ev.satisfactory && ev.extraction) {
      const missing = getMissingIntroFields(ev.extraction);
      if (missing.length > 0) {
        return {
          satisfactory: false,
          clarifyMessage: truncateSmsText(
            buildMissingIntroClarifyMessage(missing)
          ),
          profilePatch: null,
          extractionForStorage: text,
        };
      }
      const llm = introJsonToLlmExtraction(ev.extraction);
      const storage =
        [llm.display_name, llm.age, llm.height, llm.city].filter((x) => x != null && x !== "").length
          ? [
              llm.display_name,
              llm.age != null ? String(llm.age) : null,
              llm.height,
              llm.city,
            ]
              .filter((x) => x != null && x !== "")
              .join(" · ") || text
          : text;
      return {
        satisfactory: true,
        clarifyMessage: null,
        profilePatch: {
          ...applyIntroExtractionToUpdates(llm, model),
          intro_reply_raw: text,
        },
        extractionForStorage: storage.slice(0, 4_000),
      };
    }
    return {
      satisfactory: false,
      clarifyMessage: truncateSmsText(
        (ev.clarify_message ?? "").trim() ||
          "Quick one—what’s your name, age, and height? (Where you live is optional.)"
      ),
      profilePatch: null,
      extractionForStorage: text,
    };
  }

  if (text.length < 2 || !/[a-zA-Z0-9]/.test(text)) {
    return {
      satisfactory: false,
      clarifyMessage: "What’s your name, age, and height in one line? (Where you live is optional.)",
      profilePatch: null,
      extractionForStorage: text,
    };
  }
  // No key: best-effort acceptance + store raw; profile may lack age/gender
  return {
    satisfactory: true,
    clarifyMessage: null,
    profilePatch: { intro_reply_raw: text },
    extractionForStorage: text.slice(0, 4_000),
  };
}

/**
 * With OpenAI: use {@link evaluateTextQuestionStep}. Without: accept if non-trivial text.
 */
export async function runTextQuestionWithFallback(args: {
  questionText: string;
  priorTranscript: TranscriptLine[];
  latestUserMessage: string;
}): Promise<{
  satisfactory: boolean;
  clarifyMessage: string | null;
  answerText: string | null;
}> {
  const { apiKey, model } = getOpenAILlmConfig();
  const text = args.latestUserMessage.trim();
  if (apiKey) {
    let ev: QuestionEvaluationJson;
    try {
      ev = await evaluateTextQuestionStep({
        apiKey,
        model,
        questionText: args.questionText,
        priorTranscript: args.priorTranscript,
        latestUserMessage: text,
      });
    } catch (e) {
      console.error("evaluateTextQuestionStep failed", e);
      return {
        satisfactory: false,
        clarifyMessage: "One more time—just answer that last question in a line or two.",
        answerText: null,
      };
    }
    if (ev.satisfactory && (ev.answer_text ?? "").trim()) {
      return {
        satisfactory: true,
        clarifyMessage: null,
        answerText: (ev.answer_text ?? text).trim().slice(0, 4_000),
      };
    }
    if (!ev.satisfactory && questionAllowsNoExperience(args.questionText) && isExplicitNoExperienceAnswer(text)) {
      return {
        satisfactory: true,
        clarifyMessage: null,
        answerText: text.slice(0, 4_000),
      };
    }
    return {
      satisfactory: false,
      clarifyMessage: truncateSmsText(
        (ev.clarify_message ?? "").trim() || "Can you try that again with a bit more detail?"
      ),
      answerText: null,
    };
  }
  if (text.length < 1) {
    return {
      satisfactory: false,
      clarifyMessage: "Send a real answer to that question and we’re good.",
      answerText: null,
    };
  }
  return { satisfactory: true, clarifyMessage: null, answerText: text.slice(0, 4_000) };
}
