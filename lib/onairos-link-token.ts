import { createHmac, timingSafeEqual } from "crypto";

export type OnairosLinkPayload = {
  waitlistId: string;
  profileId: string;
  participantPhone: string;
};

function tokenSecret(): string {
  return process.env.ONAIROS_LINK_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "inyo-onairos-link";
}

function signPayload(rawPayload: string): string {
  return createHmac("sha256", tokenSecret()).update(rawPayload).digest("hex").slice(0, 24);
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function buildOnairosLinkToken(payload: OnairosLinkPayload): string {
  const rawPayload = `${payload.waitlistId}.${payload.profileId}.${payload.participantPhone}`;
  const sig = signPayload(rawPayload);
  return Buffer.from(`${rawPayload}.${sig}`, "utf8").toString("base64url");
}

export function parseOnairosLinkToken(token: string): OnairosLinkPayload | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(trimmed, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length < 4) return null;
  const signature = parts[parts.length - 1] ?? "";
  const participantPhone = parts[parts.length - 2] ?? "";
  const profileId = parts[parts.length - 3] ?? "";
  const waitlistId = parts.slice(0, parts.length - 3).join(".");
  if (!waitlistId || !profileId || !participantPhone || !signature) return null;
  const rawPayload = `${waitlistId}.${profileId}.${participantPhone}`;
  const expectedSig = signPayload(rawPayload);
  if (!safeEqual(signature, expectedSig)) return null;
  return {
    waitlistId,
    profileId,
    participantPhone,
  };
}
