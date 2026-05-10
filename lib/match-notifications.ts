import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createLinqChat, sendLinqChatMessage } from "@/lib/linq-api";
import { fileUrlsFromAnswerString, isFileLikeResponseType } from "@/lib/question-response";
import { resolveLinqFromNumber } from "@/lib/linq-numbers";

type MatchProfile = {
  id: string;
  phone_e164: string;
  display_name: string | null;
  age: number | null;
  city: string | null;
  gender: string | null;
};

export type MatchInviteResult = {
  userAInviteChatId: string;
  userAInviteMessageId: string;
  userBInviteChatId: string;
  userBInviteMessageId: string;
  expiresAt: string;
};

async function fetchProfile(profileId: string): Promise<MatchProfile> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("onboarding_profiles")
    .select("id, phone_e164, display_name, age, city, gender")
    .eq("id", profileId)
    .single();
  if (error || !data) throw new Error(`Profile not found: ${profileId}`);
  return data as MatchProfile;
}

async function fetchPhotoUrls(profileId: string, limit = 5): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("onboarding_answers")
    .select("response_text, questions!inner(response_type, sort_order)")
    .eq("profile_id", profileId);

  if (error) {
    console.error("[fetchPhotoUrls] query error:", error.message, profileId);
    return [];
  }

  if (!data?.length) return [];

  type Row = { response_text: string | null; questions: { response_type?: string | null; sort_order?: number | null } | null };

  const imageRows = (data as Row[])
    .filter((r) => isFileLikeResponseType(r.questions?.response_type))
    .sort((a, b) => (a.questions?.sort_order ?? 999) - (b.questions?.sort_order ?? 999));

  const urls: string[] = [];
  for (const row of imageRows) {
    for (const url of fileUrlsFromAnswerString(row.response_text)) {
      urls.push(url);
      if (urls.length >= limit) return urls;
    }
  }

  return urls;
}



function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function buildMatchCardText(subject: MatchProfile): string {
  const name = subject.display_name?.split(" ")[0] ?? "your match";
  const gender = subject.gender?.toUpperCase();

  // Inline info line — only include fields we have
  const agePart = subject.age != null ? `${gender === "FEMALE" ? "shes" : "hes"} ${subject.age}` : null;
  const cityPart = subject.city ? `lives in ${subject.city}` : null;
  const infoLine = [agePart, cityPart].filter(Boolean).join(", and ");
  const meetLine = infoLine ? `meet ${name}, ${infoLine}.` : `meet ${name}.`;

  let opener: string;
  let tagline: string;

  if (gender === "MALE") {
    // Sending to a girl about a guy
    opener = pick([
      "ngl we want to gatekeep him but we'll share.",
      "ok we debated sending this one. here he is.",
      "not gonna lie, this one was hard to let go of.",
    ]);
    tagline = pick([
      "hes the kind of guy youd actually want to show your friends.",
      "hes the kind of guy that makes you glad you said yes.",
      "hes the kind of guy youll want to tell your girls about.",
    ]);
  } else {
    // Sending to a guy about a girl
    opener = pick([
      "small confession: we got excited about this one.",
      "ok real talk — this one caught our attention.",
      "not gonna lie, weve been waiting to send this one.",
    ]);
    tagline = pick([
      "shes the kind of girl youre gonna want to show off.",
      "shes the kind of person youll actually want your friends to meet.",
      "shes the kind of girl that makes the whole thing worth it.",
    ]);
  }

  return `${opener}\n\n${meetLine}\n${tagline}\n\nreply yes to connect or no to pass 🤍`;
}

// Sends all photos in one stacked message, then sends the identity card text.
// Returns the messageId of the final text card (used as the invite message ID).
async function sendMatchCard(
  chatId: string,
  subject: MatchProfile,
  photoUrls: string[],
): Promise<{ messageId: string }> {
  if (photoUrls.length > 0) {
    const mediaParts = photoUrls.map((url) => ({ type: "media" as const, url }));
    await sendLinqChatMessage(chatId, mediaParts);
    // Wait for media to deliver before sending the text card
    await new Promise((r) => setTimeout(r, 3000));
  }
  const text = buildMatchCardText(subject);
  return sendLinqChatMessage(chatId, [{ type: "text", value: text }]);
}

