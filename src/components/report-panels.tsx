'use client';

import { useEffect, useState } from 'react';
import type { AttckMapping, TimelineEvent } from '@/modules/shared/contracts';
import { formatPercent } from '@/lib/presentation';

type StixBundle = { type: string; id: string; objects: unknown[] };
type Tab = 'timeline' | 'attck' | 'stix';

export function ReportPanels({ reportId }: { reportId: string }) {
  const [tab, setTab] = useState<Tab>('timeline');
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [attck, setAttck] = useState<AttckMapping[] | null>(null);
  const [stix, setStix] = useState<StixBundle | null>(null);

  useEffect(() => {
    if (tab !== 'timeline' || timeline !== null) return;
    void fetch(`/api/v1/reports/${reportId}/timeline`)
      .then((response) => (response.ok ? response.json() : null))
      .then((events: TimelineEvent[] | null) => setTimeline(events));
  }, [tab, timeline, reportId]);

  useEffect(() => {
    if (tab !== 'attck' || attck !== null) return;
    void fetch(`/api/v1/reports/${reportId}/attck`)
      .then((response) => (response.ok ? response.json() : null))
      .then((mappings: AttckMapping[] | null) => setAttck(mappings));
  }, [tab, attck, reportId]);

  useEffect(() => {
    if (tab !== 'stix' || stix !== null) return;
    void fetch(`/api/v1/reports/${reportId}/stix`)
      .then((response) => (response.ok ? response.json() : null))
      .then((bundle: StixBundle | null) => setStix(bundle));
  }, [tab, stix, reportId]);

  const downloadStix = () => {
    if (!stix) return;
    const blob = new Blob([JSON.stringify(stix, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chronicle-${reportId}.stix.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="tabs-panel" aria-label="Report analysis panels">
      <div className="tabs">
        {(['timeline', 'attck', 'stix'] as Tab[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`tab${tab === candidate ? ' active' : ''}`}
            onClick={() => setTab(candidate)}
          >
            {candidate === 'attck' ? 'ATT&CK' : candidate === 'stix' ? 'STIX export' : 'Timeline'}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {tab === 'timeline' &&
          (timeline === null ? (
            <p className="muted">Timeline not available yet.</p>
          ) : timeline.length === 0 ? (
            <p className="muted">No dated events found in this report.</p>
          ) : (
            <ul className="panel-list">
              {timeline.map((event) => (
                <li key={event.id}>
                  <strong>{event.date}</strong> <span className="muted">({event.matched})</span>
                  <span className="muted"> · {formatPercent(event.confidence)}</span>
                  <div className="muted"> {event.label}</div>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'attck' &&
          (attck === null ? (
            <p className="muted">ATT&CK mappings not available yet.</p>
          ) : attck.length === 0 ? (
            <p className="muted">No explicit ATT&CK objects detected.</p>
          ) : (
            <ul className="panel-list">
              {attck.map((mapping) => (
                <li key={mapping.attckId}>
                  <strong>{mapping.attckId}</strong> <span className="muted">{mapping.name}</span>
                  <span className="muted"> · {formatPercent(mapping.confidence)}</span>
                </li>
              ))}
            </ul>
          ))}
        {tab === 'stix' &&
          (stix === null ? (
            <p className="muted">STIX bundle not available yet.</p>
          ) : (
            <div>
              <button type="button" className="toolbar-toggle" onClick={downloadStix}>
                Download STIX JSON
              </button>
              <pre className="panel-list">{JSON.stringify(stix, null, 2)}</pre>
            </div>
          ))}
      </div>
    </section>
  );
}
