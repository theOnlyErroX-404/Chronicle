# Chronicle — ThreatGraph

AI-driven CTI tool that turns threat reports (PDF uploads / public blog URLs) into
interactive knowledge graphs and STIX 2.1-lite bundles. A Next.js modular monolith
implementing the first phases of [`Chronicle-architecture.md`](Chronicle-architecture.md).

## How it works

1. **Ingestion** — safe URL/PDF fetch with a pinned-IP SSRF guard (resolves once,
   validates against private/loopback ranges, re-pins each redirect hop) and size/time
   limits.
2. **Extraction** — the report is chunked, then processed in a full-report, two-phase
   shape so cross-chunk links survive:
   - an **entity pass** per chunk;
   - a **cross-chunk merge** into one canonical entity set (union-find over normalized
     names + aliases, highest-confidence/longest-name canonical);
   - a **relationship pass** per chunk, but against the *full merged* entity set, so a
     link between entities mentioned in different chunks is expressible; then dedup and
     endpoint canonicalization.
3. **Knowledge modeling** — entity resolution, graph assembly, STIX 2.1-lite export.
4. **Graph/API + UI** — async `202` + polling API, graph/STIX endpoints, Cytoscape render.

All LLM output is JSON-schema-constrained and validated with **Zod**; malformed output is
rejected and retried, never coerced. Extraction results remain analyst-reviewable
candidates.

## LLM backends

- **Local Ollama** (default: `qwen2.5:3b`) — runs CPU-only on modest hardware.
- **Any OpenAI-compatible endpoint** (OpenRouter, Google Gemini, Groq) — set
  `LLM_PROVIDER=openai`.
- **Automatic failover across endpoints** — endpoints are tried in order. When one
  rate-limits (429), rejects the key (401/403), or 5xxes, it is blacked out for a cooldown
  (longer for repeated rate limits, which usually mean a daily free tier is gone) and the
  next endpoint takes over, so one exhausted free model does not stall extraction.
  Configure fallbacks as `OPENAI_BASE_URL_2`/`OPENAI_API_KEY_2`/`OPENAI_CHAT_MODEL_2`
  (up to `_9`).

## Run locally

1. Copy `.env.example` to `.env` and adjust values.
2. Start Ollama and pull the default model: `ollama pull qwen2.5:3b` (or set
   `LLM_PROVIDER=openai` with your hosted endpoints — see `.env.example`).
3. `npm install`, then `npm run dev`, and visit `http://localhost:3000`.

For a deployed environment, set `CHRONICLE_API_TOKEN` and send
`Authorization: Bearer <token>` to the API. The local UI permits unauthenticated
development only when `NODE_ENV` is not production.

## Configuration (`lib/config.ts`)

| Env | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `openai` |
| `OLLAMA_BASE_URL` / `OLLAMA_CHAT_MODEL` | `http://127.0.0.1:11434` / `qwen2.5:3b` | Local model endpoint |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_CHAT_MODEL` | — | Primary hosted endpoint (OpenRouter / Gemini / Groq) |
| `OPENAI_BASE_URL_2` … `_9` (+ key/model) | — | Failover endpoints, tried in order |
| `OPENAI_MAX_TOKENS` (+ `_N`) | `8192` | Completion budget for hosted endpoints; free models over-extract and truncate mid-JSON below this |
| `EXTRACTION_MAX_CHUNK_CHARS` | `1200` | Chunk ceiling (right-sized for CPU Ollama; raise it for hosted models to cut call count) |
| `EXTRACTION_MAX_TOKENS` | `2048` | Completion budget for Ollama calls |
| `EXTRACTION_FORMAT` | `schema` | JSON-schema constrained (`schema`) vs loose `json` |
| `LLM_TIMEOUT_MS` | `180000` | Per-call timeout |
| `MAX_REPORT_BYTES` / `URL_FETCH_TIMEOUT_MS` / `MAX_REDIRECTS` | `10MB` / `15s` / `3` | Ingestion safety limits |

## Quality

- `npm test` (vitest), `npm run typecheck`, `npm run lint` — all green (154 tests).
- **Golden-set eval** (entity vs relationship scored separately, per the architecture
  blueprint's quality gate): `npm run eval:golden`. Reports the active model/endpoints.
- CI runs the same gates on every push/PR (`.github/workflows/ci.yml`); CodeQL scans weekly.

## API clients

- **Postman**: import `postman/Chronicle.postman_collection.json` +
  `postman/Chronicle.postman_environment.json`. Set `apiToken` to match `CHRONICLE_API_TOKEN`
  (leave empty locally); `baseUrl` defaults to `http://127.0.0.1:3210`. The create-report
  requests store the returned `report_id`/`job_id` for the polling requests.
- **Postman sync**: with `Postman_API_KEY` in `.env` (and optionally `POSTMAN_WORKSPACE_ID`),
  `npm run postman:sync` upserts the local collection + environment into your Postman
  workspace by name (creates once, updates on later runs).

## Status vs the blueprint

Implemented: Phase 0 (GPU decision → CPU-only), Phase A (reliability/queue/progress),
Phase C (SSRF pinning, Zod at the boundary), the golden-set harness, the two-phase
cross-chunk extraction, the hosted-provider seam, and multi-endpoint failover.

Deferred to Phase 2 (in-memory Phase 1): Postgres/Neo4j persistence, Redis + BullMQ
durable jobs, ATT&CK mapping, timeline, feedback, ClamAV, and OpenTelemetry.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
