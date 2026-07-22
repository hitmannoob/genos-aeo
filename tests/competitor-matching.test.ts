import { describe, expect, it } from 'vitest';
import {
  isCompetitorDomainName,
  isSameOrSubdomain,
  matchCompetitorsInText,
  matchesWord,
} from '@/lib/competitor-matching';

describe('competitor matching', () => {
  it('does not match brand names inside larger words', () => {
    expect(matchesWord('Pineapple is a fruit', 'Apple')).toBe(false);
    expect(matchesWord('Apple is a company', 'Apple')).toBe(true);
  });

  it('accepts apex domains and real subdomains but not suffix lookalikes', () => {
    expect(isSameOrSubdomain('docs.example.com', 'example.com')).toBe(true);
    expect(isSameOrSubdomain('fakeexample.com', 'example.com')).toBe(false);
    expect(isSameOrSubdomain('example.com.attacker.test', 'example.com')).toBe(false);
  });

  it('matches each configured entity at most once per response', () => {
    const matches = matchCompetitorsInText(
      'Acme appears twice: Acme. Rival is at https://docs.rival.com/a.',
      [
        { name: 'Acme' },
        { name: 'Rival Inc', domain: 'rival.com' },
      ]
    );
    expect(matches.map((match) => match.competitor.name)).toEqual(['Acme', 'Rival Inc']);
  });

  it('classifies complete hostname labels only', () => {
    expect(isCompetitorDomainName('news.apple.com', ['Apple'])).toBe(true);
    expect(isCompetitorDomainName('pineapple.com', ['Apple'])).toBe(false);
  });
});
