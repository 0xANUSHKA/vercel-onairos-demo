const MODERATION_URL = "https://api.openai.com/v1/moderations";

export type ModerationResult = {
  flagged: boolean;
  categories: string[];
};

/**
 * Runs text through the OpenAI Moderation API.
 * `allowCategories` lists category names that should not count as a violation
 * (e.g. ["sexual"] to permit adult content while still blocking sexual/minors).
 * Returns { flagged: false } on any error so the caller always gets a safe default.
 */
export async function checkModeration(
  text: string,
  options?: { allowCategories?: string[] },
): Promise<ModerationResult> {
  if (!text.trim()) return { flagged: false, categories: [] };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { flagged: false, categories: [] };

  try {
    const res = await fetch(MODERATION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, model: "omni-moderation-latest" }),
    });

    if (!res.ok) return { flagged: false, categories: [] };

    const json = (await res.json()) as {
      results?: Array<{
        flagged?: boolean;
        categories?: Record<string, boolean>;
      }>;
    };

    const result = json.results?.[0];
    if (!result) return { flagged: false, categories: [] };

    const allowed = new Set(options?.allowCategories ?? []);

    const flaggedCategories = Object.entries(result.categories ?? {})
      .filter(([k, v]) => v && !allowed.has(k))
      .map(([k]) => k);

    return { flagged: flaggedCategories.length > 0, categories: flaggedCategories };
  } catch {
    return { flagged: false, categories: [] };
  }
}
