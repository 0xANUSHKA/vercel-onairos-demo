import { DEFAULT_SMS_PROVIDER, type SmsProvider } from "@/lib/sms-defaults";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type { SmsProvider } from "@/lib/sms-defaults";
export { DEFAULT_SMS_PROVIDER } from "@/lib/sms-defaults";

export type SmsDirection = "inbound" | "outbound";

type UpsertConversationArgs = {
  participantPhoneE164: string;
  telnyxPhoneE164: string;
  provider: SmsProvider;
  lastMessageAt?: string;
};

type InsertMessageArgs = {
  conversationId: string;
  providerMessageId?: string | null;
  direction: SmsDirection;
  fromPhoneE164: string;
  toPhoneE164: string;
  body: string;
  eventType?: string | null;
  status?: string | null;
  rawPayload?: unknown;
  createdAt?: string;
  provider?: SmsProvider;
};

export async function upsertSmsConversation(args: UpsertConversationArgs): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sms_conversations")
    .upsert(
      {
        participant_phone_e164: args.participantPhoneE164,
        telnyx_phone_e164: args.telnyxPhoneE164,
        provider: args.provider,
        last_message_at: args.lastMessageAt ?? new Date().toISOString(),
      },
      { onConflict: "provider,participant_phone_e164" }
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Failed to upsert SMS conversation.");
  }

  return String(data.id);
}

export async function insertSmsMessage(args: InsertMessageArgs): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("sms_messages").upsert(
    {
      conversation_id: args.conversationId,
      provider_message_id: args.providerMessageId ?? null,
      direction: args.direction,
      from_phone_e164: args.fromPhoneE164,
      to_phone_e164: args.toPhoneE164,
      body: args.body,
      event_type: args.eventType ?? null,
      status: args.status ?? null,
      provider: args.provider ?? DEFAULT_SMS_PROVIDER,
      raw_payload: args.rawPayload ?? null,
      created_at: args.createdAt ?? new Date().toISOString(),
    },
    { onConflict: "provider_message_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}
