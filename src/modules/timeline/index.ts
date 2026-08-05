import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '@/modules/shared/contracts';

// Deterministic temporal extraction: no LLM call (an extra inference pass costs
// minutes on this hardware). Mirrors the ATT&CK explicit-matching pattern: the
// report text is scanned for date expressions, resolved, and ordered.
//
// Match priority (first-wins, non-overlapping):
//   1. full dates   2024-03-05 | 2024/3/5 | March 5, 2024 | 5 March 2024
//   2. month-year   March 2024 | Mar 2024
//   3. year-only    2024 (with CVE-year lookahead guard)
//   4. relative     yesterday | last week/month/year | N days/weeks/months ago|later
//
// Ambiguous slash dates (03/05/2024) are treated as US m/d/y — CTI reports are
// predominantly US-formatted; document the assumption, do not guess both.
// ponytail: "last week" resolves to exactly anchor-7d (not the ISO week start);
// fine for a first-draft analyst view, refine if golden-set precision demands.

const MONTH_NAMES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
} as const;

type RawMatch = {
  start: number;
  end: number;
  date: string;
  precision: TimelineEvent['precision'];
  matched: string;
  confidence: number;
};

const pad = (n: number) => String(n).padStart(2, '0');
const yearOnly = (y: number): Omit<RawMatch, 'start' | 'end'> => ({
  date: String(y),
  precision: 'year',
  matched: String(y),
  confidence: 0.6,
});

const toMonth = (name: string): number | undefined => {
  const m = MONTH_NAMES[name.slice(0, 3).toLowerCase() as keyof typeof MONTH_NAMES];
  return m === undefined ? undefined : m;
};

const FULL_ISO = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g;
const FULL_WRITTEN =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/gi;
const MONTH_YEAR = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/gi;
const YEAR = /(^|[^\w-])(20\d{2})(?!-\d)\b/g;
const RELATIVE =
  /\b(yesterday|last\s+week|last\s+month|last\s+year|this\s+week|this\s+month|this\s+year|(?:\d+|a\s+few|several)\s+(?:day|week|month|year)s?\s+(?:later|ago|earlier|prior))\b/gi;

const sentenceAt = (text: string, pos: number): string => {
  const sentenceStart = Math.max(
    0,
    text.lastIndexOf('.', pos - 1) + 1,
    text.lastIndexOf('\n', pos - 1) + 1,
  );
  let end = text.indexOf('.', pos);
  if (end === -1 || end - pos > 300) end = Math.min(text.length, pos + 300);
  return text.slice(sentenceStart, end).replace(/\s+/g, ' ').trim().slice(0, 1_000);
};

export const extractTimelineEvents = (
  text: string,
  fallbackAnchor = new Date().toISOString(),
): TimelineEvent[] => {
  const matches: RawMatch[] = [];
  const seen = new Set<string>();

  const push = (m: RawMatch) => {
    const key = `${m.date}|${m.matched}`;
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(m);
    }
  };

  for (const m of text.matchAll(FULL_ISO)) {
    const [, y, mo, d] = m;
    push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      date: `${y}-${pad(+mo)}-${pad(+d)}`,
      precision: 'day',
      matched: m[0],
      confidence: 1,
    });
  }
  for (const m of text.matchAll(FULL_WRITTEN)) {
    const [, name, d, y] = m;
    push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      date: `${y}-${pad(toMonth(name)!)}-${pad(+d)}`,
      precision: 'day',
      matched: m[0],
      confidence: 1,
    });
  }
  for (const m of text.matchAll(MONTH_YEAR)) {
    const [, name, y] = m;
    push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      date: `${y}-${pad(toMonth(name)!)}`,
      precision: 'month',
      matched: m[0],
      confidence: 0.9,
    });
  }
  for (const m of text.matchAll(YEAR)) {
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, ...yearOnly(+m[2]) });
  }

  // Anchor = earliest exact (day-precision) date in the text; CTI reports date-
  // stamp themselves, so relative terms usually reference that publication date.
  // ponytail: falls back to report creation time when the text carries no exact
  // date — the true publish date is not extracted anywhere yet.
  const anchors = matches
    .filter((m) => m.precision === 'day')
    .map((m) => Date.parse(m.date))
    .sort((a, b) => a - b);
  const anchorMs = anchors[0] ?? Date.parse(fallbackAnchor.slice(0, 10));
  const addDays = (n: number) => new Date(anchorMs + n * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  for (const m of text.matchAll(RELATIVE)) {
    const token = m[0].toLowerCase();
    const days = (n: number, unit: string) =>
      unit === 'month' ? n * 30 : unit === 'year' ? n * 365 : n;
    let offset = 0;
    let precision: TimelineEvent['precision'] = 'day';
    let confidence = 0.7;
    if (token === 'yesterday') offset = -1;
    else if (token === 'last week') offset = -7;
    else if (token === 'last month') {
      offset = -30;
      precision = 'month';
      confidence = 0.6;
    } else if (token === 'last year') {
      offset = -365;
      precision = 'year';
      confidence = 0.5;
    } else if (token === 'this week' || token === 'this month' || token === 'this year') {
      offset = 0;
      precision = token === 'this week' ? 'day' : token === 'this month' ? 'month' : 'year';
      confidence = 0.5;
    } else {
      const rel = /(\d+|a few|several)\s+(day|week|month|year)s?\s+(later|ago|earlier|prior)/.exec(
        token,
      );
      if (!rel) continue;
      const n = rel[1] === 'a few' ? 3 : rel[1] === 'several' ? 5 : +rel[1];
      const dir = rel[3] === 'later' ? 1 : -1;
      offset = dir * days(n, rel[2]);
    }
    const resolved = iso(addDays(offset));
    push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      date: precision === 'day' ? resolved : resolved.slice(0, precision === 'month' ? 7 : 4),
      precision,
      matched: m[0],
      confidence,
    });
  }

  const byPosition = [...matches].sort((a, b) => a.start - b.start);
  const nonOverlapping: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of byPosition) {
    if (m.start >= lastEnd) {
      nonOverlapping.push(m);
      lastEnd = m.end;
    }
  }

  return nonOverlapping
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
    .slice(0, 500)
    .map((m, i) => ({
      id: randomUUID(),
      date: m.date,
      precision: m.precision,
      matched: m.matched,
      label: sentenceAt(text, m.start),
      confidence: m.confidence,
    }));
};
