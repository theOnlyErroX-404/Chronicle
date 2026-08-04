import { config } from "@/lib/config";
import { processReport } from "@/modules/processing/process-report";
import type { IngestionSource } from "@/modules/ingestion";
import { createBullMqQueue } from "@/modules/processing/bullmq-queue";

// Serialized form of a processing request, kept JSON-safe so a Redis/BullMQ
// backend can persist it (PDF bytes ride along; the queue backend base64s them
// for the wire). jobToSource maps it back to the IngestionSource the pipeline
// expects.
export type QueueJob =
  | { reportId: string; kind: "url"; url: string }
  | { reportId: string; kind: "pdf"; filename: string; bytes: Uint8Array };

export const jobToSource = (job: QueueJob): IngestionSource =>
  job.kind === "url"
    ? { kind: "url", url: job.url }
    : { kind: "pdf", filename: job.filename, bytes: job.bytes };

export interface JobQueue {
  enqueue(job: QueueJob): void;
  pending(): Promise<number>;
  running(): Promise<boolean>;
}

// Phase 1 in-memory queue, concurrency 1. CPU-bound extraction is the
// bottleneck on this hardware, so serializing jobs keeps latency predictable.
// The JobQueue interface is the seam where the Redis/BullMQ durable worker
// drops in without touching callers.
class InMemoryJobQueue implements JobQueue {
  private readonly tasks: Array<() => Promise<void>> = [];
  private busy = false;

  enqueue(job: QueueJob): void {
    this.tasks.push(() => processReport(job.reportId, jobToSource(job)));
    void this.pump();
  }

  async pending(): Promise<number> {
    return this.tasks.length;
  }

  async running(): Promise<boolean> {
    return this.busy;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const task = this.tasks.shift();
    if (!task) return;
    this.busy = true;
    try {
      await task();
    } catch (error) {
      console.error("[queue] job threw an unhandled error:", error);
    } finally {
      this.busy = false;
      void this.pump();
    }
  }
}

export const createJobQueue = (): JobQueue => {
  if (config.jobQueueBackend === "redis") {
    if (!config.redisUrl) {
      throw new Error("JOB_QUEUE_BACKEND=redis requires REDIS_URL to be set.");
    }
    return createBullMqQueue(config.redisUrl);
  }
  return new InMemoryJobQueue();
};

declare global {
  var chronicleJobQueue: JobQueue | undefined;
}

export const jobQueue: JobQueue = globalThis.chronicleJobQueue ?? createJobQueue();
if (process.env.NODE_ENV !== "production") globalThis.chronicleJobQueue = jobQueue;
