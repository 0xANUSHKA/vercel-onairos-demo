const EMOJI_ALLOWLIST = new Set(["🙏"]);

// Patterns that regex can't safely fix — require LLM rewrite
const LLM_TRIGGER_PATTERNS = [
  /\bour AI\b/i,
  /\bthe AI\b/i,
  /\bmy AI\b/i,
  /\bChatGPT\b/i,
  /\bOpenAI\b/i,
  /\bGPT[-\s]?\d/i,
  /\bAlgorithm\b/i,
  /\bLanguage Model\b/i,
];

const SAFE_FALLBACK = "got it, we'll be in touch soon.";

function stageOne(text: string): { result: string; needsLlm: boolean } {
  let s = text;

  // Exclamation marks → period (but not "!!" → "..")
  s = s.replace(/!+/g, ".");

  // Pronoun fixes (order matters — contractions first)
  s = s.replace(/\bI'll\b/g, "we'll");
  s = s.replace(/\bI've\b/g, "we've");
  s = s.replace(/\bI'm\b/g, "we're");
  s = s.replace(/\bI'd\b/g, "we'd");
  s = s.replace(/\bI can\b/g, "we can");
  s = s.replace(/\bI will\b/g, "we will");
  s = s.replace(/\bI have\b/g, "we have");
  s = s.replace(/\bI am\b/g, "we are");
  s = s.replace(/\bI was\b/g, "we were");
  // Standalone I (not part of contractions — those are already handled)
  s = s.replace(/\bI\b(?!')/g, "we");

  // Brand name: "Inyo" → "inyo"
  s = s.replace(/\bInyo\b/g, "inyo");

  // Strip emojis not in allowlist
  // \p{Emoji_Presentation} covers most visual emoji; supplement with the broader \p{Emoji}
  s = s.replace(/\p{Emoji_Presentation}/gu, (ch) => (EMOJI_ALLOWLIST.has(ch) ? ch : ""));
  s = s.replace(/[\u{1F300}-\u{1FFFF}]/gu, (ch) => (EMOJI_ALLOWLIST.has(ch) ? ch : ""));

  // Clean up artefacts: multiple spaces, stray periods from "!." → "."
  s = s.replace(/\.\./g, ".").replace(/\s{2,}/g, " ").trim();

  const needsLlm = LLM_TRIGGER_PATTERNS.some((p) => p.test(s));

  return { result: s, needsLlm };
}

async function stageTwo(text: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const systemPrompt =
    "You are a tone editor for inyo, a human matchmaking service. " +
    "Rewrite the message to follow these rules exactly:\n" +
    "- The matchmaker is 'we', never 'I'\n" +
    "- Never mention AI, algorithms, or technology\n" +
    "- No exclamation marks\n" +
    "- 'inyo' is always lowercase\n" +
    "- Keep the same meaning and warmth\n" +
    "- Return only the rewritten message, nothing else";

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
        max_completion_tokens: 300,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const out = json.choices?.[0]?.message?.content?.trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function applyToneLinter(text: string): Promise<string> {
  if (!text.trim()) return text;

  try {
    const { result, needsLlm } = stageOne(text);

    if (!needsLlm) return result;

    const rewritten = await stageTwo(result);
    if (rewritten) return rewritten;

    // Stage 2 failed — return stage 1 result rather than blocking
    console.warn("[tone-linter] stage 2 failed, using stage 1 output");
    return result;
  } catch (err) {
    // Never block a send due to linter failure
    console.error("[tone-linter] unexpected error:", err);
    return text;
  }
}

// Sync version for cases where async isn't practical (stage 1 only, no LLM)
export function applyToneLinterSync(text: string): string {
  if (!text.trim()) return text;
  try {
    return stageOne(text).result;
  } catch {
    return text;
  }
}
