import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["modules/extraction/**/*.ts", "modules/knowledge-modeling/**/*.ts", "modules/ingestion/**/*.ts"],
      exclude: [
        // Runs in a worker thread (separate process): not instrumentable by v8,
        // but functionally covered by tests/pdf-worker.test.ts.
        "modules/ingestion/pdf-worker.ts",
        "modules/ingestion/pdf-worker-protocol.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
        "modules/extraction/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 80 },
        "modules/knowledge-modeling/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 80 },
        "modules/ingestion/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 80 },
      },
    },
  },
});
