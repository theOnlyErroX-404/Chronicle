import { describe, expect, it } from "vitest";
import { assertSafePublicUrl } from "@/modules/ingestion/security";

describe("assertSafePublicUrl", () => {
  it("rejects unsupported schemes", async () => {
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow("Only unauthenticated HTTP(S)");
    await expect(assertSafePublicUrl("ftp://example.com/a")).rejects.toThrow("Only unauthenticated HTTP(S)");
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertSafePublicUrl("https://user:pass@example.com/a")).rejects.toThrow("Only unauthenticated HTTP(S)");
  });

  it("rejects loopback and private hosts", async () => {
    await expect(assertSafePublicUrl("https://127.0.0.1/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://10.0.0.5/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://169.254.169.254/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://192.168.1.1/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://[::1]/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://[fe80::1]/a")).rejects.toThrow(/not allowed/);
  });

  it("rejects IPv4-mapped IPv6 forms of private addresses", async () => {
    await expect(assertSafePublicUrl("https://[::ffff:127.0.0.1]/a")).rejects.toThrow(/not allowed/);
    await expect(assertSafePublicUrl("https://[::ffff:10.1.2.3]/a")).rejects.toThrow(/not allowed/);
  });

  it("accepts a public host", async () => {
    await expect(assertSafePublicUrl("https://example.com/report")).resolves.toBeInstanceOf(URL);
  });
});
