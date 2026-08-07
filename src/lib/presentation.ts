// Single source of truth for how the UI presents graph data, so a display
// literal (a color, a size limit, a type label) is defined once and shared by
// the server default and the client component instead of being hardcoded twice.

import type { AttckType, Graph, GraphNode } from '@/modules/shared/contracts';

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

// Confidence drives the semantic dual accent: verified (teal) vs needs-review
// (rust). The percentage is ALWAYS shown next to the color, never the color
// alone. Mirrors --teal / --rust in globals.css for the canvas renderer.
const CONFIDENCE_VERIFIED = 0.7;

export const confidenceColor = (value: number): string =>
  value >= CONFIDENCE_VERIFIED ? '#4a8b8c' : '#c4622d';

// Server job statuses (queued/ingesting/extracting/modeling/done/failed) map to
// analyst-facing stage names for the status screen: pending → extracting →
// mapping → done. The returned label is shown verbatim under the stepper.
export const JOB_STAGE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'extracting', label: 'Extracting entities' },
  { key: 'mapping', label: 'Mapping & graph' },
  { key: 'done', label: 'Done' },
];

export const jobStage = (status: string, progress?: string): { stage: string; label: string } => {
  switch (status) {
    case 'queued':
      return { stage: 'pending', label: 'Waiting for a worker' };
    case 'ingesting':
      return { stage: 'extracting', label: 'Fetching report text' };
    case 'extracting':
      return {
        stage: 'extracting',
        label: progress ? `Extracting entities · ${progress}` : 'Extracting entities',
      };
    case 'modeling':
      return { stage: 'mapping', label: 'Building graph and mappings' };
    case 'done':
      return { stage: 'done', label: 'Analysis complete' };
    case 'cancelled':
      return { stage: 'cancelled', label: 'Analysis cancelled' };
    default:
      return { stage: 'failed', label: 'Analysis failed' };
  }
};
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  for (const unit of ['KB', 'MB', 'GB', 'TB']) {
    value /= 1024;
    if (value < 1024 || unit === 'TB') {
      return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(value)} TB`;
};

export const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

// What the shared inspector shows for a tapped node. Timeline and ATT&CK are
// self-contained views now; only the graph routes through the shared inspector.
export type Selection = { kind: 'node'; node: GraphNode };

export type GraphRelation = {
  edgeId: string;
  edgeType: string;
  derived: boolean;
  neighbor: GraphNode;
  outgoing: boolean;
};

// Ignores edges whose other endpoint is missing from the graph (never happens
// with buildGraph output, but a bad graph should not crash the inspector).
export const graphRelations = (graph: Graph, nodeId: string): GraphRelation[] => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const relations: GraphRelation[] = [];
  for (const edge of graph.edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const neighborId = edge.source === nodeId ? edge.target : edge.source;
    const neighbor = byId.get(neighborId);
    if (neighbor) {
      relations.push({
        edgeId: edge.id,
        edgeType: edge.type,
        derived: edge.derived,
        neighbor,
        outgoing: edge.source === nodeId,
      });
    }
  }
  return relations;
};

// Base attack.mitre.org URL path per mapping kind, so every ATT&CK row links to
// the authoritative page (the id itself appends on top, e.g. /techniques/T1087).
export const attckPage = (type: AttckType): string => {
  const segment =
    type === 'technique'
      ? 'techniques'
      : type === 'group'
        ? 'groups'
        : type === 'software'
          ? 'software'
          : 'campaigns';
  return `https://attack.mitre.org/${segment}`;
};
