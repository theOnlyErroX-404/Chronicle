'use client';

import { useState } from 'react';
import {
  attckPage,
  confidenceTier,
  formatPercent,
  graphRelations,
  type Selection,
} from '@/lib/presentation';
import type { CorrectionInput, Graph } from '@/modules/shared/contracts';

type ReviewInput = {
  targetType: Exclude<CorrectionInput['targetType'], 'mapping'>;
  targetId: string;
  action: 'accept' | 'reject' | 'correct';
  correctedValue?: Record<string, string | number>;
};

// The shared right-hand rail. Every view routes its selection here: graph nodes
// get the review surface (Accept/Reject/Correct), timeline events and ATT&CK
// mappings get their evidence. The workbench owns the selection and posts
// analyst corrections through the onReview callback.
export function Inspector({
  selection,
  graph,
  hiddenNodes,
  hiddenEdges,
  renames,
  onReview,
}: {
  selection: Selection | null;
  graph: Graph;
  hiddenNodes: ReadonlySet<string>;
  hiddenEdges: ReadonlySet<string>;
  renames: ReadonlyMap<string, string>;
  onReview: (input: CorrectionInput) => Promise<boolean>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saved, setSaved] = useState('');

  const review = async (input: ReviewInput) => {
    const ok = await onReview(input);
    if (ok) {
      setCorrecting(false);
      setSaved(input.action === 'reject' ? 'Rejected — removed from view.' : 'Correction saved.');
    }
  };

  if (!selection) {
    return (
      <aside className="inspector empty">
        <p className="meta">
          Select a node, timeline event, or ATT&CK mapping to inspect its evidence.
        </p>
      </aside>
    );
  }

  if (selection.kind === 'timeline') {
    const { event } = selection;
    return (
      <aside className="inspector" aria-live="polite">
        <div className="inspector-stamp">
          <span className={`confidence-mark ${confidenceTier(event.confidence)}`}>
            {formatPercent(event.confidence)}
          </span>
          <span className="confidence-word">
            {event.precision === 'day' ? 'exact date' : event.precision}
          </span>
        </div>
        <h3 className="inspector-title mono tl-date">{event.date}</h3>
        <p className="tl-detail-text">{event.label}</p>
        <p className="muted mono tl-detail-match">“{event.matched}”</p>
      </aside>
    );
  }

  if (selection.kind === 'attck') {
    const { mapping } = selection;
    return (
      <aside className="inspector" aria-live="polite">
        <div className="inspector-stamp">
          <span className={`confidence-mark ${confidenceTier(mapping.confidence)}`}>
            {formatPercent(mapping.confidence)}
          </span>
          <span className="confidence-word">{mapping.type}</span>
        </div>
        <h3 className="inspector-title">
          <span className="mono attck-id">{mapping.attckId}</span>
          {mapping.name ? ` ${mapping.name}` : ''}
        </h3>
        <p className="kind">
          {mapping.tactic ?? '—'}
          <a
            className="attck-link"
            href={`${attckPage(mapping.type)}/${mapping.attckId}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${mapping.attckId} on attack.mitre.org`}
          >
            ↗
          </a>
        </p>
        {mapping.source ? <p className="muted mono">{mapping.source}</p> : null}
        {mapping.matchedText ? <div className="evidence">{mapping.matchedText}</div> : null}
      </aside>
    );
  }

  const node = selection.node;
  const relations = graphRelations(graph, node.id);
  const name = renames.get(node.id) ?? node.name;
  const rejected = hiddenNodes.has(node.id);
  return (
    <aside className="inspector" aria-live="polite">
      <div className="inspector-stamp">
        <span className={`confidence-mark ${confidenceTier(node.confidence)}`}>
          {formatPercent(node.confidence)}
        </span>
        <span className="confidence-word">
          {node.confidence >= 0.7 ? 'verified' : 'needs review'}
        </span>
      </div>
      <p className="kind">
        {node.type}
        {node.aliases && node.aliases.length > 0 ? ` · ${node.aliases.join(', ')}` : ''}
      </p>
      <h3 className="inspector-title">{name}</h3>
      {node.evidence && <div className="evidence">{node.evidence}</div>}
      {rejected ? (
        <p className="reviewed">Rejected — removed from view.</p>
      ) : (
        <div className="review-actions">
          <button
            type="button"
            className="review accept"
            onClick={() =>
              void review({ targetType: 'entity', targetId: node.id, action: 'accept' })
            }
          >
            Accept
          </button>
          <button
            type="button"
            className="review reject"
            onClick={() =>
              void review({ targetType: 'entity', targetId: node.id, action: 'reject' })
            }
          >
            Reject
          </button>
          <button
            type="button"
            className="review correct"
            onClick={() => {
              setDraftName(name);
              setCorrecting(true);
            }}
          >
            Correct
          </button>
        </div>
      )}
      {correcting && (
        <form
          className="correct-form"
          onSubmit={(event) => {
            event.preventDefault();
            void review({
              targetType: 'entity',
              targetId: node.id,
              action: 'correct',
              correctedValue: { name: draftName.trim() },
            });
          }}
        >
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            aria-label="Corrected name"
            autoFocus
          />
          <button type="submit">Save</button>
        </form>
      )}
      {saved && <p className="reviewed">{saved}</p>}
      {relations.length > 0 && (
        <ul className="relations">
          {relations.map((relation) => (
            <li key={relation.edgeId}>
              <span className="arrow">{relation.outgoing ? '→' : '←'}</span>
              <span>{renames.get(relation.neighbor.id) ?? relation.neighbor.name}</span>
              <span className="badge mono">{relation.edgeType}</span>
              {relation.derived ? <span className="badge derived mono">inferred</span> : null}
              {hiddenEdges.has(relation.edgeId) ? (
                <span className="reviewed">rejected</span>
              ) : (
                <button
                  type="button"
                  className="row-reject"
                  title="Reject this relationship"
                  aria-label={`Reject relationship ${relation.edgeType}`}
                  onClick={() =>
                    void review({
                      targetType: 'relationship',
                      targetId: relation.edgeId,
                      action: 'reject',
                    })
                  }
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
