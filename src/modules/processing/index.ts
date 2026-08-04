// Public surface of the processing context: external code enqueues reports and
// reads status; it never touches queue internals directly.
export { processReport } from "@/modules/processing/process-report";
export { jobQueue, createJobQueue, JOB_QUEUE_NAME, createBullMqWorker } from "@/modules/processing/queue";
export type { JobQueue, QueueJob, StoredQueueJob } from "@/modules/processing/queue";
