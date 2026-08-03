// Phase 1 in-memory job queue, concurrency 1. CPU-bound extraction is the
// bottleneck on this hardware, so serializing jobs keeps latency predictable.
// The JobQueue interface is the seam where a Redis/BullMQ durable worker drops
// in for Phase 2 without touching callers.

export interface JobQueue {
  enqueue(task: () => Promise<void>): void;
  pending(): number;
  running(): boolean;
}

class InMemoryJobQueue implements JobQueue {
  private readonly tasks: Array<() => Promise<void>> = [];
  private busy = false;

  enqueue(task: () => Promise<void>): void {
    this.tasks.push(task);
    void this.pump();
  }

  pending(): number {
    return this.tasks.length;
  }

  running(): boolean {
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

declare global {
  var chronicleJobQueue: InMemoryJobQueue | undefined;
}

export const jobQueue: JobQueue = globalThis.chronicleJobQueue ?? new InMemoryJobQueue();
if (process.env.NODE_ENV !== "production") globalThis.chronicleJobQueue = jobQueue as InMemoryJobQueue;
