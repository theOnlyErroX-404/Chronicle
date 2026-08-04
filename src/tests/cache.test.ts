import { describe, expect, it } from "vitest";
import { createLlmCache, llmCacheKey } from "@/modules/extraction/cache";

describe("createLlmCache", () => {
  it("returns undefined for a missing key", () => {
    expect(createLlmCache().get("nope")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    const cache = createLlmCache();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("evicts the least-recently-used entry once full", () => {
    const cache = createLlmCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("clear empties the cache", () => {
    const cache = createLlmCache();
    cache.set("a", 1);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("tracks size", () => {
    const cache = createLlmCache();
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });
});

describe("llmCacheKey", () => {
  it("is deterministic and order-sensitive", () => {
    expect(llmCacheKey(["x", "y"])).toBe(llmCacheKey(["x", "y"]));
    expect(llmCacheKey(["x", "y"])).not.toBe(llmCacheKey(["y", "x"]));
  });
});
