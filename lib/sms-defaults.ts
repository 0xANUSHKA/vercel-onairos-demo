export type SmsProvider = "telnyx" | "linq";

/** Primary SMS rail for Inyo: admin UI, API defaults, and DB row fallback when provider is unset. */
export const DEFAULT_SMS_PROVIDER: SmsProvider = "linq";
