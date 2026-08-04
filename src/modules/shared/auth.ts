import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { ChronicleError } from "@/modules/shared/errors";

const safeEqual = (a: string, b: string) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first; the
  // early return leaks only the length, never the contents.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

export const requireApiToken = (request: Request) => {
  // Local setup remains frictionless; deployed instances must define a token.
  if (!config.apiToken) {
    if (process.env.NODE_ENV === "production") {
      throw new ChronicleError("Server authentication is not configured.", 503);
    }
    return;
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !safeEqual(token, config.apiToken)) {
    throw new ChronicleError("A valid bearer token is required.", 401, "https://chronicle.local/problems/unauthorized");
  }
};
