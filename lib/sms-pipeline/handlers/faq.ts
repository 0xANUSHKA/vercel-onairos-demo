import { sendAutomatedSms } from "@/lib/sms-pipeline/send-automated";

type FaqEntry = {
  patterns: RegExp[];
  reply: string;
};

const FAQ_TABLE: FaqEntry[] = [
  {
    patterns: [/\bwhat is inyo\b/i, /\bhow does (this|inyo) work\b/i, /\bwhat do you do\b/i],
    reply:
      "inyo is a real human matchmaking service. we get to know you, then personally introduce you to someone we think you'd connect with. no swiping, no algorithms.",
  },
  {
    patterns: [/\bis this (real|legit|a scam)\b/i, /\bare you (real|a bot|human|an ai|ai)\b/i, /\bwho is this\b/i],
    reply:
      "yes, this is real. inyo is run by real people. we read your answers ourselves and make introductions based on what we learn about you.",
  },
  {
    patterns: [/\bhow much\b/i, /\bis (this|it) free\b/i, /\bcost\b/i, /\bprice\b/i, /\bpay\b/i],
    reply:
      "inyo is free during our beta. we'll always let you know before anything changes.",
  },
  {
    patterns: [/\bprivacy\b/i, /\bdata\b/i, /\bwhat do you do with my (info|information|number|phone)\b/i],
    reply:
      "we take privacy seriously. your info is only used to find you a match and is never sold or shared with third parties.",
  },
  {
    patterns: [/\bsafe\b/i, /\bsafety\b/i, /\blegit\b/i],
    reply:
      "your safety matters to us. all matches are vetted by our team before we make any introduction. if anything ever feels off, just let us know.",
  },
  {
    patterns: [/\bhow long\b/i, /\bwhen will (i|we) (get|have) a match\b/i, /\bhow long does it take\b/i],
    reply:
      "it depends on who's in the pool at the time. some people hear back in a few days, others a couple weeks. we only reach out when we have someone we genuinely think is right for you.",
  },
  {
    patterns: [/\bnyc\b/i, /\bnew york\b/i, /\bwhere (is inyo|do you operate|are you)\b/i, /\bwhat cities\b/i],
    reply:
      "we're based in new york city and currently only operating in nyc. we're building toward other cities.",
  },
];

const FALLBACK_REPLY =
  "great question. feel free to keep going with the onboarding and we'll follow up on anything you need.";

export async function handleFaq(phone: string, text: string): Promise<void> {
  const lower = text.toLowerCase();

  for (const entry of FAQ_TABLE) {
    if (entry.patterns.some((p) => p.test(lower))) {
      await sendAutomatedSms(phone, entry.reply, "faq_reply");
      return;
    }
  }

  await sendAutomatedSms(phone, FALLBACK_REPLY, "faq_fallback");
}
