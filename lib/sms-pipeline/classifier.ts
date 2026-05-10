export type SmsIntent =
  | "photo_decline"
  | "photo_question"
  | "cancel"
  | "pause"
  | "preference_capture"
  | "faq"
  | "unknown";

export type ClassifierResult = {
  intent: SmsIntent;
  confidence: "high" | "low";
  /** Extracted data relevant to the intent, e.g. preference text */
  data?: Record<string, string>;
};

// Fast regex pre-screen — avoids LLM call for obvious cases
const REGEX_RULES: Array<{ pattern: RegExp; intent: SmsIntent }> = [
  { pattern: /\b(delete|cancel|unsubscribe|remove me|opt.?out|stop)\b/i, intent: "cancel" },
  { pattern: /\b(pause|snooze|not now|take a break|break)\b/i, intent: "pause" },
  { pattern: /\b(no (?:photos?|pics?|pictures?)|skip (?:photos?|pics?)|don'?t (?:want|send) (?:photos?|pics?))\b/i, intent: "photo_decline" },
  { pattern: /\b(what is inyo|how does this work|is this real|are you (human|a bot|ai)|who is this|cost|free|privacy|safe)\b/i, intent: "faq" },
];

export function classifyFast(text: string): ClassifierResult | null {
  const t = text.trim();
  for (const { pattern, intent } of REGEX_RULES) {
    if (pattern.test(t)) return { intent, confidence: "high" };
  }
  return null;
}

export async function classifyWithLlm(text: string): Promise<ClassifierResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { intent: "unknown", confidence: "low" };

  const systemPrompt =
    "You classify inbound SMS messages for inyo, an SMS matchmaking service.\n" +
    "Return JSON with keys: intent (one of: photo_decline, photo_question, cancel, pause, preference_capture, faq, unknown), " +
    "confidence (high or low), and optionally data (object with string values relevant to the intent).\n\n" +
    "Definitions:\n" +
    "- photo_decline: user refuses to share photos or asks to skip photos\n" +
    "- photo_question: user asks about the photo requirement\n" +
    "- cancel: user wants to permanently delete their account\n" +
    "- pause: user wants to pause/snooze without deleting\n" +
    "- preference_capture: user states a dating preference (e.g. age range, distance, dealbreakers)\n" +
    "- faq: question about how inyo works, pricing, safety, privacy, or legitimacy\n" +
    "- unknown: none of the above";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_completion_tokens: 150,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return { intent: "unknown", confidence: "low" };

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { intent?: string; confidence?: string; data?: Record<string, string> };

    const validIntents: SmsIntent[] = [
      "photo_decline", "photo_question", "cancel", "pause",
      "preference_capture", "faq", "unknown",
    ];
    const intent = validIntents.includes(parsed.intent as SmsIntent)
      ? (parsed.intent as SmsIntent)
      : "unknown";
    const confidence = parsed.confidence === "high" ? "high" : "low";

    return { intent, confidence, data: parsed.data };
  } catch {
    return { intent: "unknown", confidence: "low" };
  }
}

/**
 * Classifies an inbound SMS. Fast regex first; LLM only if no regex match.
 */
export async function classifySms(text: string): Promise<ClassifierResult> {
  const fast = classifyFast(text);
  if (fast) return fast;
  return classifyWithLlm(text);
}
