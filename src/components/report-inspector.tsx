'use client';

import { useState } from 'react';
import { formatPercent, graphRelations, type Selection } from '@/lib/presentation';
import type { CorrectionInput, Graph } from '@/modules/shared/contracts';

type ReviewInput = {
  targetType: 'entity' | 'relationship' | 'mapping';
  targetId: string;
  action: 'accept' | 'reject' | 'correct';
  correctedValue?: Record<string, string | number>;
};

// The shared right-hand inspector. Selection is owned by the workbench; this
// renders whatever kind of item was tapped across Graph / Timeline / ATT&CK
// and posts analyst corrections through the onReview callback.
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
      <aside className="inspector">
        <p className="meta">Select a node, timeline event, or ATT&CK mapping to inspect.</p>
      </aside>
    );
  }

  if (selection.kind === 'node') {
    const node = selection.node;
    const relations = graphRelations(graph, node.id);
    const name = renames.get(node.id) ?? node.name;
    const rejected = hiddenNodes.has(node.id);
    return (
      <aside className="inspector" aria-live="polite">
        <div className="inspector-stamp">
          <span className="confidence-mark">{formatPercent(node.confidence)}</span>
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

  if (selection.kind === 'timeline') {
    const event = selection.event;
    const precisionLabel = event.precision === 'day' ? 'exact' : event.precision;
    return (
      <aside className="inspector" aria-live="polite">
        <div className="inspector-stamp">
          <span className="confidence-mark">{formatPercent(event.confidence)}</span>
          <span className="confidence-word">
            {event.confidence >= 0.7 ? 'verified' : 'needs review'}
          </span>
        </div>
        <p className="kind">{precisionLabel} · timeline</p>
        <h3 className="inspector-title mono">{event.date}</h3>
        <p className="meta">
          matched <span className="mono">«{event.matched}»</span>
        </p>
        <div className="evidence">{event.label}</div>
        <p className="muted">Timeline events are read-only — corrections target graph items.</p>
      </aside>
    );
  }

  const mapping = selection.mapping;
  return (
    <aside className="inspector" aria-live="polite">
      <div className="inspector-stamp">
        <span className="confidence-mark">{formatPercent(mapping.confidence)}</span>
        <span className="confidence-word">
          {mapping.confidence >= 0.7 ? 'verified' : 'needs review'}
        </span>
      </div>
      <p className="kind mono">
        {mapping.attckId} · {mapping.type}
      </p>
      {mapping.name ? <h3 className="inspector-title">{mapping.name}</h3> : null}
      <p className="meta">
        source <span className="mono">{mapping.source}</span>
        {mapping.tactic ? (
          <>
            {' '}
            · tactic <span className="mono">{mapping.tactic}</span>
          </>
        ) : null}
      </p>
      {mapping.matchedText && (
        <div className="evidence">
          matched <span className="mono">«{mapping.matchedText}»</span>
        </div>
      )}
      <div className="review-actions">
        <button
          type="button"
          className="review accept"
          onClick={() =>
            void review({ targetType: 'mapping', targetId: mapping.attckId, action: 'accept' })
          }
        >
          Accept
        </button>
        <button
          type="button"
          className="review reject"
          onClick={() =>
            void review({ targetType: 'mapping', targetId: mapping.attckId, action: 'reject' })
          }
        >
          Reject
        </button>
      </div>
      {saved && <p className="reviewed">{saved}</p>}
    </aside>
  );
}
