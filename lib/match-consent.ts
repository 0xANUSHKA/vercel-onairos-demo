import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendLinqChatMessage } from "@/lib/linq-api";

export type ConsentIntent = "yes" | "no" | "unclear";

const STATUS_CHECK_KEYWORDS = [
  "any progress", "any update", "any news", "any matches", "any luck", "any word",
  "checking in", "check in", "just checking", "heard anything",
  "when will", "when am i", "when do i",
  "still looking", "still waiting",
  "found anyone", "found someone",
  "how's it going", "how is it going", "what's going on", "whats going on",
  "haven't heard", "havent heard", "haven't matched", "havent matched",
  "what's happening", "whats happening", "anything yet",
];

export function isStatusCheckMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return STATUS_CHECK_KEYWORDS.some((kw) => normalized.includes(kw));
}

const YES_KEYWORDS = [
  "yes", "yea", "yeah", "yep", "yup", "ya", "yah",
  "sure", "for sure", "of course", "absolutely", "definitely", "totally",
  "ok", "okay", "sounds good", "sounds great",
  "in", "i'm in", "im in", "i am in", "count me in",
  "down", "i'm down", "im down",
  "let's do it", "lets do it", "let's go", "lets go",
  "why not", "100", "100%",
  "interested", "sign me up", "would love to", "love to",
  "i do", "i would", "i will",
];
const NO_KEYWORDS = [
  "no", "nope", "nah", "nah thanks",
  "pass", "hard pass", "skip",
  "not interested", "not really", "not for me", "not feeling it",
  "i'm good", "im good", "i'm okay", "im okay",
  "no thanks", "no thank you",
  "maybe later", "not now",
  "don't think so", "dont think so",
];

const YES_WAITING_ACKS = [
  // "nice, sounds good. i'll let you know when they reply.",
  "got it - sit tight.",
  // "love that. waiting on them, i'll text you.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function matchesKeyword(normalized: string, kw: string): boolean {
  return (
    normalized === kw ||
    normalized.startsWith(kw + " ") ||
    normalized.endsWith(" " + kw) ||
    normalized.includes(" " + kw + " ")
  );
}

export function parseConsentIntent(text: string): ConsentIntent {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[!.,?'"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const kw of YES_KEYWORDS) {
    if (matchesKeyword(normalized, kw)) return "yes";
  }
  for (const kw of NO_KEYWORDS) {
    if (matchesKeyword(normalized, kw)) return "no";
  }

  return "unclear";
}

type ProposedMatch = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_invite_chat_id: string | null;
  user_b_invite_chat_id: string | null;
  user_a_response: string | null;
  user_b_response: string | null;
  suggested_intro_hook: string | null;
  founder_edited_intro: string | null;
  status: string;
};

/**
 * Called from the Linq inbound webhook when a message arrives in an invite chat.
 * Finds the match, records the response, drives the state machine, and sends
 * the appropriate reply. Returns true if this chatId belongs to a match invite
 * (so the caller can skip the generic onboarding handler).
 */
