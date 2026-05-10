import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { routeSmsInbound } from "@/lib/sms-pipeline/router";
import { insertSmsMessage, upsertSmsConversation } from "@/lib/sms-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function base64ToBytes(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function normalizePublicKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`;
}

function isRecentTimestamp(unixTimestamp: string): boolean {
  const ts = Number(unixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - ts) <= 300;
}

function verifyTelnyxSignature(payload: string, signature: string, timestamp: string): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error("Missing TELNYX_PUBLIC_KEY.");
  }
  if (!isRecentTimestamp(timestamp)) return false;

  const signingPayload = Buffer.from(`${timestamp}|${payload}`, "utf8");
  const signatureBytes = base64ToBytes(signature);
  const key = createPublicKey(normalizePublicKey(publicKey));

  return verify(null, signingPayload, key, signatureBytes);
}

type TelnyxEvent = {
  data?: {
    event_type?: string;
    occurred_at?: string;
    payload?: {
      id?: string;
      text?: string;
      media?: Array<{ url?: string; content_type?: string }>;
      from?: { phone_number?: string };
      to?: Array<{ phone_number?: string; status?: string }>;
    };
  };
};

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseAdminEnv();
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 503 }
      );
    }

    const signature = req.headers.get("telnyx-signature-ed25519") ?? "";
    const timestamp = req.headers.get("telnyx-timestamp") ?? "";
    if (!signature || !timestamp) {
      return NextResponse.json({ error: "Missing Telnyx signature headers." }, { status: 400 });
    }

    const rawBody = await req.text();
    if (!verifyTelnyxSignature(rawBody, signature, timestamp)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 403 });
    }

    const event = JSON.parse(rawBody) as TelnyxEvent;
    const eventType = event.data?.event_type ?? "";
    const payload = event.data?.payload;
    const providerMessageId = payload?.id ?? null;
    const text = String(payload?.text ?? "").trim();
    const mediaUrls = (payload?.media ?? [])
      .map((m) => String(m?.url ?? "").trim())
      .filter((url) => /^https?:\/\//i.test(url));
    const from = payload?.from?.phone_number ?? "";
    const to = payload?.to?.[0]?.phone_number ?? "";
    const status = payload?.to?.[0]?.status ?? null;
    const occurredAt = event.data?.occurred_at ?? new Date().toISOString();

    if (!from || !to || !providerMessageId) {
      return NextResponse.json({ ok: true, ignored: "Missing phone or message ids." });
    }

    const isInbound = eventType === "message.received";
    const participantPhone = isInbound ? from : to;
    const telnyxPhone = isInbound ? to : from;

    const conversationId = await upsertSmsConversation({
      participantPhoneE164: participantPhone,
      telnyxPhoneE164: telnyxPhone,
      provider: "telnyx",
      lastMessageAt: occurredAt,
    });

    // Idempotency guard: do not process the same inbound provider message twice.
    const supabase = getSupabaseAdmin();
    const { data: existingMessages } = await supabase
      .from("sms_messages")
      .select("id")
      .eq("provider_message_id", providerMessageId)
      .limit(1);
    const isDuplicateInbound = Boolean((existingMessages ?? [])[0]?.id) && isInbound;

    await insertSmsMessage({
      conversationId,
      providerMessageId,
      direction: isInbound ? "inbound" : "outbound",
      fromPhoneE164: from,
      toPhoneE164: to,
      body: text,
      eventType,
      status,
      provider: "telnyx",
      rawPayload: event,
      createdAt: occurredAt,
    });

    if (!isDuplicateInbound) {
      try {
        await routeSmsInbound({
          participantPhone,
          inboundText: text,
          inboundMediaUrls: mediaUrls,
          inboundEventType: eventType,
          isInbound,
        });
      } catch (onboardingErr) {
        console.error("Telnyx SMS onboarding:", onboardingErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
