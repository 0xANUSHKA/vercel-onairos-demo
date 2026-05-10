import { runIntroWithFallback, runTextQuestionWithFallback, type TranscriptLine } from "@/lib/sms-onboarding-llm";
import { normalizePhoneForStorage, phoneLookupCandidates } from "@/lib/phone-e164";
import { isPhoneSmsBanned } from "@/lib/sms-phone-ban";
import { buildWaitlistJoinRow } from "@/lib/waitlist-join";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAutomatedSms } from "@/lib/sms-pipeline/send-automated";
import {
  defaultResponseType,
  isFileLikeResponseType,
  countFileUrlsInAnswerString,
  isValidFileMediaAnswerString,
  mergeFileAnswerStrings,
  parseFileAnswerJson,
  RESPONSE_TYPE_TEXT,
  stringifyFileAnswer,
} from "@/lib/question-response";
import {
  isNanpE164,
  SMS_SOCIAL_CONNECT_FALLBACK_QUESTION,
  sanitizeAssistantSmsBody,
  smsLooksLikeSocialAccountConnectAsk,
  truncateSmsText,
} from "@/lib/sms-onboarding-helpers";
import {
  generateOnboardingQuestionFromAdmin,
  generatePostOnboardingChatReply,
  type ChatLine,
} from "@/lib/inyo-onboarding-agent";
import { isStatusCheckMessage } from "@/lib/match-consent";

/** Normalized form of the opt-in phrase (lowercase, single spaces). */
export const INYO_MATCH_TRIGGER_NORMALIZED = normalizeSmsTriggerText("Hey Inyo, help me find a match!");
const INYO_START_TRIGGER_NORMALIZED = normalizeSmsTriggerText("start");
const INYO_HI_TRIGGER_NORMALIZED = normalizeSmsTriggerText("hi inyo");
const INYO_TRIGGER_SET = new Set([
  INYO_MATCH_TRIGGER_NORMALIZED,
  INYO_START_TRIGGER_NORMALIZED,
  INYO_HI_TRIGGER_NORMALIZED,
]);

export function normalizeSmsTriggerText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isInyoMatchTriggerMessage(text: string): boolean {
  const normalized = normalizeSmsTriggerText(text);
  return INYO_TRIGGER_SET.has(normalized);
}

/** Fallback intro prompt if admin question data is unavailable. */
export const AUTOMATED_FIRST_QUESTION =
  "Hi - Welcome to the Inyo beta. I'm Inyo, your matchmaker. Gonna ask a few quick questions and then match you with someone real. First — what's your name, age, and height? If you'd like to share, what city or area are you in?";
const OPEN_ENDED_CONTINUATION_MESSAGE =
  "Thanks for sharing - I’ve got what I need for matching, and I’m still here if you want to keep chatting. We can talk about anything - what’s on your mind right now?";
const POST_ONBOARDING_FINAL_REPLY_LIMIT = 3;
const POST_ONBOARDING_CLOSING_NOTE =
  "I’ll pause here for now so we don’t keep you texting forever. You’re all set and I’ll use this for matching.";
const OPT_OUT_CONFIRMATION_MESSAGE =
  "You have been unsubscribed from inyo SMS updates and will receive no further messages. Reply \"Hey Inyo, help me find a match!\", \"START\", or \"hi inyo\" to opt back in.";
const SMS_BOT_US_ONLY_MESSAGE =
  "Inyo’s SMS matchmaker is US-only during this beta (+1 numbers). More countries soon — joininyo.com";
const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "STOPNOW", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "PLEASESTOP"]);
const ALREADY_ONBOARDED_MATCH_TRIGGER_REPLY =
  "Hey, looks like we have a profile made for you. Thank you for your patience—this may take some time as we are still on our onboarding phase.";
const MATCH_TRIGGER_ALREADY_IN_PROGRESS_REPLY =
  "Looks like I already have you in the system—just go ahead and answer the previous message to get started.";

type SmsStage =
  | "awaiting_intro"
  | "awaiting_gender"
  | "awaiting_onairos_opt_in"
  | "awaiting_sms_q"
  | "sms_onboarding_complete"
  | "intro_answered"
  | null;

function isMidFlowOnboardingStage(stage: SmsStage): boolean {
  return (
    stage === "awaiting_intro" ||
    stage === "awaiting_gender" ||
    stage === "awaiting_onairos_opt_in" ||
    stage === "awaiting_sms_q" ||
    stage === "intro_answered"
  );
}

function shouldHandleInboundEvent(eventType: string): boolean {
  const t = eventType.trim().toLowerCase().replace(/_/g, ".");
  return t === "message.received" || t.endsWith(".message.received");
}

function isOptOutMessage(text: string): boolean {
  // Carriers require honoring exact opt-out commands; do not trigger from normal prose.
  const normalized = text.trim().toUpperCase();
  if (!normalized) return false;
  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  return OPT_OUT_KEYWORDS.has(compact);
}

type QuestionRow = {
  id: string;
  question: string;
  sort_order: number;
  response_type: string | null;
  min_file_count?: number | null;
};

function minFileCountForQuestion(q: { min_file_count?: number | null }): number {
  const n = Number(q.min_file_count);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(20, Math.floor(n));
}

async function loadQuestionsForGender(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  gender: "MALE" | "FEMALE"
): Promise<QuestionRow[]> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, question, sort_order, response_type, min_file_count, created_at")
    .eq("gender", gender)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("sms-onboarding: load questions", error.message);
    return [];
  }
  return (data ?? []) as QuestionRow[];
}