/**
 * Sends the invite sequence to both users and updates proposed_matches.
 * Call this immediately after the admin approves a match.
 */
export async function sendMatchInvites(
  matchId: string,
  userAId: string,
  userBId: string,
  _reasons: string[],
): Promise<MatchInviteResult> {
  const supabase = getSupabaseAdmin();

  const [profileA, profileB, photosA, photosB] = await Promise.all([
    fetchProfile(userAId),
    fetchProfile(userBId),
    fetchPhotoUrls(userAId),
    fetchPhotoUrls(userBId),
  ]);

  const [resolvedFromA, resolvedFromB] = await Promise.all([
    resolveLinqFromNumber(profileA.phone_e164).catch(() => process.env.LINQ_FROM_NUMBER ?? ""),
    resolveLinqFromNumber(profileB.phone_e164).catch(() => process.env.LINQ_FROM_NUMBER ?? ""),
  ]);

  // ── Send to User A (showing B's details) ──────────────────────────────────
  const { chatId: chatA } = await createLinqChat([profileA.phone_e164], [
    { type: "text", value: "hey! we found someone for you ✨" },
  ], undefined, resolvedFromA || undefined);
  const { messageId: msgA } = await sendMatchCard(chatA, profileB, photosB);

  // ── Send to User B (showing A's details) ──────────────────────────────────
  const { chatId: chatB } = await createLinqChat([profileB.phone_e164], [
    { type: "text", value: "hey! we found someone for you ✨" },
  ], undefined, resolvedFromB || undefined);
  const { messageId: msgB } = await sendMatchCard(chatB, profileA, photosA);

  // ── Persist invite state ───────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await supabase
    .from("proposed_matches")
    .update({
      status: "awaiting_responses",
      user_a_response: "pending",
      user_b_response: "pending",
      user_a_invite_chat_id: chatA,
      user_a_invite_message_id: msgA,
      user_b_invite_chat_id: chatB,
      user_b_invite_message_id: msgB,
      sending_line: resolvedFromA || process.env.LINQ_FROM_NUMBER || null,
      expires_at: expiresAt,
    })
    .eq("id", matchId);

  return {
    userAInviteChatId: chatA,
    userAInviteMessageId: msgA,
    userBInviteChatId: chatB,
    userBInviteMessageId: msgB,
    expiresAt,
  };
}

