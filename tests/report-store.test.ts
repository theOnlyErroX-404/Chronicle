import { describe, expect, it } from "vitest";
import { createReportStore } from "@/modules/shared/report-store";

describe("report store eviction", () => {
  it("evicts the oldest non-active report when the cap is exceeded", () => {
    const store = createReportStore(2);
    const first = store.create({ sourceType: "url", sourceUrl: "https://example.com/1" });
    const second = store.create({ sourceType: "url", sourceUrl: "https://example.com/2" });
    store.update(first.id, { status: "done" });
    store.update(second.id, { status: "done" });
    const third = store.create({ sourceType: "url", sourceUrl: "https://example.com/3" });

    expect(store.get(first.id)).toBeUndefined();
    expect(store.get(second.id)).toBeDefined();
    expect(store.get(third.id)).toBeDefined();
  });

  it("never evicts a queued or processing report", () => {
    const store = createReportStore(2);
    const queued = store.create({ sourceType: "url", sourceUrl: "https://example.com/queued" });
    const processing = store.create({ sourceType: "url", sourceUrl: "https://example.com/processing" });
    store.update(processing.id, { status: "extracting" });
    const third = store.create({ sourceType: "url", sourceUrl: "https://example.com/3" });

    expect(store.get(queued.id)).toBeDefined();
    expect(store.get(processing.id)).toBeDefined();
    expect(store.get(third.id)).toBeDefined();
  });

  it("evicts failed reports before terminal ones of the same age order", () => {
    const store = createReportStore(1);
    const failed = store.create({ sourceType: "url", sourceUrl: "https://example.com/failed" });
    store.update(failed.id, { status: "failed" });
    const next = store.create({ sourceType: "url", sourceUrl: "https://example.com/next" });

    expect(store.get(failed.id)).toBeUndefined();
    expect(store.get(next.id)).toBeDefined();
  });
});
