'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type {
  AttckMapping,
  CorrectionInput,
  Graph,
  GraphNode,
  TimelineEvent,
} from '@/modules/shared/contracts';
import { formatBytes, JOB_STAGE_LABELS, jobStage, MAX_REPORT_BYTES } from '@/lib/presentation';
import { GraphViewer } from '@/components/graph-viewer';
import { Inspector } from '@/components/report-inspector';
import { AttckView, ExportView, TimelineView } from '@/components/report-panels';

type Job = { id: string; status: string; progress?: string; partial?: boolean; error?: string };

type Session = 'unknown' | 'ok' | 'out';

type View = 'graph' | 'timeline' | 'attck' | 'export';

type Submission = { kind: 'url'; url: string } | { kind: 'pdf'; file: File };

// One selection slot per view, so picking a timeline event does not wipe the
// node that was under review on the graph tab (and vice versa). The active
// view's slot feeds the shared inspector.
type Selections = {
  node: GraphNode | null;
  timeline: TimelineEvent | null;
  attck: AttckMapping | null;
};

const urlSchema = z.url('Provide a valid report URL.');

const apiError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  return payload.detail ?? `Request failed with HTTP ${response.status}.`;
};

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

export function ReportWorkbench() {
  const [mode, setMode] = useState<'url' | 'pdf'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loginToken, setLoginToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<Session>('unknown');
  const [job, setJob] = useState<Job | null>(null);
  const [lastSubmission, setLastSubmission] = useState<Submission | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [view, setView] = useState<View>('graph');
  const [selections, setSelections] = useState<Selections>({
    node: null,
    timeline: null,
    attck: null,
  });
  const setViewSelection = <K extends keyof Selections>(key: K, value: Selections[K]) =>
    setSelections((current) => ({ ...current, [key]: value }));

  // Stable identity: GraphViewer rebuilds its vis-network instance when this
  // handler's reference changes, so every render used to reset the layout.
  const handleNodeSelect = useCallback(
    (node: GraphNode | null) => setViewSelection('node', node),
    [],
  );
  const [rejectedNodes, setRejectedNodes] = useState<Set<string>>(new Set());
  const [rejectedEdges, setRejectedEdges] = useState<Set<string>>(new Set());
  const [renames, setRenames] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState(
    'Submit a public threat report URL or PDF to begin analysis.',
  );
  const [stopping, setStopping] = useState(false);

  const active = Boolean(job && !TERMINAL_STATUSES.includes(job.status));
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
    if (!job || TERMINAL_STATUSES.includes(job.status)) return;
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
            : next.status === 'cancelled'
              ? 'Analysis cancelled.'
              : `${jobStage(next.status, next.progress).label} · ${next.status}`,
        );
        if (next.status === 'cancelled') setStopping(false);
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
    setSelections({ node: null, timeline: null, attck: null });
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

  // Ask the server to stop the running analysis. The worker aborts between
  // chunks and flips the status; the poll loop surfaces it as 'cancelled'.
  const stopJob = async () => {
    if (!activeJob) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/v1/jobs/${activeJob.id}/cancel`, { method: 'POST' });
      if (response.status === 401) {
        setSession('out');
        return;
      }
      if (!response.ok) {
        setMessage(await apiError(response));
        setStopping(false);
        return;
      }
      setMessage('Stopping analysis…');
    } catch {
      setStopping(false);
      setMessage('Could not reach the server to stop the analysis.');
    }
  };

  // Back to the submission form once a graph is on screen: clears the view
  // state so a fresh report starts clean (the previous run stays in the DB).
  const newAnalysis = () => {
    setJob(null);
    setReportId(null);
    setGraph(null);
    setSelections({ node: null, timeline: null, attck: null });
    setRejectedNodes(new Set());
    setRejectedEdges(new Set());
    setRenames(new Map());
    setMessage('Ready. Submit a new report to begin analysis.');
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
          <button
            type="button"
            className="toolbar-toggle stop"
            disabled={stopping}
            onClick={() => void stopJob()}
          >
            {stopping ? 'Stopping…' : 'Stop analysis'}
          </button>
        </div>
      )}
      {graph && reportId ? (
        <div className="analysis-strip">
          <span className="mono report-id">{reportId.slice(0, 8)}</span>
          <span className="file-numbers">
            {graph.nodes.length} entities · {graph.edges.length} relationships ·{' '}
            {graph.clusters.length} clusters
          </span>
          {job?.status === 'failed' && lastSubmission ? (
            <button
              type="button"
              className="toolbar-toggle retry"
              onClick={() => void post(lastSubmission)}
            >
              Retry
            </button>
          ) : null}
          <button type="button" className="toolbar-toggle" onClick={newAnalysis}>
            New analysis
          </button>
          <button type="button" className="sign-out" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="submission-form">
          <div className="source-toggle" role="group" aria-label="Report source">
            <button
              type="button"
              className={`toolbar-toggle${mode === 'url' ? ' active' : ''}`}
              aria-pressed={mode === 'url'}
              disabled={active}
              onClick={() => setMode('url')}
            >
              Public URL
            </button>
            <button
              type="button"
              className={`toolbar-toggle${mode === 'pdf' ? ' active' : ''}`}
              aria-pressed={mode === 'pdf'}
              disabled={active}
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
                disabled={active}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setFile(null);
                }}
                placeholder="https://security.vendor.com/research/report"
                type="url"
              />
            </label>
          ) : (
            <label
              htmlFor="report-file"
              className={`file-dropzone${file ? ' has-file' : ''}${dragOver ? ' dragover' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                setFile(event.dataTransfer.files?.[0] ?? null);
                setUrl('');
              }}
            >
              <span>{file ? 'Threat report PDF selected' : 'Choose or drop a PDF file'}</span>
              <span className="mono file-dropzone-name">
                {file ? file.name : `max ${formatBytes(MAX_REPORT_BYTES)}`}
              </span>
              <input
                id="report-file"
                type="file"
                accept="application/pdf,.pdf"
                disabled={active}
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
            <button type="button" className="sign-out" disabled={active} onClick={logout}>
              Sign out
            </button>
          </div>
        </form>
      )}
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
            <span className="mono report-id">{reportId.slice(0, 8)}</span>
          </div>
          <nav className="view-tabs" aria-label="Report views">
            {(['graph', 'timeline', 'attck', 'export'] as View[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`view-tab${view === candidate ? ' active' : ''}`}
                aria-pressed={view === candidate}
                onClick={() => setView(candidate)}
              >
                {candidate === 'attck'
                  ? 'ATT&CK'
                  : `${candidate.charAt(0).toUpperCase()}${candidate.slice(1)}`}
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
                    onSelect={handleNodeSelect}
                    hiddenNodes={rejectedNodes}
                    hiddenEdges={rejectedEdges}
                    renames={renames}
                  />
                )}
                {view === 'timeline' && (
                  <TimelineView
                    reportId={reportId}
                    selected={selections.timeline}
                    onSelect={(event) => setViewSelection('timeline', event)}
                  />
                )}
                {view === 'attck' && (
                  <AttckView
                    reportId={reportId}
                    selected={selections.attck}
                    onSelect={(mapping) => setViewSelection('attck', mapping)}
                  />
                )}
              </div>
              <Inspector
                selection={
                  view === 'graph'
                    ? selections.node
                      ? { kind: 'node', node: selections.node }
                      : null
                    : view === 'timeline'
                      ? selections.timeline
                        ? { kind: 'timeline', event: selections.timeline }
                        : null
                      : selections.attck
                        ? { kind: 'attck', mapping: selections.attck }
                        : null
                }
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
