import { describe, expect, it } from 'vitest';
import { buildCsv, encodeCsvCell, safeDownloadStem } from '@/lib/csv';

describe('CSV export safety', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("x")']) (
    'neutralizes spreadsheet formula input %s',
    (value) => expect(encodeCsvCell(value)).toMatch(/^"'/)
  );

  it('quotes delimiters, quotes, and line breaks', () => {
    expect(buildCsv([['a,b', 'say "hi"'], ['line\nbreak', null]])).toBe(
      '"a,b","say ""hi"""\r\n"line\nbreak",""'
    );
  });

  it('produces a bounded safe filename stem', () => {
    expect(safeDownloadStem('../../Quarter 1: citations')).toBe('..-..-Quarter-1-citations');
    expect(safeDownloadStem('🚀')).toBe('export');
  });
});
