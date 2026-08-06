'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';
import type { Graph, GraphCluster, GraphEdge, GraphNode } from '@/modules/shared/contracts';
import { formatPercent } from '@/lib/presentation';

// Cluster colors follow a Tableau-style categorical palette (the palette
// Graphify derives communities with), so each connected component reads as one
// hue across the canvas. Surplus / singleton nodes fall back to a muted tone.
const CLUSTER_PALETTE = [
  '#e15759',
  '#f28e2b',
  '#4e79a7',
  '#76b7b2',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

// Node shape by entity kind: actor / tooling / infrastructure / context read
// as distinct silhouettes regardless of the cluster color they carry.
const SHAPE_BY_TYPE: Record<string, string> = {
  'threat-actor': 'diamond',
  campaign: 'diamond',
  malware: 'triangle',
  tool: 'triangle',
  'web-shell': 'triangle',
  vulnerability: 'hexagon',
  indicator: 'dot',
  email: 'dot',
  'file-path': 'dot',
  sector: 'square',
  country: 'square',
};

const NODE_MUTED = '#6b6480';
const EDGE_COLOR = '#4b4563';
const DERIVED_COLOR = '#9c755f';

const clusterColorFor = (clusters: GraphCluster[], nodeId: string) => {
  const index = clusters.findIndex((cluster) => cluster.nodeIds.includes(nodeId));
  return index === -1 ? NODE_MUTED : CLUSTER_PALETTE[index % CLUSTER_PALETTE.length];
};

type Relation = {
  edgeId: string;
  edgeType: string;
  derived: boolean;
  neighbor: GraphNode;
  outgoing: boolean;
};

type GraphNodeItem = {
  id: string;
  label: string;
  color: string;
  shape: string;
  size: number;
  font: { color: string; face: string; size: number };
  borderWidth: number;
  borderColor: string;
  hidden: boolean;
};

type GraphEdgeItem = {
  id: string;
  from: string;
  to: string;
  label: string;
  derived: boolean;
  color: { color: string; highlight: string };
  arrows?: { to: { enabled: boolean; scaleFactor: number } };
  dashes?: number[];
  font: { color: string; face: string; size: number };
  hidden: boolean;
};

export function GraphViewer({ graph }: { graph: Graph }) {
  const container = useRef<HTMLDivElement>(null);
  const network = useRef<Network | null>(null);
  const nodeDataSet = useRef<DataSet<GraphNodeItem> | null>(null);
  const edgeDataSet = useRef<DataSet<GraphEdgeItem> | null>(null);
  const [query, setQuery] = useState('');
  const [showDerived, setShowDerived] = useState(true);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [relations, setRelations] = useState<Relation[]>([]);

  const derivedCount = useMemo(
    () => graph.edges.filter((edge) => edge.derived).length,
    [graph.edges],
  );

  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // Degree drives node size: hub nodes physically dominate (the quantitative
    // trick Graphify uses), with a floor so low-degree nodes stay selectable.
    // Degree counts both directions over ALL edges, matching the cluster hub
    // logic that named the clusters.
    const degree = new Map<string, number>();
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const nodes: DataSet<GraphNodeItem> = new DataSet(
      graph.nodes.map((node) => {
        const color = clusterColorFor(graph.clusters, node.id);
        return {
          id: node.id,
          label: node.name,
          color,
          shape: SHAPE_BY_TYPE[node.type] ?? 'dot',
          size: 12 + Math.min(24, Math.sqrt(degree.get(node.id) ?? 0) * 5),
          font: { color: '#e8e6f1', face: 'Arial', size: 12 },
          borderWidth: 1,
          borderColor: '#150f23',
          hidden: false,
        };
      }),
    );
    const edges: DataSet<GraphEdgeItem> = new DataSet(
      graph.edges.map((edge) => {
        const item: GraphEdgeItem = {
          id: edge.id,
          from: edge.source,
          to: edge.target,
          label: edge.type,
          derived: edge.derived,
          color: {
            color: edge.derived ? DERIVED_COLOR : EDGE_COLOR,
            highlight: edge.derived ? DERIVED_COLOR : EDGE_COLOR,
          },
          font: { color: '#9a97aa', face: 'Arial', size: 9 },
          hidden: false,
        };
        if (!edge.derived) item.arrows = { to: { enabled: true, scaleFactor: 0.5 } };
        else item.dashes = [4, 3];
        return item;
      }),
    );
    nodeDataSet.current = nodes;
    edgeDataSet.current = edges;
    const instance = new Network(
      el,
      { nodes, edges },
      {
        interaction: {
          hover: true,
          tooltipDelay: 150,
          navigationButtons: false,
        },
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -6000,
            centralGravity: 0.06,
            damping: 0.28,
            springLength: 120,
            springConstant: 0.04,
            avoidOverlap: 0.3,
          },
          maxVelocity: 30,
        },
      },
    );
    network.current = instance;
    instance.on('click', (params) => {
      const id = params.nodes[0];
      if (typeof id !== 'string') {
        setSelected(null);
        setRelations([]);
        return;
      }
      const node = nodesById.get(id) ?? null;
      setSelected(node);
      if (!node) {
        setRelations([]);
        return;
      }
      const incident = graph.edges
        .filter((edge) => edge.source === id || edge.target === id)
        .map((edge) => {
          const neighborId = edge.source === id ? edge.target : edge.source;
          return {
            edgeId: edge.id,
            edgeType: edge.type,
            derived: edge.derived,
            neighbor: nodesById.get(neighborId),
            outgoing: edge.source === id,
          };
        })
        .filter((entry) => entry.neighbor)
        .map(({ edgeId, edgeType, derived, neighbor, outgoing }) => ({
          edgeId,
          edgeType,
          derived,
          neighbor: neighbor as GraphNode,
          outgoing,
        }));
      setRelations(incident);
    });
    return () => instance.destroy();
  }, [graph, nodesById]);

  // Search + derived-toggle ride the DataSets directly: hiding nodes/edges is
  // cheaper than rebuilding the Network, and physics state survives the filter.
  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    for (const node of nodeDataSet.current?.get() ?? []) {
      const matches = !needle || (node.label as string).toLocaleLowerCase().includes(needle);
      if (node.hidden !== !matches) nodeDataSet.current?.update({ id: node.id, hidden: !matches });
    }
    for (const edge of edgeDataSet.current?.get() ?? []) {
      // An edge stays invisible while its endpoints are filtered out OR the
      // implied-edge toggle is off. Deriving visibility here keeps the render
      // consistent without rebuilding the data objects.
      const fromHidden = nodeDataSet.current?.get(edge.from)?.hidden ?? false;
      const toHidden = nodeDataSet.current?.get(edge.to)?.hidden ?? false;
      const derivedHidden = edge.derived && !showDerived;
      const hidden = fromHidden || toHidden || derivedHidden;
      if (edge.hidden !== hidden) edgeDataSet.current?.update({ id: edge.id, hidden });
    }
    network.current?.redraw();
  }, [query, showDerived]);

  return (
    <div className="graph-area">
      <div className="graph-toolbar">
        <input
          className="toolbar-search"
          type="search"
          placeholder="Search nodes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search graph nodes"
        />
        <button
          type="button"
          className={`toolbar-toggle${showDerived ? ' active' : ''}`}
          onClick={() => setShowDerived((current) => !current)}
          title={showDerived ? 'Hide implied edges' : 'Show implied edges'}
        >
          {showDerived ? `Hide implied (${derivedCount})` : `Show implied (${derivedCount})`}
        </button>
        <button type="button" className="toolbar-toggle" onClick={() => network.current?.fit()}>
          Fit
        </button>
      </div>
      <div className="graph-layout">
        <div>
          <div className="graph" ref={container} aria-label="Extracted threat knowledge graph" />
          <div className="legend" aria-label="Cluster legend">
            {graph.clusters.map((cluster, index) => (
              <span className="legend-item" key={cluster.id}>
                <span
                  className="legend-swatch"
                  style={{ background: CLUSTER_PALETTE[index % CLUSTER_PALETTE.length] }}
                />
                {cluster.label}
              </span>
            ))}
            {graph.clusters.length === 0 && <span className="muted">No clusters yet</span>}
          </div>
        </div>
        <aside className="inspector" aria-live="polite">
          {selected ? (
            <>
              <p className="kind">{selected.type}</p>
              <h3>{selected.name}</h3>
              <p className="meta">
                confidence {formatPercent(selected.confidence)}
                {selected.aliases && selected.aliases.length > 0
                  ? ` · ${selected.aliases.join(', ')}`
                  : ''}
              </p>
              {selected.evidence && <div className="evidence">{selected.evidence}</div>}
              <ul className="relations">
                {relations.map((relation) => (
                  <li key={relation.edgeId}>
                    <span className="arrow">{relation.outgoing ? '→' : '←'}</span>
                    <span>{relation.neighbor.name}</span>
                    <span className="badge">{relation.edgeType}</span>
                    {relation.derived ? <span className="badge derived">inferred</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="meta">Select a node to see its detail and connections.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
