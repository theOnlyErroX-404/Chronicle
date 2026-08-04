import { describe, expect, it } from "vitest";
import { createReportStore } from "@/modules/shared/report-store";

describe("report store eviction", () => {
  it("evicts the oldest non-active report when the cap is exceeded", async () => {
    const store = createReportStore(2);
    const first = await store.create({ sourceType: "url", sourceUrl: "https://example.com/1" });
    const second = await store.create({ sourceType: "url", sourceUrl: "https://example.com/2" });
    await store.update(first.id, { status: "done" });
    await store.update(second.id, { status: "done" });
    const third = await store.create({ sourceType: "url", sourceUrl: "https://example.com/3" });

    expect(await store.get(first.id)).toBeUndefined();
    expect(await store.get(second.id)).toBeDefined();
    expect(await store.get(third.id)).toBeDefined();
  });

  it("never evicts a queued or processing report", async () => {
    const store = createReportStore(2);
    const queued = await store.create({ sourceType: "url", sourceUrl: "https://example.com/queued" });
    const processing = await store.create({ sourceType: "url", sourceUrl: "https://example.com/processing" });
    await store.update(processing.id, { status: "extracting" });
    const third = await store.create({ sourceType: "url", sourceUrl: "https://example.com/3" });

    expect(await store.get(queued.id)).toBeDefined();
    expect(await store.get(processing.id)).toBeDefined();
    expect(await store.get(third.id)).toBeDefined();
  });

  it("evicts failed reports before terminal ones of the same age order", async () => {
    const store = createReportStore(1);
    const failed = await store.create({ sourceType: "url", sourceUrl: "https://example.com/failed" });
    await store.update(failed.id, { status: "failed" });
    const next = await store.create({ sourceType: "url", sourceUrl: "https://example.com/next" });

    expect(await store.get(failed.id)).toBeUndefined();
    expect(await store.get(next.id)).toBeDefined();
  });
});
