import { describe, expect, it } from 'vitest';
import { TimelineEventSchema } from '@/modules/shared/contracts';
import { extractTimelineEvents } from '@/modules/timeline';

describe('extractTimelineEvents', () => {
  it('extracts and orders ISO full dates, day precision', () => {
    const events = extractTimelineEvents(
      'Activity was seen on 2024-03-05, following an earlier campaign on 2023-11-20.',
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => [e.date, e.precision])).toEqual([
      ['2023-11-20', 'day'],
      ['2024-03-05', 'day'],
    ]);
    expect(events[0].confidence).toBe(1);
    expect(events[0].matched).toBe('2023-11-20');
  });

  it('parses written dates and month-year forms', () => {
    const events = extractTimelineEvents(
      'Published March 5, 2024. The group formed in March 2024 and used CVE-2024-12345.',
    );
    const dates = events.map((e) => e.date);
    expect(dates).toContain('2024-03-05');
    expect(dates).toContain('2024-03');
    expect(events.find((e) => e.precision === 'month')?.matched).toBe('March 2024');
  });

  it('does not treat a CVE year as a date', () => {
    const events = extractTimelineEvents('The exploit abused CVE-2024-12345 in the wild.');
    expect(events.some((e) => e.date === '2024')).toBe(false);
    expect(events.filter((e) => e.matched === '2024')).toHaveLength(0);
  });

  it('resolves relative expressions against the earliest exact date', () => {
    const events = extractTimelineEvents(
      'Reported on 2024-03-10. The group moved yesterday and finished 3 days later.',
    );
    expect(events.find((e) => e.matched === 'yesterday')?.date).toBe('2024-03-09');
    expect(events.find((e) => e.matched === '3 days later')?.date).toBe('2024-03-13');
  });

  it('falls back to the provided anchor when the text has no exact date', () => {
    const events = extractTimelineEvents(
      'Last week saw an uptick in scanning.',
      '2024-01-15T00:00:00Z',
    );
    expect(events.find((e) => e.matched.toLowerCase() === 'last week')?.date).toBe('2024-01-08');
  });

  it('keeps events non-overlapping and chronologically sorted', () => {
    const events = extractTimelineEvents(
      'In 2024 the campaign ran from March 2024 to March 5, 2024.',
    );
    const dates = events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort((a, b) => a.localeCompare(b)));
    expect(dates).toHaveLength(3);
  });

  it('outputs schema-valid events with sentence context', () => {
    const text = 'On 2024-06-01 the malware was deployed against targets in Europe.';
    const events = extractTimelineEvents(text);
    expect(events).toHaveLength(1);
    const parsed = TimelineEventSchema.safeParse(events[0]);
    expect(parsed.success).toBe(true);
    expect(events[0].label).toContain('2024-06-01');
  });
});
