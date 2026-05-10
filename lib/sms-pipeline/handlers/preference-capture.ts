import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAutomatedSms } from "@/lib/sms-pipeline/send-automated";

export type UserPreference = {
  type: string;
  value: string;
  capturedAt: string;
};

const ACK_REPLY =
  "noted. we'll keep that in mind when we're looking for your match.";

async function extractPreference(
  text: string,
): Promise<{ type: string; value: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract a dating preference from the user's message. Return JSON with keys:\n" +
              "- type: short snake_case label (e.g. age_range, max_distance, dealbreaker, must_have, lifestyle)\n" +
              "- value: a concise description of the preference in the user's own words\n" +
              "If no clear preference is expressed, return {\"type\": null, \"value\": null}.",
          },
          { role: "user", content: text },
        ],
        max_completion_tokens: 80,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { type?: string | null; value?: string | null };

    if (!parsed.type || !parsed.value) return null;
    return { type: parsed.type, value: parsed.value };
  } catch {
    return null;
  }
}

export async function handlePreferenceCapture(
  profileId: string,
  phone: string,
  text: string,
): Promise<void> {
  const pref = await extractPreference(text);
  if (!pref) return;

  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("onboarding_profiles")
    .select("user_preferences")
    .eq("id", profileId)
    .single();

  const existing: UserPreference[] = Array.isArray(data?.user_preferences)
    ? (data.user_preferences as UserPreference[])
    : [];

  const newEntry: UserPreference = {
    type: pref.type,
    value: pref.value,
    capturedAt: new Date().toISOString(),
  };

  // Replace existing entry of same type, or append
  const updated = [
    ...existing.filter((p) => p.type !== pref.type),
    newEntry,
  ];

  await supabase
    .from("onboarding_profiles")
    .update({ user_preferences: updated })
    .eq("id", profileId);

  await sendAutomatedSms(phone, ACK_REPLY, "preference_captured");
}
