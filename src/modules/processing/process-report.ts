import {
  createCircuitBreaker,
  extractCandidates,
  ExtractionFailureError,
  getLlmClient,
} from '@/modules/extraction';
import { ingestReport, type IngestionSource } from '@/modules/ingestion';
import { matchExplicitTechniques } from '@/modules/attck';
import { extractTimelineEvents } from '@/modules/timeline';
import {
  buildGraph,
  buildStixLiteBundle,
  completeEntityEndpoints,
} from '@/modules/knowledge-modeling';
import { ChronicleError } from '@/modules/shared/errors';
import { reportStore } from '@/modules/shared/report-store';

export const processReport = async (reportId: string, source: IngestionSource) => {
  // Log the message only, not the error object: errors can carry LLM/provider
  // response detail and report excerpts that logs should not retain.
  const logError = (context: string, error: unknown) =>
    console.error(
      '[report %s] %s:',
      reportId,
      context,
      error instanceof Error ? error.message : error,
    );

  const setProgress = async (text: string) => {
    await reportStore.update(reportId, { progress: text });
  };

  // Cancellation is a status, not a flag: POST /jobs/[id]/cancel flips the
  // durable status to 'cancelled' (both backends persist it), and this pipeline
  // polls it between stages. Throwing here aborts the LLM loop at the next
  // chunk boundary instead of letting a 5-minute chunk ride out.
  const cancelError = async (): Promise<never> => {
    throw new Error('cancelled');
  };

  const checkCancelled = async () => {
    if ((await reportStore.get(reportId))?.status === 'cancelled') await cancelError();
  };

  // A status transition that must not clobber a concurrent cancel: re-reads the
  // durable status immediately before writing, so a cancel that arrived between
  // two stage writes wins instead of being overwritten by the pipeline.
  const checkpoint = async (patch: Parameters<typeof reportStore.update>[1]): Promise<void> => {
    await checkCancelled();
    await reportStore.update(reportId, patch);
  };

  // Persist the terminal status the cancel happened, preserving nothing further
  // computed by the aborted run (no partial flag: the user asked to stop).
  const abortForCancellation = async () => {
    try {
      await reportStore.update(reportId, {
        status: 'cancelled',
        errorMessage: 'Analysis cancelled by the user.',
        progress: undefined,
        partial: undefined,
      });
    } catch (storeError) {
      logError('failed to persist cancelled state', storeError);
    }
  };

  const fail = async (error: unknown, partial = false) => {
    const safeMessage =
      error instanceof ChronicleError ? error.message : 'The report could not be fully processed.';
    logError('processing failed', error);
    try {
      await reportStore.update(reportId, { status: 'failed', errorMessage: safeMessage, partial });
    } catch (storeError) {
      logError('failed to persist failure state', storeError);
    }
    // Rethrow after persisting so the queue layer sees the failure: BullMQ then
    // marks the job failed (and keeps it in the failed-retention window) instead
    // of recording a misleading "completed" for a report whose status is failed.
    throw error;
  };

  try {
    // Stop before touching anything if the user cancelled while queued.
    await checkCancelled();

    const client = getLlmClient();
    await client.checkHealth();
    await checkpoint({
      status: 'ingesting',
      errorMessage: undefined,
      partial: undefined,
      progress: 'ingesting',
    });
    const rawText = await ingestReport(source);
    // ATT&CK mapping and the timeline need only the raw text (no LLM), so
    // compute both here — they then survive a later cancellation-free failure
    // instead of being lost. Timeline relative terms anchor to the earliest
    // exact date in the text (fallback: submission time).
    await checkCancelled();
    const attck = matchExplicitTechniques(rawText);
    const timeline = extractTimelineEvents(rawText);
    await checkpoint({
      rawText,
      attck,
      timeline,
      status: 'extracting',
      progress: 'extracting',
    });

    const extraction = await extractCandidates(rawText, client, {
      // Poll the flag on every chunk-pass report; this is where a slow run
      // gets aborted between chunks rather than after the whole model pass.
      onProgress: async (progress) => {
        await checkCancelled();
        await setProgress(`chunk ${progress.current}/${progress.total}`);
      },
      // One breaker per report, shared across both passes: after repeated
      // consecutive failures the LLM server gets a cooldown instead of a
      // sustained hammering from retries.
      breaker: createCircuitBreaker(),
    });
    await checkCancelled();
    const completed = completeEntityEndpoints(extraction);
    await checkpoint({
      extraction: { ...completed, stats: extraction.stats },
      status: 'modeling',
      progress: 'modeling',
    });

    const graph = buildGraph(completed);
    const stixBundle = buildStixLiteBundle(reportId, graph);
    await checkpoint({
      graph,
      stixBundle,
      status: 'done',
      partial: undefined,
      progress: undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'cancelled') {
      await abortForCancellation();
      return;
    }
    if (error instanceof ExtractionFailureError) {
      // Partial success: a late chunk failed, but earlier chunks extracted fine.
      // Surface a partial graph/STIX bundle rather than discarding everything.
      const completed = completeEntityEndpoints(error.partial);
      const graph = buildGraph(completed);
      const stixBundle = buildStixLiteBundle(reportId, graph);
      try {
        await reportStore.update(reportId, {
          extraction: { ...completed, stats: error.partial.stats },
          graph,
          stixBundle,
          status: 'failed',
          partial: true,
          errorMessage:
            'Extraction completed partially: some segments failed, results below are incomplete.',
          progress: undefined,
        });
      } catch (storeError) {
        logError('failed to persist partial state', storeError);
      }
      logError('partial extraction failure', error);
      return;
    }
    await fail(error);
  }
};