async function loadIntroQuestionFromAdmin(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<string> {
  const { data, error } = await supabase
    .from("questions")
    .select("question, sort_order, response_type, created_at, gender")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return AUTOMATED_FIRST_QUESTION;

  const firstTrackTextQuestions = data.filter((q) => {
    const question = String(q.question ?? "").trim();
    const gender = String((q as { gender?: string | null }).gender ?? "").toUpperCase();
    return (
      question.length > 0 &&
      Number(q.sort_order) === 1 &&
      defaultResponseType(q.response_type) === RESPONSE_TYPE_TEXT &&
      (gender === "MALE" || gender === "FEMALE")
    );
  });

  if (firstTrackTextQuestions.length > 0) {
    const firstQuestion = String(firstTrackTextQuestions[0]?.question ?? "").trim();
    if (firstQuestion) return firstQuestion;
  }

  const textQuestions = data.filter((q) => {
    const question = String(q.question ?? "").trim();
    return question.length > 0 && defaultResponseType(q.response_type) === RESPONSE_TYPE_TEXT;
  });
  const fallbackQuestion = String(textQuestions[0]?.question ?? "").trim();
  return fallbackQuestion || AUTOMATED_FIRST_QUESTION;
}

function pickDeterministicQuestionBySeed(
  questions: string[],
  seed: string
): string {
  if (questions.length === 0) return "";
  const normalizedSeed = seed.trim() || "inyo";
  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    hash = (hash * 31 + normalizedSeed.charCodeAt(i)) >>> 0;
  }
  return questions[hash % questions.length] ?? questions[0] ?? "";
}

async function pickInitialTrackFirstQuestion(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  seed: string;
}): Promise<string> {
  const { supabase, seed } = args;
  const { data, error } = await supabase
    .from("questions")
    .select("question, sort_order, response_type, created_at, gender")
    .in("gender", ["MALE", "FEMALE"])
    .eq("sort_order", 1)
    .order("created_at", { ascending: true });

  if (!error && data && data.length > 0) {
    const candidates = data
      .filter((q) => defaultResponseType(q.response_type) === RESPONSE_TYPE_TEXT)
      .map((q) => String(q.question ?? "").trim())
      .filter(Boolean);
    if (candidates.length > 0) {
      const picked = pickDeterministicQuestionBySeed(candidates, seed);
      if (picked) return picked;
    }
  }

  return loadIntroQuestionFromAdmin(supabase);
}

async function loadMostRecentIntroQuestionFromTranscript(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("onboarding_sms_transcript")
    .select("body")
    .eq("profile_id", profileId)
    .eq("role", "assistant")
    .eq("message_kind", "question")
    .is("question_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const body = String((data ?? [])[0]?.body ?? "").trim();
  return body || null;
}

async function fetchTranscriptForLlm(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<TranscriptLine[]> {
  const { data, error } = await supabase
    .from("onboarding_sms_transcript")
    .select("role, body, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    role: r.role as "user" | "assistant",
    content: String(r.body ?? ""),
  }));
}

async function getPostOnboardingReplyCount(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<number> {
  const id = profileId.trim();
  if (!id) return 0;
  const { count, error } = await supabase
    .from("onboarding_sms_transcript")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", id)
    .eq("role", "assistant")
    .eq("message_kind", "system")
    .is("question_id", null)
    .neq("body", OPEN_ENDED_CONTINUATION_MESSAGE);
  if (error) {
    console.error("sms-onboarding: failed to check post-onboarding message limit", error.message);
    return 0;
  }
  return count ?? 0;
}

function mapTranscriptToAgentHistory(lines: TranscriptLine[]): ChatLine[] {
  return lines.map((line) => ({
    role: line.role,
    content: line.content,
  }));
}

async function generateAgentQuestionText(args: {
  adminQuestion: string;
  adminQuestions?: string[];
  profileGender: "MALE" | "FEMALE" | null;
  transcript: TranscriptLine[];
  isIntro?: boolean;
  isFinalQuestion?: boolean;
  isMediaQuestion?: boolean;
  /** When >1, instructs the rewriter to ask for that many uploads consistently (SMS media steps). */
  minFileCount?: number;
}): Promise<string> {
  const adminQuestion = args.adminQuestion.trim();
  if (!adminQuestion) return "";
  try {
    const result = await generateOnboardingQuestionFromAdmin({
      gender: args.profileGender === "MALE" ? "male" : "female",
      adminQuestion,
      adminQuestions: args.adminQuestions,
      transcript: mapTranscriptToAgentHistory(args.transcript),
      isIntro: args.isIntro,
      isFinalQuestion: args.isFinalQuestion,
      isMediaQuestion: args.isMediaQuestion,
      minFileCount: args.minFileCount,
    });
    const trimmed = result.trim() || adminQuestion;
    if (smsLooksLikeSocialAccountConnectAsk(trimmed)) {
      console.warn("sms-onboarding: replaced question that suggested social account linking");
      return args.isIntro ? AUTOMATED_FIRST_QUESTION : SMS_SOCIAL_CONNECT_FALLBACK_QUESTION;
    }
    return trimmed;
  } catch (e) {
    console.error("sms-onboarding: agent question generation failed", e);
    return adminQuestion;
  }
}

async function appendTranscript(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: {
    profileId: string;
    role: "user" | "assistant";
    body: string;
    questionId: string | null;
    messageKind: "turn" | "outbound" | "clarify" | "question" | "system";
  }
): Promise<void> {
  const { error } = await supabase.from("onboarding_sms_transcript").insert({
    profile_id: args.profileId,
    role: args.role,
    body: args.body,
    question_id: args.questionId,
    message_kind: args.messageKind,
  });
  if (error) {
    console.error("sms-onboarding: transcript insert failed", error.message);
  }
}

async function sendAutomatedToParticipant(
  participantPhone: string,
  text: string,
  eventType: string
): Promise<void> {
  await sendAutomatedSms(participantPhone, text, eventType);
}

async function startSmsOnboardingWithFirstQuestion(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  profileId: string;
  participantPhone: string;
  inboundEventType: string;
}): Promise<void> {
  const adminIntroQuestion = await pickInitialTrackFirstQuestion({
    supabase: args.supabase,
    seed: args.profileId || args.participantPhone,
  });
  const styledIntroQuestion = await generateAgentQuestionText({
    adminQuestion: adminIntroQuestion,
    profileGender: null,
    transcript: [],
    isIntro: true,
  });

  await sendAutomatedToParticipant(args.participantPhone, styledIntroQuestion, "automated.first_question");
  await appendTranscript(args.supabase, {
    profileId: args.profileId,
    role: "assistant",
    body: styledIntroQuestion,
    questionId: null,
    messageKind: "question",
  });
  await args.supabase
    .from("onboarding_profiles")
    .update({ sms_onboarding_stage: "awaiting_intro", sms_active_question_id: null })
    .eq("id", args.profileId);
}

