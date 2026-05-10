import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { sendOutboundSms } from "@/lib/sms-send-outbound";
import { missingSupabaseAdminEnv } from "@/lib/supabase-admin";
import { DEFAULT_SMS_PROVIDER, type SmsProvider } from "@/lib/sms-defaults";
import { insertSmsMessage, upsertSmsConversation } from "@/lib/sms-store";
import { resolveLinqFromNumber } from "@/lib/linq-numbers";

export const dynamic = "force-dynamic";

const US_E164_REGEX = /^\+1\d{10}$/;

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function missingTelnyxEnv() {
  const missing: string[] = [];
  if (!process.env.TELNYX_API_KEY?.trim()) missing.push("TELNYX_API_KEY");
  if (!process.env.TELNYX_FROM_NUMBER?.trim()) missing.push("TELNYX_FROM_NUMBER");
  return missing;
}

function missingLinqEnv() {
  const missing: string[] = [];
  if (!process.env.LINQ_API_TOKEN?.trim()) missing.push("LINQ_API_TOKEN");
  if (!process.env.LINQ_FROM_NUMBER?.trim()) missing.push("LINQ_FROM_NUMBER");
  if (!process.env.LINQ_SEND_URL?.trim()) missing.push("LINQ_SEND_URL");
  return missing;
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminApiRequest(req);
    if (!auth.ok) return auth.response;

    const rawBody = (await req.json()) as {
      to?: unknown;
      message?: unknown;
      provider?: unknown;
    };

    const provider = String(rawBody.provider ?? DEFAULT_SMS_PROVIDER).trim().toLowerCase() as SmsProvider;
    if (provider !== "telnyx" && provider !== "linq") {
      return NextResponse.json({ error: "Provider must be telnyx or linq." }, { status: 400 });
    }

    const missingEnv = provider === "linq" ? missingLinqEnv() : missingTelnyxEnv();
    if (missingEnv.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingEnv.join(", ")}` },
        { status: 503 }
      );
    }
    const missingSupabaseEnv = missingSupabaseAdminEnv();
    if (missingSupabaseEnv.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missingSupabaseEnv.join(", ")}` },
        { status: 503 }
      );
    }

    const to = String(rawBody.to ?? "").trim();
    const message = String(rawBody.message ?? "").trim();

    if (!US_E164_REGEX.test(to)) {
      return NextResponse.json(
        { error: "Destination must be a US number in E.164 format (e.g. +14155550123)." },
        { status: 400 }
      );
    }
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ error: "Message must be 500 characters or fewer." }, { status: 400 });
    }

    let linqFrom: string | undefined;
    if (provider === "linq") {
      linqFrom = await resolveLinqFromNumber(to).catch(() => undefined);
    }

    let sent;
    try {
      sent = await sendOutboundSms(provider, to, message, linqFrom);
    } catch (e) {
      if (provider === "linq") {
        const msg = e instanceof Error ? e.message : "Unknown error";
        throw new HttpError(msg, 502);
      }
      throw e;
    }
    const resolvedFrom = sent.from;
    const resolvedTo = sent.to;
    const providerMessageId = sent.id;

    const conversationId = await upsertSmsConversation({
      participantPhoneE164: resolvedTo,
      telnyxPhoneE164: resolvedFrom,
      provider,
    });
    await insertSmsMessage({
      conversationId,
      providerMessageId,
      direction: "outbound",
      fromPhoneE164: resolvedFrom,
      toPhoneE164: resolvedTo,
      body: message,
      eventType: "message.sent",
      status: "queued",
      provider,
      rawPayload: sent.raw,
    });

    return NextResponse.json({
      id: providerMessageId,
      chat_id: sent.chatId ?? null,
      from: resolvedFrom,
      to: resolvedTo,
      provider,
      conversation_id: conversationId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
