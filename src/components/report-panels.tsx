'use client';

import { useEffect, useState } from 'react';
import type { AttckMapping, AttckType, TimelineEvent } from '@/modules/shared/contracts';
import { attckPage, formatPercent } from '@/lib/presentation';

type StixBundle = { type: string; id: string; objects: unknown[] };

const CATEGORY_ORDER: AttckType[] = ['technique', 'group', 'software', 'campaign'];

const CATEGORY_LABEL: Record<AttckType, string> = {
  technique: 'Techniques',
  group: 'Groups',
  software: 'Software',
  campaign: 'Campaigns',
};

// The slider stays uniform: every chip carries only the date and precision, so
// widths are consistent and no event pushes the layout taller than another.
// The selected event's prose lives in the fixed-height detail pane beside the
// rail, so opening one never rescales the page.
export function TimelineView({ reportId }: { reportId: string }) {
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/reports/${reportId}/timeline`)
      .then((response) => (response.ok ? response.json() : null))
      .then((events: TimelineEvent[] | null) => {
        if (active) {
          setTimeline(events);
          setSelected(events?.[0] ?? null);
        }
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  if (timeline === null) return <p className="muted">Timeline not available yet.</p>;
  if (timeline.length === 0) return <p className="muted">No dated events found in this report.</p>;

  return (
    <div className="timeline-view">
      <div className="timeline-slider" role="listbox" aria-label="Timeline events">
        {timeline.map((event) => (
          <button
            key={event.id}
            type="button"
            role="option"
            aria-selected={selected?.id === event.id}
            className={`tl-chip mono${selected?.id === event.id ? ' active' : ''}`}
            onClick={() => setSelected(event)}
          >
            <span className="tl-chip-date">{event.date}</span>
            <span className={`tl-pill mono tl-${event.precision}`}>
              {event.precision === 'day' ? 'exact' : event.precision}
            </span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="tl-detail">
          <div className="tl-detail-head">
            <span className="mono tl-date">{selected.date}</span>
            <span className={`tl-pill mono tl-${selected.precision}`}>
              {selected.precision === 'day' ? 'exact' : selected.precision}
            </span>
            <span className="mono tl-confidence">{formatPercent(selected.confidence)}</span>
          </div>
          <p className="tl-detail-text">{selected.label}</p>
          <p className="muted mono tl-detail-match">“{selected.matched}”</p>
        </div>
      ) : null}
    </div>
  );
}

// Every ATT&CK mapping gets a categorized row (techniques/groups/software/
// campaigns) with a confidence mark and an authoritative attack.mitre.org
// link. Tapping a row opens its matched evidence inline — nothing else moves
// on the page.
export function AttckView({ reportId }: { reportId: string }) {
  const [attck, setAttck] = useState<AttckMapping[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  const open = attck.find((mapping) => mapping.attckId === openId) ?? null;

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
                    <div className={`attck-row${open?.attckId === mapping.attckId ? ' open' : ''}`}>
                      <button
                        type="button"
                        className="attck-row-main"
                        onClick={() =>
                          setOpenId(open?.attckId === mapping.attckId ? null : mapping.attckId)
                        }
                      >
                        <span className="mono attck-id">{mapping.attckId}</span>
                        <strong>{mapping.name ?? '—'}</strong>
                        {mapping.tactic ? (
                          <span className="badge mono">{mapping.tactic}</span>
                        ) : null}
                        <span className="mono tl-confidence">
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
                    {open?.attckId === mapping.attckId ? (
                      <div className="attck-evidence">
                        <span className="badge mono">{mapping.type}</span>
                        <span className="muted mono">{mapping.source}</span>
                        <p className="attck-evidence-text">
                          {mapping.matchedText ?? mapping.name ?? mapping.attckId}
                        </p>
                      </div>
                    ) : null}
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
      <pre className="panel-list stix-pre">{JSON.stringify(stix, null, 2)}</pre>
    </div>
  );
}
