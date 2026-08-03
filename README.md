# Chronicle

AI-driven CTI tool that transforms threat reports (PDFs/Blogs) into interactive knowledge graphs. Uses self-hosted LLMs to extract entities, relationships, and MITRE ATT&CK mappings into STIX 2.1 lite bundles.

---

# Chronicle — ThreatGraph

Phase 1 implementation of the supplied architecture blueprint: a Next.js modular monolith that accepts a public threat-report URL or PDF, safely extracts text, calls a local Ollama model through a replaceable `LlmClient`, validates structured candidates, and renders an interactive knowledge graph with a STIX 2.1-lite export.

## Run locally

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Start Ollama and download the default model: `ollama pull qwen2.5:3b`.
3. Install packages with `npm install`, then run `npm run dev`.
4. Visit `http://localhost:3000` and submit a public HTML report or PDF.

For a deployed environment, set `CHRONICLE_API_TOKEN` and send `Authorization: Bearer <token>` to the API. The local UI intentionally permits unauthenticated development only when `NODE_ENV` is not production.

## Current Phase 1 scope

- Implemented: safe URL/PDF ingestion, bounded extraction retries, Ollama JSON-schema output, Zod validation, in-memory processing lifecycle, graph/STIX endpoints, and Cytoscape visualization.
- Deliberately deferred to Phase 2: durable Postgres/Neo4j storage, BullMQ/Redis jobs, ATT&CK mapping, timeline construction, feedback, and production observability.

The key module seams are `modules/ingestion`, `modules/extraction`, `modules/knowledge-modeling`, and `modules/processing`. Cross-module consumers only use each module's `index.ts` public entry point.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
