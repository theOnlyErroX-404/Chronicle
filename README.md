# Chronicle — ThreatGraph

AI-driven CTI tool that turns threat reports (PDF uploads / public blog URLs) into
interactive knowledge graphs and STIX 2.1-lite bundles. A Next.js modular monolith
implementing the first phases of [`docs/architecture/architecture.md`](docs/architecture/architecture.md).

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
4. **Persistence & queue** — Postgres (Prisma) report store and a durable BullMQ/Redis
   job queue behind the `ReportStore` / `JobQueue` seams; a separate `npm run worker`
   process consumes jobs (survives app restarts).
5. **Feedback (human-in-the-loop)** — `POST /api/v1/reports/{id}/feedback` accepts
    accept/reject/correct corrections against graph entities and relationships; they're
    stored on the report and replayed through the graph/stix payloads.
 6. **ATT&CK mapping** — after ingestion, explicit matches from the raw text
    (technique/group/software/campaign ids and names or aliases) are resolved against
    an offline MITRE corpus; `GET /api/v1/reports/{id}/attck` returns them.
 7. **Graph/API + UI** — async `202` + polling API, graph/STIX/feedback/ATT&CK
    endpoints, Cytoscape render.

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
3. Optional but recommended (Phase 2 persistence): run Postgres + Redis containers:
   `docker run -d --name chronicle-postgres -e POSTGRES_USER=chronicle -e POSTGRES_PASSWORD=chronicle -e POSTGRES_DB=chronicle -p 127.0.0.1:5432:5432 postgres:17-alpine` and
   `docker run -d --name chronicle-redis -p 127.0.0.1:6379:6379 redis:7-alpine`; then set
   `REPORT_STORE_BACKEND=postgres` and `JOB_QUEUE_BACKEND=redis` in `.env` and run
   `npx prisma migrate deploy`.
4. `npm install`, then `npm run dev`, and visit `http://localhost:3000`. Run the durable
   worker in a second terminal with `npm run worker` when `JOB_QUEUE_BACKEND=redis`.
5. Production-mode server (standalone build): `npm run build && npm run start`
   (`scripts/serve.mjs` → `node --env-file=.env server.js`, default
   `http://127.0.0.1:3210`). Note `next start` is NOT supported with
   `output: standalone` — use the `start` script.

For a deployed environment, set `CHRONICLE_API_TOKEN` (a random string — e.g.
`openssl rand -base64 48 | tr '+/' '-_'`) and send
`Authorization: Bearer <token>` to the API. The local UI permits unauthenticated
development only when `NODE_ENV` is not production.

## Configuration (`src/lib/config.ts`)

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
| `REPORT_STORE_BACKEND` | `memory` | `memory` or `postgres` (Prisma; requires `DATABASE_URL`) |
| `JOB_QUEUE_BACKEND` | `memory` | `memory` or `redis` (BullMQ; requires `REDIS_URL`) |

## API

`POST /api/v1/reports` (multipart PDF or `{"url": ...}`) → `202` + `job_id`;
`GET /api/v1/jobs/{id}` polls `pending → extracting → done/failed`;
`GET /api/v1/reports/{id}`, `/{id}/graph`, `/{id}/stix` return results once done;
`POST /api/v1/reports/{id}/feedback` records analyst corrections;
`GET /api/v1/reports/{id}/attck` returns MITRE ATT&CK mappings (techniques, groups,
software, campaigns) matched explicitly from the report text. All endpoints require
`Authorization: Bearer <token>` when `CHRONICLE_API_TOKEN` is set.

## Quality

- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run prettier:check`,
  `npm run deps:check` — all green (185 tests with a local Postgres/Redis; 176 surface
  in CI, where live Postgres/Redis integration tests run against service containers).
- **Golden-set eval** (entity vs relationship scored separately, per the architecture
  blueprint's quality gate): `npm run eval:golden`. Reports the active model/endpoints.
- CI runs the same gates on every push/PR (`.github/workflows/ci.yml`), with real
  Postgres 17 + Redis 7 service containers for the integration tests; CodeQL scans weekly.

## ATT&CK corpus

The offline ATT&CK corpus in `src/modules/attck/data/enterprise-attck.json` is derived
from MITRE's official ATT&CK STIX bundle:
`npm run attck:refresh` re-derives it when a new ATT&CK release ships (bump the pinned
tag in `scripts/attck-refresh.ts`). Data is MITRE ATT&CK®, distributed under the
[Apache License 2.0](https://github.com/mitre-attack/attack-stix-data); attribution per
[ATT&CK Usage Terms](https://attack.mitre.org/resources/terms-of-use/).

## API clients

- **Postman**: import `postman/Chronicle.postman_collection.json` +
  `postman/Chronicle.postman_environment.json`. Set `apiToken` to match `CHRONICLE_API_TOKEN`
  (leave empty locally); `baseUrl` defaults to `http://127.0.0.1:3210`. The create-report
  requests store the returned `report_id`/`job_id` for the polling requests.
- **Postman sync**: with `POSTMAN_API_KEY` in `.env` (and optionally `POSTMAN_WORKSPACE_ID`),
  `npm run postman:sync` upserts the local collection + environment into your Postman
  workspace by name (creates once, updates on later runs).

## Status vs the blueprint

**Phase 1 (MVP) — complete:** URL/PDF ingestion, LLM entity + relationship extraction
(via the `LlmClient` seam, Ollama `qwen2.5:3b` or any OpenAI-compatible endpoint),
STIX 2.1-lite export, interactive Cytoscape graph, golden-set eval harness, SSRF
pinning, Zod at the boundary.

**Phase 2 — core complete, backlog deferred:** Postgres (Prisma) persistence (2-A),
Redis + BullMQ durable queue (2-B), human-feedback endpoint (2-F), bearer-token auth,
CI integration tests against ephemeral Postgres/Redis.

Deferred (tracked in docs/tasks.md): 2-C Neo4j, 2-D ATT&CK mapping, 2-E timeline, 2-G
docker-compose + staging deployment, 2-H ClamAV, OpenTelemetry (YAGNI until metrics
are needed). Backlog: PDF object storage, Redis-backed LLM cache, DR backups,
structured JSON logging.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
