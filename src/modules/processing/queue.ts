import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { config } from '@/lib/config';
import { processReport } from '@/modules/processing/process-report';
import type { IngestionSource } from '@/modules/ingestion';

// Serialized form of a processing request, kept JSON-safe so a Redis/BullMQ
// backend can persist it (PDF bytes ride along; the queue backend base64s them
// for the wire). jobToSource maps it back to the IngestionSource the pipeline
// expects.
export type QueueJob =
  | { reportId: string; kind: 'url'; url: string }
  | { reportId: string; kind: 'pdf'; filename: string; bytes: Uint8Array };

export const jobToSource = (job: QueueJob): IngestionSource =>
  job.kind === 'url'
    ? { kind: 'url', url: job.url }
    : { kind: 'pdf', filename: job.filename, bytes: job.bytes };

export interface JobQueue {
  enqueue(job: QueueJob): void;
  pending(): Promise<number>;
  running(): Promise<boolean>;
  close?(): Promise<void>;
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
      console.error('[queue] job threw an unhandled error:', error);
    } finally {
      this.busy = false;
      void this.pump();
    }
  }
}

export const createJobQueue = (): JobQueue => {
  if (config.jobQueueBackend === 'redis') {
    if (!config.redisUrl) {
      throw new Error('JOB_QUEUE_BACKEND=redis requires REDIS_URL to be set.');
    }
    return createBullMqQueue(config.redisUrl);
  }
  return new InMemoryJobQueue();
};

export const JOB_QUEUE_NAME = 'process-report';

const connection = (redisUrl: string): ConnectionOptions => ({ url: redisUrl });

// Wire format: PDF bytes are base64 (BullMQ's msgpackr serialization does not
// revive Buffers, so storing them raw would corrupt job data on the wire).
export type StoredQueueJob =
  | { reportId: string; kind: 'url'; url: string }
  | { reportId: string; kind: 'pdf'; filename: string; bytes?: string };

export const toStoredJob = (job: QueueJob): StoredQueueJob =>
  job.kind === 'pdf'
    ? {
        reportId: job.reportId,
        kind: 'pdf',
        filename: job.filename,
        bytes: Buffer.from(job.bytes).toString('base64'),
      }
    : { reportId: job.reportId, kind: 'url', url: job.url };

export const fromStoredJob = (stored: StoredQueueJob): QueueJob => {
  if (stored.kind === 'pdf') {
    return {
      reportId: stored.reportId,
      kind: 'pdf',
      filename: stored.filename,
      bytes: new Uint8Array(Buffer.from(stored.bytes ?? '', 'base64')),
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
        .catch((error) => console.error('[queue] failed to enqueue job:', error));
    },

    async pending(): Promise<number> {
      const counts = await queue.getJobCounts('waiting', 'delayed');
      return (counts.waiting ?? 0) + (counts.delayed ?? 0);
    },

    async running(): Promise<boolean> {
      const counts = await queue.getJobCounts('active');
      return (counts.active ?? 0) > 0;
    },

    close: () => queue.close(),
  };
};

// Consumer: runs in its own process (npm run worker). Concurrency 1 keeps the
// CPU-bound pipeline serialized, matching the in-memory queue's behavior. BullMQ
// auto-renews the job lock while the pipeline runs (LLM extraction can take
// minutes), and a crashed worker's job is re-queued via stalled-job detection.
export const createBullMqWorker = (
  redisUrl: string,
  processor: (job: Job<StoredQueueJob>) => Promise<void>,
) => {
  const worker = new Worker<StoredQueueJob>(JOB_QUEUE_NAME, processor, {
    connection: connection(redisUrl),
    concurrency: 1,
  });

  worker.on('completed', (job) => console.log(`[worker] report ${job.data.reportId} done`));
  worker.on('failed', (job, error) => {
    console.error(`[worker] report ${job?.data.reportId} failed:`, error);
  });
  return worker;
};

declare global {
  var chronicleJobQueue: JobQueue | undefined;
}

// Initialized last so the queue-backend factory it selects is defined (ES const
// bindings are in the temporal dead zone until their declaration line).
export const jobQueue: JobQueue = globalThis.chronicleJobQueue ?? createJobQueue();
if (process.env.NODE_ENV !== 'production') globalThis.chronicleJobQueue = jobQueue;
