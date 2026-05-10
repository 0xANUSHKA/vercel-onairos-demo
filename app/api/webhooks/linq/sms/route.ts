import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { routeSmsInbound } from "@/lib/sms-pipeline/router";
import { insertSmsMessage, upsertSmsConversation } from "@/lib/sms-store";
import { parseConsentIntent, handleConsentReply } from "@/lib/match-consent";
import { checkModeration } from "@/lib/content-moderation";
import { sendLinqChatMessage } from "@/lib/linq-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LinqWebhookLike = {
  event_type?: string;
  type?: string;
  direction?: string;
  id?: string;
  message_id?: string;
  occurred_at?: string;
  created_at?: string;
  timestamp?: string;
  text?: string;
  body?: string;
  parts?: Array<{ type?: string; value?: string; url?: string }>;
  content?: { text?: string; body?: string };
  from?:
    | string
    | { phone_number?: string; number?: string; handle?: string }
    | Array<{ phone_number?: string; number?: string; handle?: string }>;
  to?:
    | string
    | { phone_number?: string; number?: string; handle?: string }
    | Array<{ phone_number?: string; number?: string; handle?: string }>;
  from_handle?: { phone_number?: string; number?: string; handle?: string };
  to_handle?: { phone_number?: string; number?: string; handle?: string };
  sender_handle?: { phone_number?: string; number?: string; handle?: string; is_me?: boolean };
  recipient_handle?: { phone_number?: string; number?: string; handle?: string; is_me?: boolean };
  status?: string;
  delivery_status?: string;
  chat_id?: string;
  event_id?: string;
  event?: string;
  chat?: {
    id?: string;
    owner_handle?: { phone_number?: string; number?: string; handle?: string; is_me?: boolean };
    handles?: Array<{ is_me?: boolean; handle?: string; phone_number?: string }>;
    message?: { id?: string; parts?: Array<{ type?: string; value?: string; url?: string }> };
  };
  data?: {
    event_type?: string;
    type?: string;
    event?: string;
    direction?: string;
    id?: string;
    message_id?: string;
    chat_id?: string;
    event_id?: string;
    text?: string;
    body?: string;
    status?: string;
    occurred_at?: string;
    created_at?: string;
    timestamp?: string;
    payload?: LinqWebhookLike;
    message?: LinqWebhookLike;
    from?: LinqWebhookLike["from"];
    to?: LinqWebhookLike["to"];
    from_handle?: LinqWebhookLike["from_handle"];
    to_handle?: LinqWebhookLike["to_handle"];
    sender_handle?: LinqWebhookLike["sender_handle"];
    recipient_handle?: LinqWebhookLike["recipient_handle"];
    parts?: LinqWebhookLike["parts"];
    chat?: LinqWebhookLike["chat"];
    delivery_status?: string;
  };
  payload?: LinqWebhookLike;
  message?: LinqWebhookLike;
};

function extractPhone(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return extractPhone(value[0]);
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return String(rec.phone_number ?? rec.number ?? rec.handle ?? "").trim();
  }
  return "";
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const values = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (String(p.type ?? "").toLowerCase() !== "text") return "";
      return String(p.value ?? "").trim();
    })
    .filter(Boolean);
  return values.join("\n").trim();
}

function extractMediaUrlsFromParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      if (String(p.type ?? "").toLowerCase() !== "media") return "";
      return String(p.url ?? p.value ?? "").trim();
    })
    .filter((url) => /^https?:\/\//i.test(url));
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next) return next;
  }
  return "";
}

function firstDistinctFrom(fromValue: string, ...values: unknown[]): string {
  const fromNorm = fromValue.trim();
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (!next) continue;
    if (fromNorm && next === fromNorm) continue;
    return next;
  }
  return "";
}

