/** True when `phoneE164` is NANP (+1 plus exactly 10 digits). SMS bot is restricted to this during beta. */
export function isNanpE164(phoneE164: string): boolean {
  const t = phoneE164.trim();
  return /^\+1\d{10}$/.test(t);
}

/** Safe length for a single SMS segment. */
export const SMS_CHAR_SOFT_LIMIT = 300;

export function truncateSmsText(s: string, max = SMS_CHAR_SOFT_LIMIT): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * True when text reads like asking the user to link social/video accounts for matching (we do not send these over SMS).
 */
export function smsLooksLikeSocialAccountConnectAsk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\bonairos\b/.test(t)) return true;
  const platform = /\b(tiktok|youtube|instagram|snapchat|facebook)\b/.test(t);
  const connectCue =
    /\b(connect|link your|link up|authorize|log\s*in|sign\s*in)\b/.test(t) ||
    /\b(better read on your taste|match you smarter)\b/.test(t) ||
    /\bsay\s+yes\s+or\s+skip\b/.test(t) ||
    (/want to connect\b/.test(t) && platform);
  return platform && connectCue;
}

/** Generic track question when the model or admin text would have pushed social account linking. */
export const SMS_SOCIAL_CONNECT_FALLBACK_QUESTION =
  "What kind of energy are you drawn to in someone right now—not just looks, but the whole vibe?";

/** Use for outbound clarify lines so we never ship social-link prompts from the model. */
export function sanitizeAssistantSmsBody(text: string, fallback: string): string {
  const t = text.trim();
  if (!t || smsLooksLikeSocialAccountConnectAsk(t)) return fallback;
  return truncateSmsText(t);
}
