import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/modules/extraction/**/*.ts", "src/modules/knowledge-modeling/**/*.ts", "src/modules/ingestion/**/*.ts"],
      exclude: [
        // Runs in a worker thread (separate process): not instrumentable by v8,
        // but functionally covered by src/tests/pdf-worker.test.ts.
        "src/modules/ingestion/pdf-worker.ts",
        "src/modules/ingestion/pdf-worker-protocol.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
        "src/modules/extraction/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 74 },
        "src/modules/knowledge-modeling/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 80 },
        "src/modules/ingestion/**/*.ts": { lines: 80, functions: 80, statements: 80, branches: 76 },
      },
    },
  },
});
