'use client';

import { useEffect, useState } from 'react';
import type { AttckMapping, TimelineEvent } from '@/modules/shared/contracts';
import { formatPercent } from '@/lib/presentation';

type StixBundle = { type: string; id: string; objects: unknown[] };

// Lazy-fetched per view; each reports its tapped item up to the workbench,
// which owns the shared selection for the inspector.
export function TimelineView({
  reportId,
  onSelect,
}: {
  reportId: string;
  onSelect: (event: TimelineEvent) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);

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

  if (timeline === null) return <p className="muted">Timeline not available yet.</p>;
  if (timeline.length === 0) return <p className="muted">No dated events found in this report.</p>;

  return (
    <div className="timeline" aria-label="Report timeline">
      {timeline.map((event) => (
        <button
          key={event.id}
          type="button"
          className="timeline-event"
          onClick={() => onSelect(event)}
        >
          <span className="timeline-date mono">{event.date}</span>
          <span className={`tl-pill mono tl-${event.precision}`}>
            {event.precision === 'day' ? 'exact' : event.precision}
          </span>
          <span className="tl-confidence mono">{formatPercent(event.confidence)}</span>
          <span className="tl-text">{event.label}</span>
        </button>
      ))}
    </div>
  );
}

export function AttckView({
  reportId,
  onSelect,
}: {
  reportId: string;
  onSelect: (mapping: AttckMapping) => void;
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
    <>
      <ul className="panel-list">
        {attck.map((mapping) => (
          <li key={mapping.attckId}>
            <button type="button" className="attck-row" onClick={() => onSelect(mapping)}>
              <span className="mono attck-id">{mapping.attckId}</span>
              <strong>{mapping.name ?? '—'}</strong>
              {mapping.tactic ? <span className="badge mono">{mapping.tactic}</span> : null}
              <span className="badge mono">{mapping.type}</span>
              <span className="mono tl-confidence">{formatPercent(mapping.confidence)}</span>
              <span className="muted mono">{mapping.source}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted note">
        Explicit ATT&CK objects only — the embedding-similarity tier is not extracted yet.
      </p>
    </>
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