export async function handleConsentReply(
  incomingChatId: string,
  intent: ConsentIntent,
  rawText = "",
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  // Find the match by invite chat ID — include declined_awaiting_feedback so
  // we can catch the follow-up feedback message and close the loop.
  const { data: matches } = await supabase
    .from("proposed_matches")
    .select("id, user_a_id, user_b_id, user_a_invite_chat_id, user_b_invite_chat_id, user_a_response, user_b_response, suggested_intro_hook, founder_edited_intro, status")
    .or(`user_a_invite_chat_id.eq.${incomingChatId},user_b_invite_chat_id.eq.${incomingChatId}`)
    .in("status", ["awaiting_responses", "awaiting_one_response", "declined_awaiting_feedback"])
    .limit(1);

  const match = matches?.[0] as ProposedMatch | undefined;
  if (!match) return false;

  // ── Feedback reply after a NO ──────────────────────────────────────────────
  // Any message on this chat after the NO is their feedback — close the loop.
  if (match.status === "declined_awaiting_feedback") {
    await Promise.all([
      supabase.from("proposed_matches").update({ status: "declined" }).eq("id", match.id),
      sendLinqChatMessage(incomingChatId, [
        { type: "text", value: "got it, thanks. i'll keep that in mind. - inyo" },
      ]).catch(() => null),
    ]);
    return true;
  }

  // Nudge if reply was not a clear yes/no
  if (intent === "unclear") {
    const replyText =
      match.status === "awaiting_one_response" && isStatusCheckMessage(rawText)
        ? "still waiting to hear back from them — we'll text you as soon as they reply 🤞"
        : "just reply YES to connect or NO to pass 😊";
    await sendLinqChatMessage(incomingChatId, [
      { type: "text", value: replyText },
    ]).catch(() => null);
    return true;
  }

  const isUserA = match.user_a_invite_chat_id === incomingChatId;
  const responseField = isUserA ? "user_a_response" : "user_b_response";
  const respondedAtField = isUserA ? "user_a_responded_at" : "user_b_responded_at";
  const responseValue = intent === "yes" ? "interested" : "declined";

  // Don't overwrite an already-recorded response
  const existingResponse = isUserA ? match.user_a_response : match.user_b_response;
  if (existingResponse && existingResponse !== "pending") return true;

  const now = new Date().toISOString();
  const otherResponse = isUserA ? match.user_b_response : match.user_a_response;

  // Determine new status
  let newStatus = match.status;
  if (intent === "no") {
    newStatus = "declined_awaiting_feedback";
  } else if (intent === "yes") {
    newStatus = otherResponse === "interested" ? "mutual_yes" : "awaiting_one_response";
  }

  await supabase
    .from("proposed_matches")
    .update({ [responseField]: responseValue, [respondedAtField]: now, status: newStatus })
    .eq("id", match.id);

  // ── NO: add to excluded_pairs + ask for feedback ───────────────────────────
  if (intent === "no") {
    const [canonicalA, canonicalB] = [match.user_a_id, match.user_b_id].sort();
    const reason = isUserA ? "declined_by_user_a" : "declined_by_user_b";

    // If the other person already said YES, notify them now
    const yesChatId = isUserA ? match.user_b_invite_chat_id : match.user_a_invite_chat_id;
    const notifyYesPerson = otherResponse === "interested" && yesChatId;

    const notifyPromises: Promise<unknown>[] = [
      Promise.resolve(
        supabase
          .from("excluded_pairs")
          .upsert(
            { user_a_id: canonicalA, user_b_id: canonicalB, reason, match_id: match.id },
            { onConflict: "user_a_id,user_b_id" },
          ),
      ),
      sendLinqChatMessage(incomingChatId, [
        { type: "text", value: "totally get it. what was it about them that didn't feel right? as specific as you want - only helps me find a better fit next time." },
      ]).catch(() => null),
    ];

    if (notifyYesPerson) {
      const yesUserId = isUserA ? match.user_b_id : match.user_a_id;
      const noUserId = isUserA ? match.user_a_id : match.user_b_id;

      notifyPromises.push(
        (async () => {
          const [yesProfile, noProfile] = await Promise.all([
            supabase.from("onboarding_profiles").select("display_name").eq("id", yesUserId).single(),
            supabase.from("onboarding_profiles").select("display_name").eq("id", noUserId).single(),
          ]);
          const yesName = (yesProfile.data as { display_name?: string | null } | null)?.display_name?.split(" ")[0] ?? "hey";
          const noName = (noProfile.data as { display_name?: string | null } | null)?.display_name?.split(" ")[0] ?? "they";

          const msg =
            `hey ${yesName} —\n\n` +
            `${noName} said no.\n` +
            `which honestly: better now than three dates in.\n\n` +
            `this is the system working.\n` +
            `we're back to looking for you.`;

          await sendLinqChatMessage(yesChatId, [{ type: "text", value: msg }]).catch(() => null);
        })(),
      );
    }

    await Promise.all(notifyPromises);
    return true;
  }

  // ── YES — waiting for the other person ────────────────────────────────────
  if (newStatus === "awaiting_one_response") {
    await sendLinqChatMessage(incomingChatId, [
      { type: "text", value: pickRandom(YES_WAITING_ACKS) },
    ]).catch(() => null);
    return true;
  }

  // ── Mutual YES — admin will create the group chat manually from the panel ──
  if (newStatus === "mutual_yes") {
    // Notify both users that it's a match and to expect an intro soon
    const [profileA, profileB] = await Promise.all([
      supabase.from("onboarding_profiles").select("phone_e164, display_name").eq("id", match.user_a_id).single(),
      supabase.from("onboarding_profiles").select("phone_e164, display_name").eq("id", match.user_b_id).single(),
    ]);
    const nameA = (profileA.data as { display_name?: string | null } | null)?.display_name?.split(" ")[0] ?? "hey";
    const nameB = (profileB.data as { display_name?: string | null } | null)?.display_name?.split(" ")[0] ?? "hey";
    const chatIdA = match.user_a_invite_chat_id;
    const chatIdB = match.user_b_invite_chat_id;
    await Promise.all([
      chatIdA ? sendLinqChatMessage(chatIdA, [{ type: "text", value: `it's a match ${nameA}! we're putting your intro together now — you'll hear from us soon 🤍` }]).catch(() => null) : null,
      chatIdB ? sendLinqChatMessage(chatIdB, [{ type: "text", value: `it's a match ${nameB}! we're putting your intro together now — you'll hear from us soon 🤍` }]).catch(() => null) : null,
    ]);
  }

  return true;
}
