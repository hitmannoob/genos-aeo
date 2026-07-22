const SPREADSHEET_FORMULA_PREFIX = /^[\s]*[=+\-@]/;

/**
 * Encode an untrusted value as one CSV cell.
 *
 * Leading spreadsheet formula characters are prefixed with an apostrophe so
 * exported provider/user content cannot execute when opened in Excel or
 * another spreadsheet application.
 */
export function encodeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (SPREADSHEET_FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(encodeCsvCell).join(',')).join('\r\n');
}

export function safeDownloadStem(value: string, fallback = 'export'): string {
  const stem = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return stem || fallback;
}
