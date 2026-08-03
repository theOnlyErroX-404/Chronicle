import { extractCandidates, ExtractionFailureError } from "@/modules/extraction";
import { getLlmClient } from "@/modules/extraction/llm-client";
import { ingestReport, type IngestionSource } from "@/modules/ingestion";
import { buildGraph, buildStixLiteBundle, completeEntityEndpoints } from "@/modules/knowledge-modeling";
import { ChronicleError } from "@/modules/shared/errors";
import { reportStore } from "@/modules/shared/report-store";

export type ProcessReportOptions = {
  onProgress?: (progress: string) => void;
};

export const processReport = async (reportId: string, source: IngestionSource, options: ProcessReportOptions = {}) => {
  const setProgress = (text: string) => {
    reportStore.update(reportId, { progress: text });
    options.onProgress?.(text);
  };

  const fail = (error: unknown, partial = false) => {
    const safeMessage = error instanceof ChronicleError
      ? error.message
      : "The report could not be fully processed.";
    console.error(`[report ${reportId}] processing failed:`, error);
    reportStore.update(reportId, { status: "failed", errorMessage: safeMessage, partial });
  };

  try {
    const client = getLlmClient();
    await client.checkHealth?.();
    reportStore.update(reportId, { status: "ingesting", errorMessage: undefined, partial: undefined, progress: "ingesting" });
    const rawText = await ingestReport(source);
    reportStore.update(reportId, { rawText, status: "extracting", progress: "extracting" });

    const extraction = await extractCandidates(rawText, client, {
      onProgress: ({ current, total }) => setProgress(`chunk ${current}/${total}`),
    });
    const completed = completeEntityEndpoints(extraction);
    reportStore.update(reportId, { extraction: completed, status: "modeling", progress: "modeling" });

    const graph = buildGraph(completed);
    const stixBundle = buildStixLiteBundle(reportId, graph);
    reportStore.update(reportId, { graph, stixBundle, status: "done", partial: undefined, progress: undefined });
  } catch (error) {
    if (error instanceof ExtractionFailureError) {
      // Partial success: a late chunk failed, but earlier chunks extracted fine.
      // Surface a partial graph/STIX bundle rather than discarding everything.
      const completed = completeEntityEndpoints(error.partial);
      const graph = buildGraph(completed);
      const stixBundle = buildStixLiteBundle(reportId, graph);
      reportStore.update(reportId, {
        extraction: completed,
        graph,
        stixBundle,
        status: "failed",
        partial: true,
        errorMessage: "Extraction completed partially: some segments failed, results below are incomplete.",
        progress: undefined,
      });
      console.error(`[report ${reportId}] partial extraction failure:`, error);
      return;
    }
    fail(error);
  }
};
