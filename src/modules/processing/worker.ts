// Standalone worker process for the durable queue: npm run worker.
// Pulls process-report jobs from Redis (added by the Next.js process) and runs
// the extraction pipeline. Requires JOB_QUEUE_BACKEND=redis.
import { config } from "@/lib/config";
import { createBullMqWorker, fromStoredJob, JOB_QUEUE_NAME } from "@/modules/processing/bullmq-queue";
import { processReport } from "@/modules/processing/process-report";
import { jobToSource } from "@/modules/processing/queue";

const main = async () => {
  if (config.jobQueueBackend !== "redis" || !config.redisUrl) {
    console.error("The worker requires JOB_QUEUE_BACKEND=redis and REDIS_URL to be set.");
    process.exit(1);
  }

  const worker = createBullMqWorker(config.redisUrl, (job) =>
    processReport(job.data.reportId, jobToSource(fromStoredJob(job.data))),
  );
  console.log(`[worker] listening on "${JOB_QUEUE_NAME}" (redis ${config.redisUrl}), concurrency 1`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal}, draining jobs before exit…`);
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error) => {
  console.error("[worker] startup failed:", error);
  process.exit(1);
});
