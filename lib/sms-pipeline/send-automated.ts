import { DEFAULT_SMS_PROVIDER, type SmsProvider } from "@/lib/sms-defaults";
import { sendOutboundSms } from "@/lib/sms-send-outbound";
import { insertSmsMessage, upsertSmsConversation } from "@/lib/sms-store";
import { truncateSmsText } from "@/lib/sms-onboarding-helpers";
import { applyToneLinter } from "@/lib/sms-pipeline/tone-linter";
import { resolveLinqFromNumber } from "@/lib/linq-numbers";

async function resolveOutboundFrom(provider: SmsProvider, participantPhone: string): Promise<string | null> {
  if (provider === "linq") {
    try {
      return await resolveLinqFromNumber(participantPhone);
    } catch {
      return process.env.LINQ_FROM_NUMBER?.trim() || null;
    }
  }
  return process.env.TELNYX_FROM_NUMBER?.trim() || null;
}

async function persistOutbound(args: {
  conversationId: string;
  provider: SmsProvider;
  body: string;
  sent: Awaited<ReturnType<typeof sendOutboundSms>>;
  eventType: string;
}) {
  const syntheticId =
    args.sent.id ?? `automated:${args.provider}:${args.conversationId}:${Date.now()}`;
  await insertSmsMessage({
    conversationId: args.conversationId,
    providerMessageId: syntheticId,
    direction: "outbound",
    fromPhoneE164: args.sent.from,
    toPhoneE164: args.sent.to,
    body: args.body,
    eventType: args.eventType,
    status: "queued",
    provider: args.provider,
    rawPayload: args.sent.raw,
  });
}

/**
 * Sends an automated SMS to a participant.
 * Runs the tone linter on the text before sending.
 * Never throws — logs and returns on provider misconfiguration.
 */
export async function sendAutomatedSms(
  participantPhone: string,
  text: string,
  eventType: string,
): Promise<void> {
  const provider = DEFAULT_SMS_PROVIDER;
  const fromE164 = await resolveOutboundFrom(provider, participantPhone);
  if (!fromE164) {
    console.error("[send-automated] missing outbound from number for provider:", provider);
    return;
  }

  const linted = await applyToneLinter(text);
  const body = truncateSmsText(linted);

  const conversationId = await upsertSmsConversation({
    participantPhoneE164: participantPhone,
    telnyxPhoneE164: fromE164,
    provider,
  });

  const sent = await sendOutboundSms(provider, participantPhone, body, fromE164);

  await persistOutbound({ conversationId, provider, body, sent, eventType });
}
