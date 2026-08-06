'use client';

import { FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';
import type { CorrectionInput, Graph } from '@/modules/shared/contracts';
import {
  formatBytes,
  JOB_STAGE_LABELS,
  jobStage,
  MAX_REPORT_BYTES,
  type Selection,
} from '@/lib/presentation';
import { GraphViewer } from '@/components/graph-viewer';
import { Inspector } from '@/components/report-inspector';
import { AttckView, ExportView, TimelineView } from '@/components/report-panels';

type Job = { id: string; status: string; progress?: string; partial?: boolean; error?: string };

type Session = 'unknown' | 'ok' | 'out';

type View = 'graph' | 'timeline' | 'attck' | 'export';

type Submission = { kind: 'url'; url: string } | { kind: 'pdf'; file: File };

const urlSchema = z.url('Provide a valid report URL.');

const apiError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  return payload.detail ?? `Request failed with HTTP ${response.status}.`;
};

export function ReportWorkbench() {
  const [mode, setMode] = useState<'url' | 'pdf'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loginToken, setLoginToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<Session>('unknown');
  const [job, setJob] = useState<Job | null>(null);
  const [lastSubmission, setLastSubmission] = useState<Submission | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [view, setView] = useState<View>('graph');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rejectedNodes, setRejectedNodes] = useState<Set<string>>(new Set());
  const [rejectedEdges, setRejectedEdges] = useState<Set<string>>(new Set());
  const [renames, setRenames] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState(
    'Submit a public threat report URL or PDF to begin analysis.',
  );

  const active = Boolean(job && !['done', 'failed'].includes(job.status));
  const activeJob = active && job ? job : null;
  const activeStage = activeJob ? jobStage(activeJob.status, activeJob.progress) : null;

  // Persist an analyst correction to the feedback log, then apply it locally so
  // the graph reflects the review without a refresh: rejected entities/edges
  // disappear from the canvas, corrected names relabel the node.
  const review = async (input: CorrectionInput): Promise<boolean> => {
    if (!reportId) return false;
    try {
      const response = await fetch(`/api/v1/reports/${reportId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (response.status === 401) {
        setSession('out');
        return false;
      }
      if (!response.ok) {
        setMessage(await apiError(response));
        return false;
      }
      if (input.action === 'reject' && input.targetType === 'entity') {
        setRejectedNodes((current) => new Set(current).add(input.targetId));
      } else if (input.action === 'reject' && input.targetType === 'relationship') {
        setRejectedEdges((current) => new Set(current).add(input.targetId));
      } else if (input.action === 'correct' && input.targetType === 'entity') {
        const correctedName = input.correctedValue?.name;
        if (typeof correctedName === 'string') {
          setRenames((current) => new Map(current).set(input.targetId, correctedName));
        }
      }
      return true;
    } catch {
      setMessage('Could not save the correction.');
      return false;
    }
  };

  // The session cookie is HttpOnly (invisible to JS) and SameSite=Strict, so
  // the token never touches the page. Probe the explicit session route: 401
  // means no session, 200 means the cookie authenticated.
  const probeSession = async (): Promise<Session> => {
    try {
      const response = await fetch('/api/v1/auth/session-probe');
      return response.status === 401 ? 'out' : 'ok';
    } catch {
      return 'out';
    }
  };
  useEffect(() => {
    let active0 = true;
    void probeSession().then((state) => {
      if (active0) setSession(state);
    });
    return () => {
      active0 = false;
    };
  }, []);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setSession('out');
    setJob(null);
    setLastSubmission(null);
    setReportId(null);
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
            : `${jobStage(next.status, next.progress).label} · ${next.status}`,
        );
        const finished = next.status === 'done' || (next.status === 'failed' && next.partial);
        if (finished && next.id !== reportId) {
          setReportId(next.id);
          const graphResponse = await fetch(`/api/v1/reports/${next.id}/graph`);
          if (graphResponse.ok) setGraph((await graphResponse.json()) as Graph);
        }
      } catch {
        setMessage('Connection lost while polling. Is the server still running?');
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [job, reportId, session]);

  const post = async (submission: Submission): Promise<boolean> => {
    let response: Response;
    if (submission.kind === 'url') {
      response = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: submission.url }),
      });
    } else {
      const data = new FormData();
      data.set('file', submission.file);
      response = await fetch('/api/v1/reports', { method: 'POST', body: data });
    }
    if (response.status === 401) {
      setSession('out');
      return false;
    }
    if (!response.ok) {
      setMessage(await apiError(response));
      return false;
    }
    const created = (await response.json()) as { report_id: string; status: string };
    setLastSubmission(submission);
    setJob({ id: created.report_id, status: created.status });
    setReportId(null);
    setGraph(null);
    setSelection(null);
    setRejectedNodes(new Set());
    setRejectedEdges(new Set());
    setRenames(new Map());
    setMessage('Report accepted. Analysis is in progress.');
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (active) return;
    if (mode === 'url') {
      const parsed = urlSchema.safeParse(url.trim());
      if (!parsed.success) return setMessage(parsed.error.issues[0]?.message ?? 'Invalid URL.');
      await post({ kind: 'url', url: parsed.data });
    } else if (file) {
      await post({ kind: 'pdf', file });
    } else {
      setMessage('Choose a PDF file to analyze.');
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
      {activeJob && activeStage && (
        <div className="job-status" role="status" aria-live="polite">
          <ol className="job-stages" aria-label="Analysis progress">
            {JOB_STAGE_LABELS.map((stage) => {
              const currentIndex = JOB_STAGE_LABELS.findIndex((item) => item.key === stage.key);
              const jobIndex = JOB_STAGE_LABELS.findIndex((item) => item.key === activeStage.stage);
              const state =
                jobIndex === -1
                  ? 'pass'
                  : currentIndex < jobIndex
                    ? 'pass'
                    : currentIndex === jobIndex
                      ? 'current'
                      : 'todo';
              return (
                <li key={stage.key} className={state}>
                  <span className="job-dot" aria-hidden="true" />
                  <span className="job-stage-label">{stage.label}</span>
                </li>
              );
            })}
          </ol>
          <p className="status">{activeStage.label}</p>
        </div>
      )}
      <form onSubmit={submit} className="submission-form">
        <div className="source-toggle" role="group" aria-label="Report source">
          <button
            type="button"
            className={`toolbar-toggle${mode === 'url' ? ' active' : ''}`}
            aria-pressed={mode === 'url'}
            onClick={() => setMode('url')}
          >
            Public URL
          </button>
          <button
            type="button"
            className={`toolbar-toggle${mode === 'pdf' ? ' active' : ''}`}
            aria-pressed={mode === 'pdf'}
            onClick={() => setMode('pdf')}
          >
            PDF file
          </button>
        </div>
        {mode === 'url' ? (
          <label htmlFor="report-url">
            Public report URL
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
          </label>
        ) : (
          <label htmlFor="report-file">
            Threat report PDF (max {formatBytes(MAX_REPORT_BYTES)})
            <input
              id="report-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUrl('');
              }}
            />
          </label>
        )}
        <div className="form-actions">
          <button type="submit" disabled={active}>
            Analyze report
          </button>
          {job?.status === 'failed' && lastSubmission ? (
            <button
              type="button"
              className="toolbar-toggle retry"
              onClick={() => void post(lastSubmission)}
            >
              Retry
            </button>
          ) : null}
          <button type="button" className="sign-out" onClick={logout}>
            Sign out
          </button>
        </div>
      </form>
      <p className="status" role="status">
        {message}
      </p>
      {graph && reportId && (
        <>
          <div className="graph-heading">
            <div>
              <h2>Extracted knowledge graph</h2>
              <span className="file-numbers mono">
                {graph.nodes.length} entities · {graph.edges.length} relationships ·{' '}
                {graph.clusters.length} clusters
              </span>
            </div>
            <span className="tlp mono">TLP:CLEAR</span>
          </div>
          <nav className="view-tabs" aria-label="Report views">
            {(['graph', 'timeline', 'attck', 'export'] as View[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`view-tab${view === candidate ? ' active' : ''}`}
                aria-pressed={view === candidate}
                onClick={() => {
                  setView(candidate);
                  if (candidate !== 'graph') setSelection(null);
                }}
              >
                {candidate === 'graph'
                  ? 'Graph'
                  : candidate === 'export'
                    ? 'Export'
                    : candidate.toUpperCase()}
              </button>
            ))}
          </nav>
          {view === 'export' ? (
            <ExportView reportId={reportId} />
          ) : (
            <div className="view-layout">
              <div className="view-main">
                {view === 'graph' && (
                  <GraphViewer
                    graph={graph}
                    onSelect={(node) => setSelection(node ? { kind: 'node', node } : null)}
                    hiddenNodes={rejectedNodes}
                    hiddenEdges={rejectedEdges}
                    renames={renames}
                  />
                )}
                {view === 'timeline' && (
                  <TimelineView
                    reportId={reportId}
                    onSelect={(event) => setSelection({ kind: 'timeline', event })}
                  />
                )}
                {view === 'attck' && (
                  <AttckView
                    reportId={reportId}
                    onSelect={(mapping) => setSelection({ kind: 'attck', mapping })}
                  />
                )}
              </div>
              <Inspector
                selection={selection}
                graph={graph}
                hiddenNodes={rejectedNodes}
                hiddenEdges={rejectedEdges}
                renames={renames}
                onReview={review}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
