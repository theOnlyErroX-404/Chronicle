import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobQueue, jobToSource } from "@/modules/processing/queue";
import { fromStoredJob, toStoredJob } from "@/modules/processing/bullmq-queue";
import { processReport } from "@/modules/processing/process-report";

vi.mock("@/modules/processing/process-report", () => ({ processReport: vi.fn(async () => {}) }));

describe("queue wire format (BullMQ)", () => {
  it("base64-encodes PDF bytes for storage", () => {
    const stored = toStoredJob({ reportId: "r1", kind: "pdf", filename: "a.pdf", bytes: new Uint8Array([37, 80, 68, 70]) });
    expect(stored).toMatchObject({ kind: "pdf", filename: "a.pdf", bytes: "JVBERg==" });
  });

  it("decodes stored bytes back to a Uint8Array", () => {
    const job = fromStoredJob({ reportId: "r1", kind: "pdf", filename: "a.pdf", bytes: "JVBERg==" });
    expect(job.kind).toBe("pdf");
    if (job.kind === "pdf") {
      expect(Array.from(job.bytes)).toEqual([37, 80, 68, 70]);
    }
  });

  it("leaves url jobs untouched", () => {
    expect(fromStoredJob(toStoredJob({ reportId: "r1", kind: "url", url: "https://example.com/a" }))).toEqual({
      reportId: "r1",
      kind: "url",
      url: "https://example.com/a",
    });
  });
});

describe("jobToSource", () => {
  it("maps a url job to the url ingestion source", () => {
    expect(jobToSource({ reportId: "r1", kind: "url", url: "https://example.com/a" })).toEqual({
      kind: "url",
      url: "https://example.com/a",
    });
  });

  it("maps a pdf job to the pdf ingestion source, keeping bytes", () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    expect(jobToSource({ reportId: "r1", kind: "pdf", filename: "a.pdf", bytes })).toEqual({
      kind: "pdf",
      filename: "a.pdf",
      bytes,
    });
  });
});

describe("in-memory job queue", () => {
  afterEach(() => vi.mocked(processReport).mockClear());

  it("processes an enqueued job through processReport", async () => {
    const queue = createJobQueue();
    queue.enqueue({ reportId: "r1", kind: "url", url: "https://example.com/a" });
    await vi.waitFor(() =>
      expect(vi.mocked(processReport)).toHaveBeenCalledWith("r1", { kind: "url", url: "https://example.com/a" }),
    );
  });

  it("runs jobs serially in submission order", async () => {
    const queue = createJobQueue();
    const order: string[] = [];
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    vi.mocked(processReport)
      .mockImplementationOnce(async () => { order.push("a"); await wait(40); order.push("a-done"); })
      .mockImplementationOnce(async () => { order.push("b"); order.push("b-done"); });
    queue.enqueue({ reportId: "r1", kind: "url", url: "https://example.com/a" });
    queue.enqueue({ reportId: "r2", kind: "url", url: "https://example.com/b" });
    await vi.waitFor(() => expect(order).toEqual(["a", "a-done", "b", "b-done"]));
  });

  it("counts queued jobs excluding the running one", async () => {
    const queue = createJobQueue();
    let release!: () => void;
    vi.mocked(processReport).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    queue.enqueue({ reportId: "r1", kind: "url", url: "https://example.com/1" });
    queue.enqueue({ reportId: "r2", kind: "url", url: "https://example.com/2" });
    queue.enqueue({ reportId: "r3", kind: "url", url: "https://example.com/3" });

    await vi.waitFor(async () => expect(await queue.running()).toBe(true));
    expect(await queue.pending()).toBe(2);
    release();
    await vi.waitFor(async () => expect(await queue.pending()).toBe(0));
  });
});
