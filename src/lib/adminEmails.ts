function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const ADMIN_EMAILS = Array.from(new Set(
  parseEmailList(process.env.ADMIN_EMAILS)
));

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
