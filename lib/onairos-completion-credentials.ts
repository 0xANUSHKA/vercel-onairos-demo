/**
 * Read apiUrl + bearer token from a stored Onairos completion payload (SMS connect or landing join).
 * Mirrors the shape expected by process-onairos-traits cron.
 */
function findFirstStringByKeys(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 5 || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = findFirstStringByKeys(nested, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function extractOnairosApiCredentialsFromCompletion(
  completion: unknown
): { apiUrl: string; token: string } | null {
  const apiUrl = findFirstStringByKeys(completion, ["apiUrl", "apiURL", "url", "endpoint"]) ?? "";
  const token = findFirstStringByKeys(completion, ["token", "authToken", "accessToken"]) ?? "";
  if (!apiUrl || !token) return null;
  return { apiUrl, token };
}

/** True when waitlist already has stored traits or a completion payload the traits job can call. */
export function waitlistRowHasConnectedOnairos(args: {
  onairosCompletion: unknown;
  onairosTraits: unknown;
}): boolean {
  const traits = args.onairosTraits;
  if (traits != null && typeof traits === "object" && !Array.isArray(traits)) {
    if (Object.keys(traits as Record<string, unknown>).length > 0) return true;
  }
  return extractOnairosApiCredentialsFromCompletion(args.onairosCompletion) != null;
}
