export function getAllowedAdminEmails(): string[] {
  const raw = process.env.ADMIN_ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const allowed = getAllowedAdminEmails();
  return allowed.includes(email.toLowerCase());
}
