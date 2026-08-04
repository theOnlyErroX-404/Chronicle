import { config } from "@/lib/config";
import { extractCandidates } from "@/modules/extraction";
import { getLlmClient } from "@/modules/extraction/llm-client";
import { GOLDEN_REPORTS } from "@/evaluation/golden-set";
import { evaluate, type EvaluationResult } from "@/evaluation/scoring";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const printResult = (result: EvaluationResult) => {
  const header = `${"report".padEnd(26)} ${"entities P".padStart(12)} ${"entities R".padStart(12)} ${"entities F1".padStart(12)} ${"rels P".padStart(12)} ${"rels R".padStart(12)} ${"rels F1".padStart(12)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const report of result.perReport) {
    const e = report.entities;
    const r = report.relationships;
    console.log(
      `${report.reportId.padEnd(26)} ${percent(e.precision).padStart(12)} ${percent(e.recall).padStart(12)} ${percent(e.f1).padStart(12)} ${percent(r.precision).padStart(12)} ${percent(r.recall).padStart(12)} ${percent(r.f1).padStart(12)}`,
    );
  }
  console.log("-".repeat(header.length));
  const e = result.entities;
  const r = result.relationships;
  console.log(
    `${"TOTAL".padEnd(26)} ${percent(e.precision).padStart(12)} ${percent(e.recall).padStart(12)} ${percent(e.f1).padStart(12)} ${percent(r.precision).padStart(12)} ${percent(r.recall).padStart(12)} ${percent(r.f1).padStart(12)}`,
  );
  console.log(`\nEntities:      ${e.matched}/${e.expected} expected found, ${e.extracted} extracted (precision penalizes extras, recall penalizes misses)`);
  console.log(`Relationships: ${r.matched}/${r.expected} expected found, ${r.extracted} extracted`);
};

const main = async () => {
  const client = getLlmClient();
  await client.checkHealth?.();
  const modelName =
    config.llmProvider === "openai"
      ? config.openAiEndpoints.map((endpoint) => endpoint.chatModel).join(", ") || config.openaiChatModel
      : config.ollamaChatModel;
  console.log(`Evaluating ${GOLDEN_REPORTS.length} golden reports against ${modelName}...`);
  const result = await evaluate(GOLDEN_REPORTS, (text) => extractCandidates(text, client));
  printResult(result);
};

main().catch((error) => {
  console.error("Golden-set evaluation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
