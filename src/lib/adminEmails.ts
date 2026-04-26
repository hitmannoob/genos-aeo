const FALLBACK_ADMIN_EMAILS = [
  'admin@example.com',
  'developer@example.com',
  'team@getaimonitor.com',
  'write2avinash007@gmail.com',
];

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const ADMIN_EMAILS = Array.from(new Set([
  ...parseEmailList(process.env.ADMIN_EMAILS),
  ...parseEmailList(process.env.NEXT_PUBLIC_ADMIN_EMAILS),
  ...FALLBACK_ADMIN_EMAILS.map((email) => email.toLowerCase()),
]));

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
