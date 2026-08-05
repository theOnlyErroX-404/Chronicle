import {
  createCircuitBreaker,
  extractCandidates,
  ExtractionFailureError,
  getLlmClient,
} from '@/modules/extraction';
import { ingestReport, type IngestionSource } from '@/modules/ingestion';
import { matchExplicitTechniques } from '@/modules/attck';
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

  const fail = async (error: unknown, partial = false) => {
    const safeMessage =
      error instanceof ChronicleError ? error.message : 'The report could not be fully processed.';
    logError('processing failed', error);
    try {
      await reportStore.update(reportId, { status: 'failed', errorMessage: safeMessage, partial });
    } catch (storeError) {
      logError('failed to persist failure state', storeError);
    }
  };

  try {
    const client = getLlmClient();
    await client.checkHealth?.();
    await reportStore.update(reportId, {
      status: 'ingesting',
      errorMessage: undefined,
      partial: undefined,
      progress: 'ingesting',
    });
    const rawText = await ingestReport(source);
    // ATT&CK mapping needs only the raw text (no LLM), so compute it here — it
    // then survives a later partial-extraction failure instead of being lost.
    const attck = matchExplicitTechniques(rawText);
    await reportStore.update(reportId, {
      rawText,
      attck,
      status: 'extracting',
      progress: 'extracting',
    });

    const extraction = await extractCandidates(rawText, client, {
      onProgress: ({ current, total }) => setProgress(`chunk ${current}/${total}`),
      // One breaker per report, shared across both passes: after repeated
      // consecutive failures the LLM server gets a cooldown instead of a
      // sustained hammering from retries.
      breaker: createCircuitBreaker(),
    });
    const completed = completeEntityEndpoints(extraction);
    await reportStore.update(reportId, {
      extraction: completed,
      status: 'modeling',
      progress: 'modeling',
    });

    const graph = buildGraph(completed);
    const stixBundle = buildStixLiteBundle(reportId, graph);
    await reportStore.update(reportId, {
      graph,
      stixBundle,
      status: 'done',
      partial: undefined,
      progress: undefined,
    });
  } catch (error) {
    if (error instanceof ExtractionFailureError) {
      // Partial success: a late chunk failed, but earlier chunks extracted fine.
      // Surface a partial graph/STIX bundle rather than discarding everything.
      const completed = completeEntityEndpoints(error.partial);
      const graph = buildGraph(completed);
      const stixBundle = buildStixLiteBundle(reportId, graph);
      try {
        await reportStore.update(reportId, {
          extraction: completed,
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
