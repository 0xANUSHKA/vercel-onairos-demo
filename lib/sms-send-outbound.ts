import type { SmsProvider } from "@/lib/sms-defaults";

export type OutboundSendResult = {
  provider: SmsProvider;
  id: string | null;
  chatId: string | null;
  from: string;
  to: string;
  raw: unknown;
};

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

export function assertCanSend(provider: SmsProvider): void {
  const missing = provider === "linq" ? missingLinqEnv() : missingTelnyxEnv();
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }
}

async function sendViaTelnyx(to: string, message: string): Promise<OutboundSendResult> {
  const from = process.env.TELNYX_FROM_NUMBER!.trim();
  const apiKey = process.env.TELNYX_API_KEY!.trim();
  const telnyxResponse = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, text: message }),
    cache: "no-store",
  });
  const telnyxPayload = (await telnyxResponse.json()) as {
    data?: { id?: string; from?: { phone_number?: string }; to?: Array<{ phone_number?: string }> };
    errors?: Array<{ detail?: string }>;
  };
  if (!telnyxResponse.ok) {
    const reason =
      telnyxPayload.errors?.[0]?.detail ?? `Telnyx request failed with status ${telnyxResponse.status}.`;
    throw new Error(reason);
  }
  return {
    provider: "telnyx",
    id: telnyxPayload.data?.id ?? null,
    chatId: null,
    from: telnyxPayload.data?.from?.phone_number ?? from,
    to: telnyxPayload.data?.to?.[0]?.phone_number ?? to,
    raw: telnyxPayload,
  };
}

async function sendViaLinq(to: string, message: string, from?: string): Promise<OutboundSendResult> {
  const resolvedFrom = from ?? process.env.LINQ_FROM_NUMBER!.trim();
  const token = process.env.LINQ_API_TOKEN!.trim();
  const sendUrl = process.env.LINQ_SEND_URL!.trim();
  const linqResponse = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resolvedFrom,
      to: [to],
      message: {
        parts: [{ type: "text", value: message }],
      },
    }),
    cache: "no-store",
  });
  const rawText = await linqResponse.text();
  let linqPayload: unknown = rawText;
  try {
    linqPayload = JSON.parse(rawText);
  } catch {
    // keep raw
  }
  if (!linqResponse.ok) {
    const payload = (typeof linqPayload === "object" && linqPayload !== null ? linqPayload : {}) as {
      error?: { message?: string; code?: string | number };
      message?: string;
      trace_id?: string;
      detail?: string;
    };
    const apiMessage =
      payload.error?.message ??
      payload.message ??
      payload.detail ??
      `Linq request failed with status ${linqResponse.status}.`;
    const code = payload.error?.code != null ? ` code=${String(payload.error.code)}` : "";
    const traceId = payload.trace_id ? ` trace_id=${payload.trace_id}` : "";
    throw new Error(`Linq send failed (${linqResponse.status}): ${apiMessage}${code}${traceId}`);
  }
  const payload = (typeof linqPayload === "object" && linqPayload !== null ? linqPayload : {}) as {
    id?: string;
    chat_id?: string;
    message_id?: string;
    data?: {
      id?: string;
      chat_id?: string;
      message_id?: string;
      message?: { id?: string };
      chat?: { id?: string; message?: { id?: string } };
      messages?: Array<{ id?: string }>;
    };
    message?: { id?: string };
    chat?: { id?: string; message?: { id?: string } };
    messages?: Array<{ id?: string }>;
  };
  const resolvedMessageId =
    payload.chat?.message?.id ??
    payload.data?.chat?.message?.id ??
    payload.message_id ??
    payload.data?.message_id ??
    payload.message?.id ??
    payload.data?.message?.id ??
    payload.messages?.[0]?.id ??
    payload.data?.messages?.[0]?.id ??
    payload.id ??
    payload.data?.id ??
    null;
  const resolvedChatId =
    payload.chat_id ??
    payload.data?.chat_id ??
    payload.chat?.id ??
    payload.data?.chat?.id ??
    null;
  return {
    provider: "linq",
    id: resolvedMessageId ?? resolvedChatId,
    chatId: resolvedChatId,
    from: resolvedFrom,
    to,
    raw: linqPayload,
  };
}

/** Sends one outbound SMS/MMS text via Telnyx or Linq (same behavior as admin test route). */
export async function sendOutboundSms(
  provider: SmsProvider,
  to: string,
  message: string,
  from?: string,
): Promise<OutboundSendResult> {
  assertCanSend(provider);
  return provider === "linq" ? sendViaLinq(to, message, from) : sendViaTelnyx(to, message);
}
