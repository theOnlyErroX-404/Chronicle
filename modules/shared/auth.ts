import { config } from "@/lib/config";
import { ChronicleError } from "@/modules/shared/errors";

export const requireApiToken = (request: Request) => {
  // Local setup remains frictionless; deployed instances must define a token.
  if (!config.apiToken) {
    if (process.env.NODE_ENV === "production") {
      throw new ChronicleError("Server authentication is not configured.", 503);
    }
    return;
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== config.apiToken) {
    throw new ChronicleError("A valid bearer token is required.", 401, "https://chronicle.local/problems/unauthorized");
  }
};