async function resetOnboardingForRestart(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<void> {
  const { error: answersErr } = await supabase
    .from("onboarding_answers")
    .delete()
    .eq("profile_id", profileId);
  if (answersErr) {
    console.error("sms-onboarding: failed to clear answers on restart", answersErr.message);
  }

  const { error: transcriptErr } = await supabase
    .from("onboarding_sms_transcript")
    .delete()
    .eq("profile_id", profileId);
  if (transcriptErr) {
    console.error("sms-onboarding: failed to clear transcript on restart", transcriptErr.message);
  }

  const { error: profileErr } = await supabase
    .from("onboarding_profiles")
    .update({
      sms_onboarding_stage: null,
      sms_active_question_id: null,
      intro_reply_raw: null,
      gender: null,
      display_name: null,
      age: null,
      height: null,
      city: null,
      country: null,
      intro_nlp_model: null,
      intro_nlp_version: null,
    })
    .eq("id", profileId);
  if (profileErr) {
    console.error("sms-onboarding: failed to clear profile state on restart", profileErr.message);
  }
}

/**
 * Optional bot-first entrypoint: call this to proactively text the participant with Q1.
 */
export async function startSmsOnboardingForParticipant(participantPhone: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const normalizedParticipantPhone = normalizePhoneForStorage(participantPhone);
  if (!isNanpE164(normalizedParticipantPhone)) return;
  const phoneCandidates = phoneLookupCandidates(participantPhone);
  if (await isPhoneSmsBanned(supabase, phoneCandidates)) return;
  const { data: waitlistRows } = await supabase
    .from("waitlist")
    .select("id, value, created_at")
    .in("value", phoneCandidates)
    .order("created_at", { ascending: false })
    .limit(1);
  const wl = (waitlistRows ?? [])[0] as { id?: string | number; value?: string } | undefined;
  if (!wl?.id) return;

  const waitlistId = String(wl.id);
  // Admin-initiated onboarding should explicitly opt this user into SMS onboarding.
  const { error: consentErr } = await supabase
    .from("waitlist")
    .update({ sms_consent: true })
    .eq("id", waitlistId);
  if (consentErr) {
    console.error("sms-onboarding: failed to enable sms_consent on admin start", consentErr.message);
    return;
  }

  const { data: existingProfiles } = await supabase
    .from("onboarding_profiles")
    .select("id, sms_onboarding_stage, created_at")
    .eq("waitlist_id", waitlistId)
    .order("created_at", { ascending: false })
    .limit(1);
  const existingProfile = (existingProfiles ?? [])[0] as
    | { id?: string; sms_onboarding_stage?: SmsStage }
    | undefined;

  let profileId = existingProfile?.id ? String(existingProfile.id) : "";
  if (!profileId) {
    const { data: created, error: insErr } = await supabase
      .from("onboarding_profiles")
      .insert({
        waitlist_id: waitlistId,
        phone_e164: normalizedParticipantPhone,
      })
      .select("id")
      .single();
    if (insErr || !created?.id) return;
    profileId = String(created.id);
  }

  const stage = (existingProfile?.sms_onboarding_stage as SmsStage) ?? null;
  if (
    stage === "awaiting_intro" ||
    stage === "awaiting_gender" ||
    stage === "awaiting_onairos_opt_in" ||
    stage === "awaiting_sms_q" ||
    stage === "intro_answered" ||
    stage === "sms_onboarding_complete"
  ) {
    return;
  }

  await startSmsOnboardingWithFirstQuestion({
    supabase,
    profileId,
    participantPhone: normalizedParticipantPhone,
    inboundEventType: "automated.bot_first",
  });
}

function parseGenderFromShortReply(text: string): "MALE" | "FEMALE" | null {
  const t = normalizeSmsTriggerText(text);
  if (t === "male" || t === "m" || t === "man" || t === "guy") return "MALE";
  if (t === "female" || t === "f" || t === "woman" || t === "girl") return "FEMALE";
  return null;
}

async function afterIntroSavedContinueToTrackQuestions(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  profileId: string;
  participantPhoneNormalized: string;
  gender: "MALE" | "FEMALE";
  extractionForStorage: string;
}): Promise<void> {
  const { supabase, profileId, participantPhoneNormalized, gender, extractionForStorage } = args;
  const allQs = await loadQuestionsForGender(supabase, gender);
  if (allQs.length === 0) {
    await supabase
      .from("onboarding_profiles")
      .update({ sms_onboarding_stage: "sms_onboarding_complete", sms_active_question_id: null })
      .eq("id", profileId);
    return;
  }

  await upsertAnswer(supabase, profileId, allQs[0]!.id, extractionForStorage);

  await continueToGenderQuestions({
    supabase,
    profileId,
    participantPhoneNormalized,
  });
}

