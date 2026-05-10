/** Shared E.164-ish normalization for waitlist `value`, SMS webhooks, and ban lookups. */

export function normalizePhoneForStorage(phone: string): string {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return raw;
}

export function phoneLookupCandidates(phone: string): string[] {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = normalizePhoneForStorage(raw);
  const out = new Set<string>();

  if (raw) out.add(raw);
  if (digits) out.add(digits);
  if (normalized) out.add(normalized);

  if (digits.length === 10) {
    out.add(`1${digits}`);
    out.add(`+1${digits}`);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    out.add(digits.slice(1));
    out.add(`+${digits}`);
  }
  if (normalized.startsWith("+1") && normalized.length === 12) {
    out.add(normalized.slice(2));
  }

  return [...out];
}