async function generateIcebreaker(
  userAId: string,
  userBId: string,
  nameA: string,
  nameB: string,
  genderB: string | null,
): Promise<string> {
  const fallback = "what you're most excited about when it comes to meeting someone new";

  try {
    const supabase = getSupabaseAdmin();

    type AnswerRow = {
      response_text: string | null;
      questions: { question: string; response_type?: string | null } | null;
    };

    const [profA, profB, answersA, answersB] = await Promise.all([
      supabase.from("onboarding_profiles").select("intro_reply_raw").eq("id", userAId).single(),
      supabase.from("onboarding_profiles").select("intro_reply_raw").eq("id", userBId).single(),
      supabase
        .from("onboarding_answers")
        .select("response_text, questions!inner(question, response_type)")
        .eq("profile_id", userAId),
      supabase
        .from("onboarding_answers")
        .select("response_text, questions!inner(question, response_type)")
        .eq("profile_id", userBId),
    ]);

    const buildContext = (introReply: string | null, rows: AnswerRow[]) => {
      const lines: string[] = [];
      if (introReply) lines.push(`intro: "${introReply}"`);
      for (const r of rows) {
        if (!r.response_text || !r.questions) continue;
        if (isFileLikeResponseType(r.questions.response_type)) continue;
        lines.push(`Q: ${r.questions.question}\nA: ${r.response_text}`);
      }
      return lines.join("\n");
    };

    const contextA = buildContext(
      (profA.data as { intro_reply_raw?: string | null } | null)?.intro_reply_raw ?? null,
      (answersA.data ?? []) as unknown as AnswerRow[],
    );
    const contextB = buildContext(
      (profB.data as { intro_reply_raw?: string | null } | null)?.intro_reply_raw ?? null,
      (answersB.data ?? []) as unknown as AnswerRow[],
    );

    if (!contextA && !contextB) return fallback;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return fallback;

    // Determine pronoun for user B so the icebreaker reads naturally
    const genderLower = (genderB ?? "").toLowerCase();
    const pronoun = genderLower.startsWith("f") ? "she" : genderLower.startsWith("m") ? "he" : "they";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              `You write one icebreaker prompt for a dating intro message. The message will read: "${nameA}, why don't you tell ${nameB} [your output]".\n` +
              `Write a single lowercase phrase (no quotes, no period) that references something specific ${nameA} mentioned that ${pronoun} (${nameB}) would relate to or find interesting.\n` +
              `Use "she/he/they" to refer to ${nameB}. Be specific and warm. Under 15 words.\n` +
              `Examples: "about that ramen spot you mentioned - pretty sure ${pronoun}'d be into it" | "your saturday hike story - ${pronoun}'s been looking for a trail buddy" | "what got you into pottery - ${pronoun} just signed up for a class"`,
          },
          {
            role: "user",
            content: `${nameA}'s answers:\n${contextA}\n\n${nameB}'s answers:\n${contextB}`,
          },
        ],
        max_tokens: 60,
        temperature: 0.7,
      }),
    });

    if (!res.ok) return fallback;

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const text = (json.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    return text || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Creates the Linq group chat once both users have said YES.
 */
export async function createMatchGroupChat(
  matchId: string,
  userAId: string,
  userBId: string,
  phoneA: string,
  phoneB: string,
): Promise<{ linqChatId: string }> {
  const supabase = getSupabaseAdmin();

  let [profileA, profileB] = await Promise.all([
    fetchProfile(userAId),
    fetchProfile(userBId),
  ]);
  let [pPhoneA, pPhoneB] = [phoneA, phoneB];

  // Ensure male is always nameA (first mentioned)
  const genderA = profileA.gender?.toUpperCase();
  const genderB = profileB.gender?.toUpperCase();
  if (genderA !== "MALE" && genderB === "MALE") {
    [profileA, profileB] = [profileB, profileA];
    [pPhoneA, pPhoneB] = [pPhoneB, pPhoneA];
  }

  const nameA = profileA.display_name?.split(" ")[0] ?? "you";
  const nameB = profileB.display_name?.split(" ")[0] ?? "your match";
  const gcName = `inyo - ${nameA} x ${nameB}`;

  // const icebreaker = await generateIcebreaker(userAId, userBId, nameA, nameB, profileB.gender);

  const announcement = `it's a match! hi ${nameA} please introduce yourself to ${nameB}, we're so excited for you two to meet!`;

  // Use the bot number that user A already knows — avoids a cold message from an unknown number.
  const gcFrom = await resolveLinqFromNumber(pPhoneA).catch(() => process.env.LINQ_FROM_NUMBER ?? "");

  const { chatId, messageId } = await createLinqChat([pPhoneA, pPhoneB], [
    { type: "text", value: announcement },
  ], gcName, gcFrom || undefined);

  // Short delay before the house-rules message so it feels like a separate beat
  await new Promise((r) => setTimeout(r, 1500));

  const houseRules =
    "a reminder: be kind, be genuine, and obviously have fun. please stay in this chat for the safety of everyone involved. - inyo";
  const { messageId: safetyMsgId } = await sendLinqChatMessage(chatId, [
    { type: "text", value: houseRules },
  ]);

  const now = new Date().toISOString();

  await supabase
    .from("proposed_matches")
    .update({
      status: "introduced",
      linq_chat_id: chatId,
      gc_created_at: now,
      opener_message_id: messageId,
      opener_message_sent_at: now,
      safety_message_id: safetyMsgId,
      safety_message_sent_at: now,
    })
    .eq("id", matchId);

  return { linqChatId: chatId };
}