async function upsertAnswer(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  profileId: string,
  questionId: string,
  responseText: string
): Promise<void> {
  const { error } = await supabase.from("onboarding_answers").upsert(
    {
      profile_id: profileId,
      question_id: questionId,
      response_text: responseText,
    },
    { onConflict: "profile_id, question_id" }
  );
  if (error) {
    console.error("sms-onboarding: answer upsert failed", error.message);
  }
}

async function continueToGenderQuestions(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  profileId: string;
  participantPhoneNormalized: string;
}): Promise<void> {
  const { supabase, profileId, participantPhoneNormalized } = args;
  const { data: profileRows } = await supabase
    .from("onboarding_profiles")
    .select("gender")
    .eq("id", profileId)
    .limit(1);
  const gender = ((profileRows ?? [])[0]?.gender as "MALE" | "FEMALE" | null) ?? null;
  if (!gender) {
    await supabase
      .from("onboarding_profiles")
      .update({ sms_onboarding_stage: "intro_answered", sms_active_question_id: null })
      .eq("id", profileId);
    return;
  }

  const allQs = await loadQuestionsForGender(supabase, gender);
  if (allQs.length <= 1) {
    await supabase
      .from("onboarding_profiles")
      .update({ sms_onboarding_stage: "sms_onboarding_complete", sms_active_question_id: null })
      .eq("id", profileId);
    try {
      await sendAutomatedToParticipant(
        participantPhoneNormalized,
        OPEN_ENDED_CONTINUATION_MESSAGE,
        "automated.sms_onboarding_done"
      );
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: OPEN_ENDED_CONTINUATION_MESSAGE,
        questionId: null,
        messageKind: "system",
      });
    } catch (e) {
      console.error("sms-onboarding: final thank-you failed", e);
    }
    return;
  }

  const nextQ = allQs[1]!;
  await supabase
    .from("onboarding_profiles")
    .update({
      sms_onboarding_stage: "awaiting_sms_q",
      sms_active_question_id: nextQ.id,
    })
    .eq("id", profileId);

  const transcriptWithIntro = await fetchTranscriptForLlm(supabase, profileId);
  const qText = await generateAgentQuestionText({
    adminQuestion: nextQ.question.trim(),
    adminQuestions: allQs.map((q) => q.question.trim()).filter(Boolean),
    profileGender: gender,
    transcript: transcriptWithIntro,
    isFinalQuestion: allQs.length - 1 === 1,
    isMediaQuestion: isFileLikeResponseType(nextQ.response_type),
    minFileCount: isFileLikeResponseType(nextQ.response_type) ? minFileCountForQuestion(nextQ) : undefined,
  });
  try {
    await sendAutomatedToParticipant(participantPhoneNormalized, qText, "automated.next_question");
    await appendTranscript(supabase, {
      profileId,
      role: "assistant",
      body: qText,
      questionId: nextQ.id,
      messageKind: "question",
    });
  } catch (e) {
    console.error("sms-onboarding: send next question failed", e);
  }
}

