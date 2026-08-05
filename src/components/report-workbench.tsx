'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { Graph } from '@/modules/shared/contracts';
import { ENTITY_TYPE_COLORS, formatBytes, MAX_REPORT_BYTES } from '@/lib/presentation';

type Job = { id: string; status: string; progress?: string; partial?: boolean; error?: string };

function GraphViewer({ graph }: { graph: Graph }) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const elements: ElementDefinition[] = [
      ...graph.nodes.map((node) => ({
        data: { id: node.id, label: node.name, color: ENTITY_TYPE_COLORS[node.type] ?? '#94a3b8' },
      })),
      ...graph.edges.map((edge) => ({
        data: { id: edge.id, source: edge.source, target: edge.target, label: edge.type },
      })),
    ];
    cy.current = cytoscape({
      container: container.current,
      elements,
      layout: { name: 'cose', animate: false, padding: 32 },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#e2e8f0',
            'font-size': '10px',
            'text-wrap': 'wrap',
            'text-max-width': '110px',
            'text-valign': 'bottom',
            'text-margin-y': 7,
            width: '30px',
            height: '30px',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#475569',
            'target-arrow-color': '#475569',
            'target-arrow-shape': 'triangle',
            label: 'data(label)',
            color: '#94a3b8',
            'font-size': '9px',
            'text-rotation': 'autorotate',
          },
        },
      ],
    });
    return () => cy.current?.destroy();
  }, [graph]);
  return <div className="graph" ref={container} aria-label="Extracted threat knowledge graph" />;
}

const apiError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  return payload.detail ?? `Request failed with HTTP ${response.status}.`;
};

export function ReportWorkbench() {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [message, setMessage] = useState(
    'Submit a public threat report URL or PDF to begin analysis.',
  );

  useEffect(() => {
    if (!job || ['done', 'failed'].includes(job.status)) return;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/v1/jobs/${job.id}`);
      if (!response.ok) return setMessage(await apiError(response));
      const next = (await response.json()) as {
        id: string;
        status: string;
        progress?: string;
        partial?: boolean;
        error?: string;
      };
      setJob(next);
      setMessage(
        next.status === 'failed'
          ? (next.error ?? 'Analysis failed.')
          : `Analysis status: ${next.status}${next.progress ? ` · ${next.progress}` : ''}`,
      );
      const finished = next.status === 'done' || (next.status === 'failed' && next.partial);
      if (finished) {
        const graphResponse = await fetch(`/api/v1/reports/${next.id}/graph`);
        if (graphResponse.ok) setGraph((await graphResponse.json()) as Graph);
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [job]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() && !file) return setMessage('Choose either a public URL or a PDF.');
    setGraph(null);
    setMessage('Submitting report…');
    const response = file
      ? await fetch('/api/v1/reports', {
          method: 'POST',
          body: (() => {
            const data = new FormData();
            data.set('file', file);
            return data;
          })(),
        })
      : await fetch('/api/v1/reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
    if (!response.ok) return setMessage(await apiError(response));
    const created = (await response.json()) as { report_id: string; status: string };
    setJob({ id: created.report_id, status: created.status });
    setMessage('Report accepted. The local Ollama model is now analyzing it.');
  };

  return (
    <section className="workbench">
      <form onSubmit={submit} className="submission-form">
        <label htmlFor="report-url">Public report URL</label>
        <input
          id="report-url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setFile(null);
          }}
          placeholder="https://security.vendor.com/research/report"
          type="url"
        />
        <span className="or">or</span>
        <label htmlFor="report-file">Threat report PDF (max {formatBytes(MAX_REPORT_BYTES)})</label>
        <input
          id="report-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setUrl('');
          }}
        />
        <button type="submit" disabled={Boolean(job && !['done', 'failed'].includes(job.status))}>
          Analyze report
        </button>
      </form>
      <p className="status" role="status">
        {message}
      </p>
      {graph && (
        <>
          <div className="graph-heading">
            <h2>Extracted knowledge graph</h2>
            <span>
              {graph.nodes.length} entities · {graph.edges.length} relationships
            </span>
          </div>
          <GraphViewer graph={graph} />
        </>
      )}
    </section>
  );
}
