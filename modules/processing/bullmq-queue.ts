import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { JobQueue, QueueJob } from "@/modules/processing/queue";

export const JOB_QUEUE_NAME = "process-report";

const connection = (redisUrl: string): ConnectionOptions => ({ url: redisUrl });

// Wire format: PDF bytes are base64 (BullMQ's msgpackr serialization does not
// revive Buffers, so storing them raw would corrupt job data on the wire).
export type StoredQueueJob = { reportId: string; kind: "url"; url: string } | { reportId: string; kind: "pdf"; filename: string; bytes?: string };

export const toStoredJob = (job: QueueJob): StoredQueueJob =>
  job.kind === "pdf"
    ? { reportId: job.reportId, kind: "pdf", filename: job.filename, bytes: Buffer.from(job.bytes).toString("base64") }
    : { reportId: job.reportId, kind: "url", url: job.url };

export const fromStoredJob = (stored: StoredQueueJob): QueueJob => {
  if (stored.kind === "pdf") {
    return {
      reportId: stored.reportId,
      kind: "pdf",
      filename: stored.filename,
      bytes: new Uint8Array(Buffer.from(stored.bytes ?? "", "base64")),
    };
  }
  return stored;
};

// Producer side of the durable queue: the Next.js process only adds jobs; a
// separate `npm run worker` process consumes them.
export const createBullMqQueue = (redisUrl: string): JobQueue => {
  // ponytail: completed/failed jobs pruned after 500 each to bound Redis growth;
  // raise if audit trails of past runs become a need.
  const queue = new Queue(JOB_QUEUE_NAME, {
    connection: connection(redisUrl),
    defaultJobOptions: { removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } },
  });

  return {
    enqueue(job: QueueJob): void {
      queue
        .add(job.reportId, toStoredJob(job))
        .catch((error) => console.error("[queue] failed to enqueue job:", error));
    },

    async pending(): Promise<number> {
      const counts = await queue.getJobCounts("waiting", "delayed");
      return (counts.waiting ?? 0) + (counts.delayed ?? 0);
    },

    async running(): Promise<boolean> {
      const counts = await queue.getJobCounts("active");
      return (counts.active ?? 0) > 0;
    },
  };
};

// Consumer: runs in its own process (npm run worker). Concurrency 1 keeps the
// CPU-bound pipeline serialized, matching the in-memory queue's behavior. BullMQ
// auto-renews the job lock while the pipeline runs (LLM extraction can take
// minutes), and a crashed worker's job is re-queued via stalled-job detection.
export const createBullMqWorker = (redisUrl: string, processor: (job: Job<StoredQueueJob>) => Promise<void>) => {
  const worker = new Worker<StoredQueueJob>(JOB_QUEUE_NAME, processor, {
    connection: connection(redisUrl),
    concurrency: 1,
  });

  worker.on("completed", (job) => console.log(`[worker] report ${job.data.reportId} done`));
  worker.on("failed", (job, error) => {
    console.error(`[worker] report ${job?.data.reportId} failed:`, error);
  });
  return worker;
};