function parseLinqWebhook(event: LinqWebhookLike) {
  const base = event.data ?? {};
  const nested = base.payload ?? base.message ?? event.payload ?? event.message ?? {};
  const eventType = firstNonEmpty(
    base.event_type,
    base.type,
    event.data?.event,
    event.event_type,
    event.type,
    event.event
  );
  const directionRaw = firstNonEmpty(event.data?.direction, event.direction, nested.direction).toLowerCase();
  const isInbound =
    directionRaw === "inbound" ||
    eventType.toLowerCase().includes("inbound") ||
    eventType.toLowerCase().includes("received");

  const chat = base.chat ?? event.chat ?? nested.chat;
  const handles = Array.isArray(chat?.handles) ? chat.handles : [];
  const meHandle = handles.find((h) => h?.is_me === true);
  const otherHandle = handles.find((h) => h?.is_me === false);

  const providerMessageId = firstNonEmpty(
    base.id,
    base.message_id,
    base.event_id,
    base.chat?.message?.id,
    event.data?.id,
    event.data?.message_id,
    event.data?.event_id,
    event.id,
    event.message_id,
    event.event_id,
    event.data?.chat_id,
    event.chat_id,
    nested.id,
    nested.message_id,
    nested.event_id,
    nested.chat_id
  );
  const text = firstNonEmpty(
    base.text,
    base.body,
    extractTextFromParts(base.parts),
    extractTextFromParts(base.chat?.message?.parts),
    event.text,
    event.body,
    event.content?.text,
    event.content?.body,
    extractTextFromParts(event.parts),
    extractTextFromParts(event.chat?.message?.parts),
    nested.text,
    nested.body,
    nested.content?.text,
    nested.content?.body,
    extractTextFromParts(nested.parts),
    extractTextFromParts(nested.chat?.message?.parts)
  );
  const mediaUrls = [
    ...extractMediaUrlsFromParts(base.parts),
    ...extractMediaUrlsFromParts(base.chat?.message?.parts),
    ...extractMediaUrlsFromParts(event.parts),
    ...extractMediaUrlsFromParts(event.chat?.message?.parts),
    ...extractMediaUrlsFromParts(nested.parts),
    ...extractMediaUrlsFromParts(nested.chat?.message?.parts),
  ];
  const from = firstNonEmpty(
    extractPhone(base.from),
    extractPhone(base.from_handle),
    extractPhone(base.sender_handle),
    extractPhone(event.from),
    extractPhone(event.from_handle),
    extractPhone(event.sender_handle),
    extractPhone(nested.from),
    extractPhone(nested.from_handle),
    extractPhone(nested.sender_handle),
    isInbound ? extractPhone(otherHandle) : extractPhone(meHandle),
    extractPhone(base.chat?.owner_handle),
    extractPhone(event.chat?.owner_handle),
    extractPhone(nested.chat?.owner_handle)
  );
  const to = firstDistinctFrom(
    from,
    extractPhone(base.to),
    extractPhone(base.to_handle),
    extractPhone(base.recipient_handle),
    extractPhone(event.to),
    extractPhone(event.to_handle),
    extractPhone(event.recipient_handle),
    extractPhone(nested.to),
    extractPhone(nested.to_handle),
    extractPhone(nested.recipient_handle),
    isInbound ? extractPhone(meHandle) : extractPhone(otherHandle),
    extractPhone(base.chat?.owner_handle),
    extractPhone(event.chat?.owner_handle),
    extractPhone(nested.chat?.owner_handle)
  );
  const chatId = firstNonEmpty(
    base.chat_id,
    base.chat?.id,
    event.chat_id,
    event.chat?.id,
    nested.chat_id,
    nested.chat?.id
  ) || null;
  const status = firstNonEmpty(base.delivery_status, base.status, event.status, nested.status) || null;
  const occurredAt = firstNonEmpty(
    base.occurred_at,
    base.created_at,
    base.timestamp,
    event.data?.occurred_at,
    event.data?.created_at,
    event.data?.timestamp,
    event.occurred_at,
    event.created_at,
    event.timestamp,
    nested.occurred_at,
    nested.created_at,
    nested.timestamp
  );

  return {
    eventType: eventType || "message.event",
    isInbound,
    providerMessageId: providerMessageId || null,
    text,
    mediaUrls,
    from,
    to,
    chatId,
    status,
    occurredAt: occurredAt || new Date().toISOString(),
  };
}

function isRecentTimestamp(unixTimestamp: string): boolean {
  const ts = Number(unixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - ts) <= 300;
}

function verifyLinqSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const signingSecret = process.env.LINQ_WEBHOOK_SECRET?.trim();
  if (!signingSecret) return false;
  if (!isRecentTimestamp(timestamp)) return false;

  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signature.trim(), "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseAdminEnv();
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 503 }
      );
    }
    const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
    const signature = req.headers.get("x-webhook-signature") ?? "";
    if (!process.env.LINQ_WEBHOOK_SECRET?.trim()) {
      return NextResponse.json(
        { error: "Server misconfigured: missing LINQ_WEBHOOK_SECRET." },
        { status: 503 }
      );
    }
    if (!timestamp || !signature) {
      return NextResponse.json({ error: "Missing Linq signature headers." }, { status: 400 });
    }

    const rawBody = await req.text();
    if (!verifyLinqSignature(rawBody, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 403 });
    }

    let event: LinqWebhookLike;
    try {
      event = JSON.parse(rawBody) as LinqWebhookLike;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }
    const parsed = parseLinqWebhook(event);

    if (!parsed.from || !parsed.to) {
      return NextResponse.json({ ok: true, ignored: "Missing phone ids." });
    }

    const participantPhone = parsed.isInbound ? parsed.from : parsed.to;
    const providerPhone = parsed.isInbound ? parsed.to : parsed.from;

    const conversationId = await upsertSmsConversation({
      participantPhoneE164: participantPhone,
      telnyxPhoneE164: providerPhone,
      provider: "linq",
      lastMessageAt: parsed.occurredAt,
    });

    const fallbackMessageId = parsed.providerMessageId
      ? parsed.providerMessageId
      : `linq:${parsed.eventType}:${parsed.occurredAt}:${parsed.from}:${parsed.to}:${parsed.text.slice(0, 64)}`;

    // Idempotency guard: do not process the same inbound provider message twice.
    const supabase = getSupabaseAdmin();
    const { data: existingMessages } = await supabase
      .from("sms_messages")
      .select("id")
      .eq("provider_message_id", fallbackMessageId)
      .limit(1);
    const isDuplicateInbound = Boolean((existingMessages ?? [])[0]?.id) && parsed.isInbound;

    await insertSmsMessage({
      conversationId,
      providerMessageId: fallbackMessageId,
      direction: parsed.isInbound ? "inbound" : "outbound",
      fromPhoneE164: parsed.from,
      toPhoneE164: parsed.to,
      body: parsed.text,
      eventType: parsed.eventType,
      status: parsed.status,
      provider: "linq",
      rawPayload: event,
      createdAt: parsed.occurredAt,
    });

    if (!isDuplicateInbound) {
      // Consent replies take priority — if this chat belongs to a match invite,
      // skip the generic onboarding handler entirely.
      let handledByConsent = false;
      if (parsed.isInbound && parsed.chatId) {
        try {
          const intent = parseConsentIntent(parsed.text);
          handledByConsent = await handleConsentReply(parsed.chatId, intent, parsed.text);
        } catch (consentErr) {
          console.error("Linq SMS consent handling:", consentErr);
        }
        // Stamp last_inbound_at so the admin panel can show an unread indicator.
        if (handledByConsent) {
          Promise.resolve(
            supabase
              .from("proposed_matches")
              .update({ last_inbound_at: new Date().toISOString() })
              .or(`user_a_invite_chat_id.eq.${parsed.chatId},user_b_invite_chat_id.eq.${parsed.chatId}`),
          ).catch(() => null);
        }
      }

      if (!handledByConsent && parsed.isInbound && parsed.chatId) {
        const { data: gcRow } = await supabase
          .from("proposed_matches")
          .select("id")
          .eq("linq_chat_id", parsed.chatId)
          .limit(1);
        if (gcRow?.[0]) {
          // Stamp last_inbound_at for the group chat match.
          Promise.resolve(
            supabase
              .from("proposed_matches")
              .update({ last_inbound_at: new Date().toISOString() })
              .eq("id", gcRow[0].id),
          ).catch(() => null);

          // Message is from an introduced group chat — run moderation, then stop
          if (parsed.text) {
            const mod = await checkModeration(parsed.text, { allowCategories: ["sexual"] });
            if (mod.flagged) {
              console.warn("[group-chat-moderation] flagged message", {
                chatId: parsed.chatId,
                categories: mod.categories,
                matchId: gcRow[0].id,
              });
              await sendLinqChatMessage(parsed.chatId, [
                {
                  type: "text",
                  value:
                    "hey — just a reminder to keep things kind and respectful. this is a safe space for both of you. - inyo",
                },
              ]).catch(() => null);
            }
          }
          return NextResponse.json({ ok: true, ignored: "group_chat_message" });
        }
      }

      if (!handledByConsent) {
        try {
          await routeSmsInbound({
            participantPhone,
            inboundText: parsed.text,
            inboundMediaUrls: parsed.mediaUrls,
            inboundEventType: parsed.eventType,
            isInbound: parsed.isInbound,
          });
        } catch (onboardingErr) {
          console.error("Linq SMS onboarding:", onboardingErr);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Linq webhook processing failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
