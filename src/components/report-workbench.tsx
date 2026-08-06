'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { Graph } from '@/modules/shared/contracts';
import { ENTITY_TYPE_COLORS, formatBytes, MAX_REPORT_BYTES } from '@/lib/presentation';

type Job = { id: string; status: string; progress?: string; partial?: boolean; error?: string };

type Session = 'unknown' | 'ok' | 'out';

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
  const [loginToken, setLoginToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<Session>('unknown');
  const [job, setJob] = useState<Job | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [message, setMessage] = useState(
    'Submit a public threat report URL or PDF to begin analysis.',
  );

  // The session cookie is HttpOnly (invisible to JS) and SameSite=Strict, so
  // the token never touches the page. Probe a nonexistent report: 401 means no
  // session, 404 means the cookie authenticated and the report is just missing.
  const probeSession = async (): Promise<Session> => {
    try {
      const response = await fetch('/api/v1/reports/session-probe');
      return response.status === 401 ? 'out' : 'ok';
    } catch {
      return 'out';
    }
  };
  useEffect(() => {
    let active = true;
    void probeSession().then((state) => {
      if (active) setSession(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setSession('out');
    setJob(null);
    setGraph(null);
    setMessage('Signed out.');
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError('');
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: loginToken }),
    });
    if (response.status === 204) {
      setLoginToken('');
      setSession((await probeSession()) === 'ok' ? 'ok' : 'out');
      setMessage('Signed in. Submit a report to begin.');
      return;
    }
    setLoginError(await apiError(response));
  };

  useEffect(() => {
    if (!job || ['done', 'failed'].includes(job.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/jobs/${job.id}`);
        if (response.status === 401) return setSession('out');
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
      } catch {
        setMessage('Connection lost while polling. Is the server still running?');
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [job, session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() && !file) return setMessage('Choose either a public URL or a PDF.');
    setGraph(null);
    setMessage('Submitting report…');
    try {
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
      if (response.status === 401) return setSession('out');
      if (!response.ok) return setMessage(await apiError(response));
      const created = (await response.json()) as { report_id: string; status: string };
      setJob({ id: created.report_id, status: created.status });
      setMessage('Report accepted. Analysis is in progress — the graph appears when it finishes.');
    } catch {
      setMessage('Could not reach the server. Is it running?');
    }
  };

  if (session === 'unknown') {
    return (
      <section className="workbench">
        <p className="status" role="status">
          Checking session…
        </p>
      </section>
    );
  }

  if (session === 'out') {
    return (
      <section className="workbench">
        <form onSubmit={login} className="submission-form">
          <label htmlFor="api-token">API token</label>
          <input
            id="api-token"
            value={loginToken}
            onChange={(event) => setLoginToken(event.target.value)}
            placeholder="CHRONICLE_API_TOKEN from .env"
            type="password"
            autoComplete="off"
            required
          />
          <button type="submit">Sign in</button>
        </form>
        <p className="status" role="status">
          {loginError || 'Sign in to access the analyzer.'}
        </p>
      </section>
    );
  }

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
        <button type="button" className="sign-out" onClick={logout}>
          Sign out
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
