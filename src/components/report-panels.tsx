'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AttckMapping, AttckType, TimelineEvent } from '@/modules/shared/contracts';
import { attckPage, confidenceTier, formatPercent } from '@/lib/presentation';

type StixBundle = { type: string; id: string; objects: unknown[] };

const CATEGORY_ORDER: AttckType[] = ['technique', 'group', 'software', 'campaign'];

const CATEGORY_LABEL: Record<AttckType, string> = {
  technique: 'Techniques',
  group: 'Groups',
  software: 'Software',
  campaign: 'Campaigns',
};

const CHIP_W = 112;

// A real time track instead of uniform pills: every chip sits at the
// proportional position of its date across the report's span, so a year apart
// reads larger than a month apart. Year-level markers are taller and bolder
// than month/day ones; the axis below carries year ticks. Positions are
// measured in px so chips never overlap (close dates get nudged apart).
const eventTimestamp = (date: string): number => {
  const normalized = date.length === 4 ? `${date}-01-01` : date.length === 7 ? `${date}-01` : date;
  return Date.parse(`${normalized}T00:00:00Z`);
};

const positions = (
  timeline: TimelineEvent[],
  trackWidth: number,
): Array<{ left: number; year: boolean }> => {
  const timestamps = timeline.map((event) => eventTimestamp(event.date));
  const start = Math.min(...timestamps);
  const span = Math.max(Math.max(...timestamps) - start, 86_400_000);
  const raw = timestamps.map((timestamp) => (timestamp - start) / span);
  const trackSpan = Math.max(trackWidth - CHIP_W, 0);
  // Keep the chip fully inside the track: centers are clamped so the first and
  // last markers never hang off the canvas edge (single-event reports too).
  const clamp = (left: number) =>
    Math.min(Math.max(left, CHIP_W / 2), Math.max(trackWidth - CHIP_W / 2, CHIP_W / 2));
  const lefts: number[] = [];
  for (const point of raw) {
    let left = clamp(point * trackSpan);
    for (const previous of lefts) {
      if (Math.abs(left - previous) < 20) left = clamp(previous + 20);
    }
    lefts.push(left);
  }
  return timeline.map((event, index) => ({
    left: lefts[index],
    year: event.precision === 'year',
  }));
};

