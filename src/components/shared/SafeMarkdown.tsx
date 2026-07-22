'use client';

import React from 'react';

type Accent = 'blue' | 'green' | 'indigo' | 'purple';

interface SafeMarkdownProps {
  content: string;
  accent?: Accent;
  highlightTerms?: string[];
  className?: string;
}

const ACCENT_CLASSES: Record<Accent, { link: string; marker: string; highlight: string }> = {
  blue: {
    link: 'text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200',
    marker: 'bg-blue-500',
    highlight: 'text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300',
  },
  green: {
    link: 'text-green-600 hover:text-green-800 dark:text-green-300 dark:hover:text-green-200',
    marker: 'bg-green-500',
    highlight: 'text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-300',
  },
  indigo: {
    link: 'text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200',
    marker: 'bg-indigo-500',
    highlight: 'text-indigo-700 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300',
  },
  purple: {
    link: 'text-purple-600 hover:text-purple-800 dark:text-purple-300 dark:hover:text-purple-200',
    marker: 'bg-purple-500',
    highlight: 'text-purple-700 bg-purple-50 dark:bg-purple-950 dark:text-purple-300',
  },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (/^mailto:/i.test(value)) return value;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/\(source=([^"\n]+)"\s+target="_blank"[^>]*>([^)]+)\)/g, '[$2]($2) (source: $1)')
    .replace(/\[\[(\d+)\]\]\([^)]+\)/g, '[$1]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function highlightedText(
  text: string,
  terms: string[],
  className: string,
  keyPrefix: string
): React.ReactNode[] {
  if (terms.length === 0) return [text];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => {
    const isMatch = terms.some((term) => term.toLowerCase() === part.toLowerCase());
    return isMatch
      ? <mark key={`${keyPrefix}-${index}`} className={`rounded px-1 font-medium ${className}`}>{part}</mark>
      : part;
  });
}

function InlineContent({
  text,
  accent,
  highlightTerms,
  keyPrefix,
}: {
  text: string;
  accent: Accent;
  highlightTerms: string[];
  keyPrefix: string;
}) {
  const classes = ACCENT_CLASSES[accent];
  const tokenPattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[(\d+)\]|\*([^*\n]+)\*)/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(...highlightedText(
        text.slice(cursor, match.index),
        highlightTerms,
        classes.highlight,
        `${keyPrefix}-plain-${match.index}`
      ));
    }

    const key = `${keyPrefix}-token-${match.index}`;
    if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeHref(match[3]);
      nodes.push(href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={`font-medium underline ${classes.link}`}>
          {match[2]}
        </a>
      ) : match[2]);
    } else if (match[4] !== undefined || match[5] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-foreground">{match[4] ?? match[5]}</strong>);
    } else if (match[6] !== undefined) {
      nodes.push(<code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{match[6]}</code>);
    } else if (match[7] !== undefined) {
      nodes.push(<sup key={key} className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${classes.marker}`}>{match[7]}</sup>);
    } else if (match[8] !== undefined) {
      nodes.push(<em key={key} className="italic text-foreground">{match[8]}</em>);
    }
    cursor = tokenPattern.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push(...highlightedText(
      text.slice(cursor),
      highlightTerms,
      classes.highlight,
      `${keyPrefix}-tail`
    ));
  }
  return <>{nodes}</>;
}

export default function SafeMarkdown({
  content,
  accent = 'blue',
  highlightTerms = [],
  className = '',
}: SafeMarkdownProps) {
  const normalized = normalizeContent(content || '');
  const terms = Array.from(new Set(
    highlightTerms.map((term) => term.trim()).filter((term) => term.length > 0)
  )).sort((left, right) => right.length - left.length);
  const lines = normalized.split('\n');
  const blocks: React.ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`} className="my-4 overflow-x-auto rounded-lg border border-border bg-muted p-4">
          <code className="text-sm text-foreground">{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3';
      const headingClass = heading[1].length === 1
        ? 'mt-6 mb-4 text-2xl font-bold'
        : heading[1].length === 2
          ? 'mt-6 mb-3 text-xl font-semibold'
          : 'mt-5 mb-2 text-lg font-semibold';
      blocks.push(
        <Tag key={`heading-${index}`} className={`${headingClass} text-foreground`}>
          <InlineContent text={heading[2]} accent={accent} highlightTerms={terms} keyPrefix={`heading-${index}`} />
        </Tag>
      );
      index += 1;
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!candidate || /\d+\./.test(candidate[2]) !== ordered) break;
        items.push(candidate[3]);
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${index}`} className={`my-4 ml-6 space-y-2 text-foreground ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineContent text={item} accent={accent} highlightTerms={terms} keyPrefix={`list-${index}-${itemIndex}`} />
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !/^(#{1,3})\s+/.test(lines[index].trim())
      && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[index])
      && !lines[index].trim().startsWith('```')
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`} className="mb-4 whitespace-pre-wrap leading-relaxed text-foreground">
        <InlineContent text={paragraph.join(' ')} accent={accent} highlightTerms={terms} keyPrefix={`paragraph-${index}`} />
      </p>
    );
  }

  return <div className={className}>{blocks}</div>;
}