function normalizeInboundMediaUrls(urls: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls ?? []) {
    const url = String(raw ?? "").trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function buildFileAnswerFromInbound(
  inboundText: string,
  inboundMediaUrls?: string[] | null
): string | null {
  const text = inboundText.trim();
  const mediaUrls = normalizeInboundMediaUrls(inboundMediaUrls);

  if (isValidFileMediaAnswerString(text)) {
    const parsed = parseFileAnswerJson(text);
    const urls = normalizeInboundMediaUrls((parsed?.files ?? []).map((f) => f.url));
    if (urls.length > 0) return stringifyFileAnswer(urls.map((url) => ({ url })));
  }

  if (mediaUrls.length > 0) {
    return stringifyFileAnswer(mediaUrls.map((url) => ({ url })));
  }

  const urlish = text
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  const normalizedUrlish = normalizeInboundMediaUrls(urlish);
  if (normalizedUrlish.length > 0) {
    return stringifyFileAnswer(normalizedUrlish.map((url) => ({ url })));
  }

  return null;
}

/**
 * After an inbound SMS is stored: waitlist gate, opt-in → first question; intro / track questions with OpenAI.
 */
export async function processSmsOnboardingInbound(args: {
  participantPhone: string;
  inboundText: string;
  inboundMediaUrls?: string[];
  inboundEventType: string;
  isInbound: boolean;
}): Promise<void> {
  if (!args.isInbound) return;
  if (!shouldHandleInboundEvent(args.inboundEventType)) return;

  const participantPhoneNormalized = normalizePhoneForStorage(args.participantPhone);
  const participantPhoneCandidates = phoneLookupCandidates(args.participantPhone);
  const text = args.inboundText.trim();
  const requestedRestart = isInyoMatchTriggerMessage(text);
  const mediaUrls = normalizeInboundMediaUrls(args.inboundMediaUrls);
  if (!text && mediaUrls.length === 0) return;
  const requestedOptOut = isOptOutMessage(text);

  const supabase = getSupabaseAdmin();

  const banned = await isPhoneSmsBanned(supabase, participantPhoneCandidates);
  if (banned) {
    if (requestedOptOut) {
      const { data: wlOptRows, error: wlOptErr } = await supabase
        .from("waitlist")
        .select("id")
        .in("value", participantPhoneCandidates)
        .order("created_at", { ascending: false })
        .limit(1);
      if (wlOptErr) return;
      const wlOpt = (wlOptRows ?? [])[0] as { id?: string | number } | undefined;
      if (wlOpt?.id) {
        const { error: consentErr } = await supabase
          .from("waitlist")
          .update({ sms_consent: false })
          .eq("id", String(wlOpt.id));
        if (consentErr) {
          console.error("sms-onboarding: failed to persist STOP opt-out (banned)", consentErr.message);
        }
        await sendAutomatedToParticipant(
          participantPhoneNormalized,
          OPT_OUT_CONFIRMATION_MESSAGE,
          "automated.opt_out_confirmation"
        );
      }
      return;
    }
    return;
  }

  if (!isNanpE164(participantPhoneNormalized)) {
    if (requestedOptOut) {
      const { data: wlOptRows, error: wlOptErr } = await supabase
        .from("waitlist")
        .select("id")
        .in("value", participantPhoneCandidates)
        .order("created_at", { ascending: false })
        .limit(1);
      if (wlOptErr) return;
      const wlOpt = (wlOptRows ?? [])[0] as { id?: string | number } | undefined;
      if (wlOpt?.id) {
        const { error: consentErr } = await supabase
          .from("waitlist")
          .update({ sms_consent: false })
          .eq("id", String(wlOpt.id));
        if (consentErr) {
          console.error("sms-onboarding: failed to persist STOP opt-out (non-NANP)", consentErr.message);
        }
        await sendAutomatedToParticipant(
          participantPhoneNormalized,
          OPT_OUT_CONFIRMATION_MESSAGE,
          "automated.opt_out_confirmation"
        );
      }
      return;
    }
    await sendAutomatedToParticipant(
      participantPhoneNormalized,
      SMS_BOT_US_ONLY_MESSAGE,
      "automated.non_us_sms_beta"
    );
    return;
  }

  const { data: waitlistRows, error: wlErr } = await supabase
    .from("waitlist")
    .select("id, value, sms_consent, created_at")
    .in("value", participantPhoneCandidates)
    .order("created_at", { ascending: false })
    .limit(1);
  let wl = (waitlistRows ?? [])[0] as
    | { id?: string | number; value?: string; sms_consent?: boolean | null }
    | undefined;
  if (wlErr) return;
  if (!wl?.id && requestedRestart) {
    const insertRow = buildWaitlistJoinRow({
      phoneE164: participantPhoneNormalized,
      consent: {
        is18Plus: false,
        termsAccepted: false,
        smsConsent: true,
        liabilityUnderstood: false,
      },
    });
    const { data: createdWaitlist, error: wlInsertErr } = await supabase
      .from("waitlist")
      .insert([insertRow])
      .select("id, value, sms_consent, created_at")
      .single();
    if (wlInsertErr && wlInsertErr.code !== "23505") {
      console.error("sms-onboarding: failed to auto-create waitlist row", wlInsertErr.message);
      return;
    }
    if (!wlInsertErr && createdWaitlist) {
      wl = createdWaitlist as { id?: string | number; value?: string; sms_consent?: boolean | null };
    } else {
      const { data: retryRows } = await supabase
        .from("waitlist")
        .select("id, value, sms_consent, created_at")
        .in("value", participantPhoneCandidates)
        .order("created_at", { ascending: false })
        .limit(1);
      wl = (retryRows ?? [])[0] as { id?: string | number; value?: string; sms_consent?: boolean | null } | undefined;
    }
  }
  if (!wl?.id) return;

  const waitlistId = String(wl.id);
  const smsConsent = wl.sms_consent !== false;

  if (requestedOptOut) {
    const { error: consentErr } = await supabase
      .from("waitlist")
      .update({ sms_consent: false })
      .eq("id", waitlistId);
    if (consentErr) {
      console.error("sms-onboarding: failed to persist STOP opt-out", consentErr.message);
    }

    await sendAutomatedToParticipant(
      participantPhoneNormalized,
      OPT_OUT_CONFIRMATION_MESSAGE,
      "automated.opt_out_confirmation"
    );
    return;
  }

  if (requestedRestart && !smsConsent) {
    const { error: consentErr } = await supabase
      .from("waitlist")
      .update({ sms_consent: true })
      .eq("id", waitlistId);
    if (consentErr) {
      console.error("sms-onboarding: failed to persist opt-in via trigger phrase", consentErr.message);
      return;
    }
  } else if (!smsConsent) {
    return;
  }

  const { data: existingProfiles } = await supabase
    .from("onboarding_profiles")
    .select("id, sms_onboarding_stage, intro_reply_raw, gender, sms_active_question_id, photos_skipped, created_at")
    .eq("waitlist_id", waitlistId)
    .order("created_at", { ascending: false })
    .limit(1);
  const existingProfile = (existingProfiles ?? [])[0] as
    | {
        id?: string;
        sms_onboarding_stage?: SmsStage;
        intro_reply_raw?: string | null;
        gender?: string | null;
        sms_active_question_id?: string | null;
        photos_skipped?: boolean | null;
      }
    | undefined;

  let profileId: string;
  let stage: SmsStage = (existingProfile?.sms_onboarding_stage as SmsStage) ?? null;
  let activeQuestionId: string | null = (existingProfile as { sms_active_question_id?: string | null })
    ?.sms_active_question_id ?? null;
  const photosSkipped = (existingProfile as { photos_skipped?: boolean | null } | undefined)?.photos_skipped ?? false;

  if (existingProfile?.id) {
    profileId = String(existingProfile.id);
  } else {
    const { data: created, error: insErr } = await supabase
      .from("onboarding_profiles")
      .insert({
        waitlist_id: waitlistId,
        phone_e164: participantPhoneNormalized,
      })
      .select("id")
      .single();
    if (insErr || !created?.id) {
      console.error("sms-onboarding: failed to create profile", insErr?.message);
      return;
    }
    profileId = String(created.id);
    stage = null;
    activeQuestionId = null;
  }

  if (requestedRestart) {
    if (stage === "sms_onboarding_complete") {
      await appendTranscript(supabase, {
        profileId,
        role: "user",
        body: text,
        questionId: null,
        messageKind: "turn",
      });
      await sendAutomatedToParticipant(
        participantPhoneNormalized,
        ALREADY_ONBOARDED_MATCH_TRIGGER_REPLY,
        "automated.already_onboarded_match_trigger"
      );
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: ALREADY_ONBOARDED_MATCH_TRIGGER_REPLY,
        questionId: null,
        messageKind: "clarify",
      });
      return;
    }
    if (isMidFlowOnboardingStage(stage)) {
      await appendTranscript(supabase, {
        profileId,
        role: "user",
        body: text,
        questionId: null,
        messageKind: "turn",
      });
      await sendAutomatedToParticipant(
        participantPhoneNormalized,
        MATCH_TRIGGER_ALREADY_IN_PROGRESS_REPLY,
        "automated.match_trigger_already_in_progress"
      );
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: MATCH_TRIGGER_ALREADY_IN_PROGRESS_REPLY,
        questionId: null,
        messageKind: "clarify",
      });
      return;
    }
    try {
      await resetOnboardingForRestart(supabase, profileId);
      await startSmsOnboardingWithFirstQuestion({
        supabase,
        profileId,
        participantPhone: participantPhoneNormalized,
        inboundEventType: args.inboundEventType,
      });
    } catch (e) {
      console.error("sms-onboarding: failed to send first question", e);
    }
    return;
  }

  if (stage === "sms_onboarding_complete") {
    try {
      // If this user has an active match invite, intercept YES/NO here — the
      // Linq chatId may be absent (e.g. Telnyx inbound or malformed webhook).
      const { parseConsentIntent, handleConsentReply } = await import("@/lib/match-consent");
      const consentIntent = parseConsentIntent(text);
      if (consentIntent !== "unclear") {
        const { data: activeInvites } = await supabase
          .from("proposed_matches")
          .select("user_a_id, user_b_id, user_a_invite_chat_id, user_b_invite_chat_id")
          .or(`user_a_id.eq.${profileId},user_b_id.eq.${profileId}`)
          .in("status", ["awaiting_responses", "awaiting_one_response"])
          .limit(1);
        const invite = activeInvites?.[0] as {
          user_a_id: string; user_b_id: string;
          user_a_invite_chat_id: string | null; user_b_invite_chat_id: string | null;
        } | undefined;
        if (invite) {
          const chatId =
            invite.user_a_id === profileId
              ? invite.user_a_invite_chat_id
              : invite.user_b_invite_chat_id;
          if (chatId) {
            await handleConsentReply(chatId, consentIntent, text);
            return;
          }
        }
      }

      // If this user has an active match with auto-reply disabled, skip automated replies.
      const { data: activeMatch } = await supabase
        .from("proposed_matches")
        .select("id, user_a_id, user_a_auto_reply_enabled, user_b_auto_reply_enabled")
        .or(`user_a_id.eq.${profileId},user_b_id.eq.${profileId}`)
        .in("status", ["approved", "awaiting_responses", "awaiting_one_response", "mutual_yes", "introduced"])
        .limit(1);
      if (activeMatch?.[0]) {
        const m = activeMatch[0] as { id: string; user_a_id: string; user_a_auto_reply_enabled: boolean; user_b_auto_reply_enabled: boolean };
        const isUserA = m.user_a_id === profileId;
        const autoReplyOn = isUserA ? m.user_a_auto_reply_enabled : m.user_b_auto_reply_enabled;
        if (!autoReplyOn) return;
      }

      const prior = await fetchTranscriptForLlm(supabase, profileId);
      await appendTranscript(supabase, {
        profileId,
        role: "user",
        body: text,
        questionId: null,
        messageKind: "turn",
      });

      // Status-check messages get a direct reassuring reply — don't burn the
      // LLM reply cap or confuse the agent with a non-conversational message.
      if (isStatusCheckMessage(text)) {
        await sendAutomatedToParticipant(
          args.participantPhone,
          "we're still working on finding you someone great! sorry for the wait — appreciate your patience 🙏",
          "automated.status_check_reply",
        );
        return;
      }

      const postOnboardingReplyCount = await getPostOnboardingReplyCount(supabase, profileId);
      if (postOnboardingReplyCount >= POST_ONBOARDING_FINAL_REPLY_LIMIT) {
        return;
      }
      const isFinalAllowedReply =
        postOnboardingReplyCount === POST_ONBOARDING_FINAL_REPLY_LIMIT - 1;

      let reply =
        (await generatePostOnboardingChatReply({
          inboundMessage: text,
          transcript: mapTranscriptToAgentHistory(prior),
          isClosingTurn: isFinalAllowedReply,
          closingParagraph: isFinalAllowedReply ? POST_ONBOARDING_CLOSING_NOTE : undefined,
        })) ||
        (isFinalAllowedReply
          ? `Thanks for opening up. ${POST_ONBOARDING_CLOSING_NOTE}`
          : "You’re all set, and I’m still here for you. If you want to share more about your dating life or what you’re looking for, just text me.");
      await sendAutomatedToParticipant(args.participantPhone, reply, "automated.post_onboarding_chat");
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: reply,
        questionId: null,
        messageKind: "system",
      });
    } catch (e) {
      console.error("sms-onboarding: post-onboarding chat reply failed", e);
    }
    return;
  }

  if (stage === "intro_answered") {
    return;
  }

  if (stage === "awaiting_gender") {
    await appendTranscript(supabase, {
      profileId,
      role: "user",
      body: text,
      questionId: null,
      messageKind: "turn",
    });
    const g = parseGenderFromShortReply(text);
    if (!g) {
      await sendAutomatedToParticipant(
        participantPhoneNormalized,
        "Reply with male or female so I can put you on the right matching track.",
        "automated.clarify_gender"
      );
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: "Reply with male or female so I can put you on the right matching track.",
        questionId: null,
        messageKind: "clarify",
      });
      return;
    }
    const { data: profRows } = await supabase
      .from("onboarding_profiles")
      .select("intro_reply_raw")
      .eq("id", profileId)
      .limit(1);
    const introRaw = String((profRows ?? [])[0]?.intro_reply_raw ?? "").trim();
    await supabase.from("onboarding_profiles").update({ gender: g }).eq("id", profileId);
    await afterIntroSavedContinueToTrackQuestions({
      supabase,
      profileId,
      participantPhoneNormalized,
      gender: g,
      extractionForStorage: introRaw || text,
    });
    return;
  }

  if (stage === "awaiting_intro") {
    const introQuestionText =
      (await loadMostRecentIntroQuestionFromTranscript(supabase, profileId)) ??
      (await pickInitialTrackFirstQuestion({
        supabase,
        seed: profileId || participantPhoneNormalized,
      }));
    const prior = await fetchTranscriptForLlm(supabase, profileId);
    const intro = await runIntroWithFallback({
      firstQuestionText: introQuestionText,
      priorTranscript: prior,
      latestUserMessage: text,
    });
    await appendTranscript(supabase, {
      profileId,
      role: "user",
      body: text,
      questionId: null,
      messageKind: "turn",
    });
    if (!intro.satisfactory) {
      const introClarifyFallback =
        "Quick one — I still need your name, age, and height in a text (where you live is optional).";
      const introClarifyOut = sanitizeAssistantSmsBody(
        intro.clarifyMessage ?? "",
        introClarifyFallback
      );
      await sendAutomatedToParticipant(
        participantPhoneNormalized,
        introClarifyOut,
        "automated.clarify_intro"
      );
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: introClarifyOut,
        questionId: null,
        messageKind: "clarify",
      });
      return;
    }
    if (!intro.profilePatch) {
      await supabase
        .from("onboarding_profiles")
        .update({ intro_reply_raw: text, sms_onboarding_stage: "intro_answered" })
        .eq("id", profileId);
      return;
    }
    {
      const patch = { ...intro.profilePatch };
      let { error: introUpErr } = await supabase.from("onboarding_profiles").update(patch).eq("id", profileId);
      // If DB has not been migrated yet (no city column), retry without location fields.
      if (introUpErr && "city" in patch) {
        const { city: _c, ...withoutLocation } = patch;
        const retry = await supabase.from("onboarding_profiles").update(withoutLocation).eq("id", profileId);
        introUpErr = retry.error;
      }
      if (introUpErr) {
        console.error("sms-onboarding: intro profile update failed", introUpErr.message);
        await sendAutomatedToParticipant(
          participantPhoneNormalized,
          "Small hiccup saving your details—can you resend name, age, height, and where you live in one text?",
          "automated.clarify_intro_save_failed"
        );
        await appendTranscript(supabase, {
          profileId,
          role: "assistant",
          body: "Small hiccup saving your details—can you resend name, age, height, and where you live in one text?",
          questionId: null,
          messageKind: "clarify",
        });
        return;
      }
    }

    const { data: prof2Rows } = await supabase
      .from("onboarding_profiles")
      .select("gender, display_name, age, height, intro_reply_raw")
      .eq("id", profileId)
      .limit(1);
    const prof2 = (prof2Rows ?? [])[0];
    const gender = (prof2?.gender as "MALE" | "FEMALE" | null) ?? null;
    if (!gender) {
      const genderClarify =
        "Got it — last quick thing so I can match you on the right track: are you male or female? (Reply male or female.)";
      await supabase
        .from("onboarding_profiles")
        .update({ sms_onboarding_stage: "awaiting_gender", sms_active_question_id: null })
        .eq("id", profileId);
      await sendAutomatedToParticipant(participantPhoneNormalized, genderClarify, "automated.clarify_gender");
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: genderClarify,
        questionId: null,
        messageKind: "clarify",
      });
      return;
    }

    await afterIntroSavedContinueToTrackQuestions({
      supabase,
      profileId,
      participantPhoneNormalized,
      gender,
      extractionForStorage: intro.extractionForStorage,
    });
    return;
  }

  /** Legacy stage: advance without sending Onairos opt-in/link SMS. */
  if (stage === "awaiting_onairos_opt_in") {
    await appendTranscript(supabase, {
      profileId,
      role: "user",
      body: text,
      questionId: null,
      messageKind: "turn",
    });
    await continueToGenderQuestions({
      supabase,
      profileId,
      participantPhoneNormalized,
    });
    return;
  }

  if (stage === "awaiting_sms_q" && activeQuestionId) {
    const { data: qRow } = await supabase
      .from("questions")
      .select("id, question, sort_order, response_type, gender, min_file_count")
      .eq("id", activeQuestionId)
      .maybeSingle();
    if (!qRow) {
      await supabase
        .from("onboarding_profiles")
        .update({ sms_onboarding_stage: "sms_onboarding_complete", sms_active_question_id: null })
        .eq("id", profileId);
      return;
    }
    const qType = defaultResponseType(qRow.response_type);
    await appendTranscript(supabase, {
      profileId,
      role: "user",
      body: text || (mediaUrls.length > 0 ? stringifyFileAnswer(mediaUrls.map((url) => ({ url }))) : ""),
      questionId: activeQuestionId,
      messageKind: "turn",
    });

    if (isFileLikeResponseType(qType)) {
      const required = minFileCountForQuestion((qRow ?? {}) as QuestionRow);
      const newPart = buildFileAnswerFromInbound(text, mediaUrls);
      const { data: prevAnsRow } = await supabase
        .from("onboarding_answers")
        .select("response_text")
        .eq("profile_id", profileId)
        .eq("question_id", activeQuestionId)
        .maybeSingle();
      const prevAnswerText = prevAnsRow?.response_text ?? null;
      const merged = mergeFileAnswerStrings(prevAnswerText, newPart);
      const got = countFileUrlsInAnswerString(merged);

      if (!merged || got === 0) {
        const clarify =
          required > 1
            ? `Send at least ${required} photo${required === 1 ? "" : "s"} here — you can spread them across a few messages if easier.`
            : "Please send your answer as file upload(s). You can send one or multiple files.";
        await sendAutomatedToParticipant(args.participantPhone, clarify, "automated.clarify_question");
        await appendTranscript(supabase, {
          profileId,
          role: "assistant",
          body: clarify,
          questionId: activeQuestionId,
          messageKind: "clarify",
        });
        return;
      }

      if (got < required) {
        await upsertAnswer(supabase, profileId, activeQuestionId, merged);
        const need = required - got;
        const clarify =
          need === 1
            ? "Got it — send one more photo here when you can."
            : `Got it — send ${need} more photos here when you can (same chat is fine).`;
        await sendAutomatedToParticipant(participantPhoneNormalized, clarify, "automated.clarify_question");
        await appendTranscript(supabase, {
          profileId,
          role: "assistant",
          body: clarify,
          questionId: activeQuestionId,
          messageKind: "clarify",
        });
        return;
      }

      await upsertAnswer(supabase, profileId, activeQuestionId, merged);
    } else {
      const questionText = String(qRow.question ?? "").trim();
      const prior2 = await fetchTranscriptForLlm(supabase, profileId);
      const out = await runTextQuestionWithFallback({
        questionText,
        priorTranscript: prior2,
        latestUserMessage: text,
      });
      if (!out.satisfactory) {
        const qClarifyFallback = "Try that question again in a line or two.";
        const qClarifyOut = sanitizeAssistantSmsBody(out.clarifyMessage ?? "", qClarifyFallback);
        await sendAutomatedToParticipant(
          participantPhoneNormalized,
          qClarifyOut,
          "automated.clarify_question"
        );
        await appendTranscript(supabase, {
          profileId,
          role: "assistant",
          body: qClarifyOut,
          questionId: activeQuestionId,
          messageKind: "clarify",
        });
        return;
      }
      await upsertAnswer(supabase, profileId, activeQuestionId, (out.answerText ?? text).trim());
    }

    const g = (await supabase.from("onboarding_profiles").select("gender").eq("id", profileId).single())
      .data?.gender as "MALE" | "FEMALE" | null;
    if (!g) {
      await supabase
        .from("onboarding_profiles")
        .update({ sms_onboarding_stage: "intro_answered", sms_active_question_id: null })
        .eq("id", profileId);
      return;
    }
    const allQs = await loadQuestionsForGender(supabase, g);
    const idx = allQs.findIndex((q) => q.id === activeQuestionId);
    if (idx < 0) {
      await supabase
        .from("onboarding_profiles")
        .update({ sms_onboarding_stage: "sms_onboarding_complete", sms_active_question_id: null })
        .eq("id", profileId);
      return;
    }
    // Skip photo questions if user has opted out of photos
    let nextQCandidate = allQs[idx + 1] ?? null;
    if (nextQCandidate && photosSkipped && isFileLikeResponseType(nextQCandidate.response_type)) {
      nextQCandidate = allQs[idx + 2] ?? null;
    }
    const nextQ = nextQCandidate;
    if (!nextQ) {
      await supabase
        .from("onboarding_profiles")
        .update({ sms_onboarding_stage: "sms_onboarding_complete", sms_active_question_id: null })
        .eq("id", profileId);
      try {
        await sendAutomatedToParticipant(
          participantPhoneNormalized,
          OPEN_ENDED_CONTINUATION_MESSAGE,
          "automated.sms_onboarding_done"
        );
        await appendTranscript(supabase, {
          profileId,
          role: "assistant",
          body: OPEN_ENDED_CONTINUATION_MESSAGE,
          questionId: null,
          messageKind: "system",
        });
      } catch (e) {
        console.error("sms-onboarding: done message failed", e);
      }
      return;
    }
    await supabase
      .from("onboarding_profiles")
      .update({ sms_onboarding_stage: "awaiting_sms_q", sms_active_question_id: nextQ.id })
      .eq("id", profileId);
    const q2 = nextQ.question.trim();
    const transcriptWithAnswer = await fetchTranscriptForLlm(supabase, profileId);
    const q2Styled = await generateAgentQuestionText({
      adminQuestion: q2,
      adminQuestions: allQs.map((q) => q.question.trim()).filter(Boolean),
      profileGender: g,
      transcript: transcriptWithAnswer,
      isFinalQuestion: idx + 1 === allQs.length - 1,
      isMediaQuestion: isFileLikeResponseType(nextQ.response_type),
      minFileCount: isFileLikeResponseType(nextQ.response_type) ? minFileCountForQuestion(nextQ) : undefined,
    });
    try {
      await sendAutomatedToParticipant(args.participantPhone, q2Styled, "automated.next_question");
      await appendTranscript(supabase, {
        profileId,
        role: "assistant",
        body: q2Styled,
        questionId: nextQ.id,
        messageKind: "question",
      });
    } catch (e) {
      console.error("sms-onboarding: send next question failed", e);
    }
  }
}