// Every ATT&CK mapping becomes a categorized row (techniques/groups/software/
// campaigns) with a confidence mark and an authoritative attack.mitre.org
// link. Tapping a row routes its evidence into the shared inspector rail.
export function AttckView({
  reportId,
  selected,
  onSelect,
}: {
  reportId: string;
  selected: AttckMapping | null;
  onSelect: (mapping: AttckMapping | null) => void;
}) {
  const [attck, setAttck] = useState<AttckMapping[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/reports/${reportId}/attck`)
      .then((response) => (response.ok ? response.json() : null))
      .then((mappings: AttckMapping[] | null) => {
        if (active) setAttck(mappings);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  if (attck === null) return <p className="muted">ATT&CK mappings not available yet.</p>;
  if (attck.length === 0)
    return <p className="muted">No explicit ATT&CK objects detected in this report.</p>;

  return (
    <div>
      <div className="attck-categories">
        {CATEGORY_ORDER.map((category) => {
          const rows = attck.filter((mapping) => mapping.type === category);
          if (rows.length === 0) return null;
          return (
            <section key={category} className="attck-category">
              <h4 className="attck-category-title mono">
                {CATEGORY_LABEL[category]} <span>({rows.length})</span>
              </h4>
              <ul className="panel-list">
                {rows.map((mapping) => (
                  <li key={mapping.attckId}>
                    <div
                      className={`attck-row${selected?.attckId === mapping.attckId ? ' active' : ''}`}
                    >
                      <button
                        type="button"
                        className="attck-row-main"
                        onClick={() =>
                          onSelect(selected?.attckId === mapping.attckId ? null : mapping)
                        }
                      >
                        <span className="mono attck-id">{mapping.attckId}</span>
                        <strong>{mapping.name ?? '—'}</strong>
                        {mapping.tactic ? (
                          <span className="badge mono">{mapping.tactic}</span>
                        ) : null}
                        <span className={`confidence-mark ${confidenceTier(mapping.confidence)}`}>
                          {formatPercent(mapping.confidence)}
                        </span>
                      </button>
                      <a
                        className="attck-link"
                        href={`${attckPage(mapping.type)}/${mapping.attckId}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${mapping.attckId} on attack.mitre.org`}
                      >
                        ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="muted note">
        Explicit ATT&CK objects only — the embedding-similarity tier is not extracted yet.
      </p>
    </div>
  );
}

// Proportional timeline track. The scroller holds a px-wide track that grows
// when events are dense (so chips keep a minimum separation), and the rail
// width is re-measured on resize so positions stay honest.
export function TimelineView({
  reportId,
  selected,
  onSelect,
}: {
  reportId: string;
  selected: TimelineEvent | null;
  onSelect: (event: TimelineEvent | null) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/reports/${reportId}/timeline`)
      .then((response) => (response.ok ? response.json() : null))
      .then((events: TimelineEvent[] | null) => {
        if (active) setTimeline(events);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  useLayoutEffect(() => {
    const measure = () => {
      const width = scrollerRef.current?.offsetWidth ?? 0;
      setTrackWidth(Math.max(width, (timeline?.length ?? 0) * CHIP_W + 64));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [timeline]);

  const markers = useMemo(
    () => (timeline ? positions(timeline, trackWidth) : []),
    [timeline, trackWidth],
  );

  if (timeline === null) return <p className="muted">Timeline not available yet.</p>;
  if (timeline.length === 0) return <p className="muted">No dated events found in this report.</p>;

  const startYear = Number(timeline[0].date.slice(0, 4));
  const endYear = Number(timeline[timeline.length - 1].date.slice(0, 4));
  // Long spans label only the years that actually contain events, so a
  // multi-decade report does not render ~100 overlapping axis ticks.
  const eventYears = new Set(timeline.map((event) => Number(event.date.slice(0, 4))));
  const yearTicks: Array<{ year: number; left: number }> = [];
  for (let year = startYear; year <= endYear; year += 1) {
    if (
      endYear - startYear > 25 &&
      year !== startYear &&
      year !== endYear &&
      !eventYears.has(year)
    ) {
      continue;
    }
    const point =
      (eventTimestamp(`${year}`) - eventTimestamp(`${startYear}`)) /
      (eventTimestamp(`${endYear}`) - eventTimestamp(`${startYear}`) || 86_400_000);
    const left = Math.min(
      Math.max(Math.round(point * Math.max(trackWidth - CHIP_W, 0)), 20),
      Math.max(trackWidth - 20, 20),
    );
    yearTicks.push({ year, left });
  }

  return (
    <div className="timeline-view">
      <div className="tl-scroller" ref={scrollerRef} aria-label="Timeline events">
        <div className="tl-track" style={{ width: `${trackWidth}px` }}>
          {timeline.map((event, index) => (
            <button
              key={event.id}
              type="button"
              aria-pressed={selected?.id === event.id}
              className={`tl-chip mono${markers[index].year ? ' year' : ''}${
                selected?.id === event.id ? ' active' : ''
              }`}
              style={{ left: `${markers[index].left}px` }}
              onClick={() => onSelect(selected?.id === event.id ? null : event)}
            >
              <span className="tl-chip-date">{event.date}</span>
              <span className={`tl-pill mono tl-${event.precision}`}>
                {event.precision === 'day' ? 'exact' : event.precision}
              </span>
            </button>
          ))}
        </div>
        <div className="tl-axis" style={{ width: `${trackWidth}px` }} aria-hidden="true">
          {yearTicks.map(({ year, left }) => (
            <span key={year} className="tl-axis-tick mono" style={{ left: `${left}px` }}>
              {year}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExportView({ reportId }: { reportId: string }) {
  const [stix, setStix] = useState<StixBundle | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/reports/${reportId}/stix`)
      .then((response) => (response.ok ? response.json() : null))
      .then((bundle: StixBundle | null) => {
        if (active) setStix(bundle);
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  if (stix === null) return <p className="muted">STIX bundle not available yet.</p>;

  const download = () => {
    const blob = new Blob([JSON.stringify(stix, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chronicle-${reportId}.stix.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <button type="button" className="toolbar-toggle" onClick={download}>
        Download STIX JSON
      </button>
      <pre className="panel-list stix-pre">{renderStixTokens(stix)}</pre>
    </div>
  );
}

// Minimal syntax pass over the pretty-printed JSON — no dependency, just the
// palette: keys in muted, string values in ink, numbers/literals in accent
// colors, and confidence values echoing the app's teal/rust tiers.
type StixToken = { text: string; cls?: string };
const STIX_TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|(true|false|null)/g;

const renderStixTokens = (stix: StixBundle) => {
  const text = JSON.stringify(stix, null, 2);
  const tokens: StixToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = STIX_TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index) });
    const [, key, colon, number, literal] = match;
    if (key !== undefined) {
      tokens.push({ text: match[0], cls: colon !== undefined ? 'stix-key' : 'stix-str' });
    } else if (number !== undefined) {
      const previous = tokens[tokens.length - 1];
      const isConfidence = previous?.text.startsWith('"confidence"');
      const value = Number(number);
      tokens.push({
        text: match[0],
        cls: isConfidence ? (value >= 0.7 ? 'stix-conf-verified' : 'stix-conf-review') : 'stix-num',
      });
    } else {
      tokens.push({ text: match[0], cls: 'stix-lit' });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens.map((token, index) =>
    token.cls ? (
      <span key={index} className={token.cls}>
        {token.text}
      </span>
    ) : (
      <span key={index}>{token.text}</span>
    ),
  );
};
