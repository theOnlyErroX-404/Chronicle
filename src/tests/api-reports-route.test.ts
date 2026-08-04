import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/reports/route";
import { config } from "@/lib/config";
import { processReport } from "@/modules/processing/process-report";
import { jobQueue } from "@/modules/processing/queue";

vi.mock("@/lib/config", () => ({ config: { maxReportBytes: 100, apiToken: undefined } }));
vi.mock("@/modules/processing/process-report", () => ({ processReport: vi.fn(async () => {}) }));

const base = "http://chronicle.local/api/v1/reports";

const jsonRequest = (body: unknown) =>
  new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const pdfRequest = (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return new Request(base, { method: "POST", body: formData });
};

describe("POST /api/v1/reports (Zod at the boundary)", () => {
  let enqueueSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    enqueueSpy = vi.spyOn(jobQueue, "enqueue");
    vi.mocked(processReport).mockClear();
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
  });

  it("accepts a valid JSON URL submission with 202", async () => {
    const response = await POST(jsonRequest({ url: "https://example.com/report.txt" }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.report_id).toEqual(expect.any(String));
    expect(body.status).toBe("queued");
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-URL string with 400", async () => {
    const response = await POST(jsonRequest({ url: "not-a-url" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400 });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing url with 400", async () => {
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(400);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-string url with 400", async () => {
    const response = await POST(jsonRequest({ url: 42 }));
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await POST(new Request(base, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ detail: "The request body must be valid JSON." });
  });

  it("rejects an oversized JSON body with 413 while streaming", async () => {
    const longUrl = `https://example.com/${"x".repeat(200)}`;
    const response = await POST(jsonRequest({ url: longUrl }));
    expect(response.status).toBe(413);
  });

  it("rejects a non-JSON, non-multipart content type with 415", async () => {
    const response = await POST(new Request(base, { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }));
    expect(response.status).toBe(415);
  });

  it("accepts a valid PDF upload with 202", async () => {
    const response = await POST(pdfRequest(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "r.pdf", { type: "application/pdf" })));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.report_id).toEqual(expect.any(String));
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or non-file field with 400", async () => {
    const formData = new FormData();
    formData.append("file", "not a file");
    const response = await POST(new Request(base, { method: "POST", body: formData }));
    expect(response.status).toBe(400);
  });

  it("rejects an oversized PDF with 413", async () => {
    const response = await POST(pdfRequest(new File([new Uint8Array(config.maxReportBytes + 1)], "big.pdf", { type: "application/pdf" })));
    expect(response.status).toBe(413);
  });

  it("rejects a non-PDF file type with 415", async () => {
    const response = await POST(pdfRequest(new File([new Uint8Array(4)], "x.txt", { type: "text/plain" })));
    expect(response.status).toBe(415);
  });
});
