'use client';

import { formatPercent, graphRelations, type Selection } from '@/lib/presentation';
import type { Graph } from '@/modules/shared/contracts';

// The shared right-hand inspector. Selection is owned by the workbench; this
// renders whatever kind of item was tapped across Graph / Timeline / ATT&CK.
export function Inspector({ selection, graph }: { selection: Selection | null; graph: Graph }) {
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
        <h3 className="inspector-title">{node.name}</h3>
        {node.evidence && <div className="evidence">{node.evidence}</div>}
        {relations.length > 0 && (
          <ul className="relations">
            {relations.map((relation) => (
              <li key={relation.edgeId}>
                <span className="arrow">{relation.outgoing ? '→' : '←'}</span>
                <span>{relation.neighbor.name}</span>
                <span className="badge mono">{relation.edgeType}</span>
                {relation.derived ? <span className="badge derived mono">inferred</span> : null}
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
    </aside>
  );
}
