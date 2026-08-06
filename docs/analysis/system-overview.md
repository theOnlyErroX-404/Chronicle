# Chronicle — System Overview & Component Map (audit 2026-08-06)

## What it is

Next.js modular monolith (TypeScript strict, ~7.1k LOC) that turns threat reports
(PDF / blog URL) into interactive knowledge graphs: local Ollama LLM extraction →
entity resolution → graph + STIX 2.1-lite → Cytoscape.js workbench. Async via a
job queue; persist via Postgres (Prisma 7 driver adapter); ATT&CK mapping and
timeline are deterministic offline modules.

## Component map

```
src/app/api/v1/*            REST: reports (POST/GET), jobs/[id], reports/[id]/{graph,
│                           stix,timeline,attck,feedback}, auth/{login,logout}
src/components/             report-workbench.tsx — Cytoscape UI + login gate
src/lib/                    config.ts (env knobs), presentation.ts, stream.ts (capped reads)
src/modules/
  ingestion/                URL/PDF intake; security.ts (SSRF), transport.ts (pinned fetch),
  │                         text.ts (clean), pdf-worker.ts (isolated parse)
  extraction/               chunker, two-pass LLM extraction, retry+breaker, llm-client.ts
  │                         (Ollama + OpenAI-compatible failover), cache.ts (LRU)
  knowledge-modeling/       normalizeName, union-find merge, graph + STIX bundle assembly
  attck/                    offline MITRE corpus (v19.1) + explicit id/name/label matching
  timeline/                 deterministic temporal extraction (ISO/written/relative)
  processing/               process-report.ts pipeline, queue.ts (BullMQ/Redis seam),
  │                         worker.ts (durable worker entry)
  persistence/              postgres-report-store.ts (Prisma)
  shared/                   contracts.ts (Zod), auth.ts, report-store.ts, errors.ts,
                            cache.ts, stream.ts
src/evaluation/             golden-set + scoring harness (npm run eval:golden)
scripts/                    serve.mjs, attck-refresh.ts, postman-sync.ts
prisma/                     schema + 6 migrations
```

## Data flow

1. `POST /api/v1/reports` (multipart PDF or `{url}`) → Zod boundary validation,
   10MB streamed cap, `MAX_ACTIVE_REPORTS=8` cap → enqueue → `202 {report_id, job_id}`.
2. Worker (`processReport`): health-check LLM → `ingestReport` (SSRF-pinned fetch or
   worker-thread PDF parse → clean → ≤250k chars) → **ATT&CK + timeline computed first**
   (survive partial extraction) → persist → two-pass extraction: entities per chunk →
   union-find merge → relationships per chunk against merged set → `canonicalizeEndpoints`.
3. `buildGraph` + `buildStixLiteBundle` → status `done`. On tolerated chunk failure
   (>25% or all): partial graph + status `failed` + `partial: true`.
4. UI polls `GET /jobs/[id]` (progress `chunk X/Y`) then `GET /reports/[id]/graph`.

## Module graph (verified 2026-08-06)

```
app/components → modules (via index.ts only) → shared/persistence/lib
extraction → knowledge-modeling, shared
processing → extraction, ingestion, knowledge-modeling, timeline, attck, shared
attck → shared          timeline → shared
```

- dependency-cruiser: 87 modules, 217 deps, **0 violations, 0 cycles**
  (rules in `.dependency-cruiser.cjs`, enforced in CI).
- Business contexts import each other only through public `index.ts`;
  no module → web-layer deps.

## Seams (the three swaps the blueprint promised)

| Seam | Interfaces | Implementations | Swap via |
|---|---|---|---|
| `ReportStore` | create/update/get/list/count | memory (bounded LRU+eviction) ↔ Postgres/Prisma | `REPORT_STORE_BACKEND` |
| `JobQueue` | enqueue/poll/worker wiring | in-memory serial ↔ BullMQ/Redis | `JOB_QUEUE_BACKEND` |
| `LlmClient` | extractEntities/extractRelationships/checkHealth | Ollama ↔ OpenAI-compatible (+failover chain) | `LLM_PROVIDER` + `OPENAI_*` |

All three have absorbed real swaps (model change 2026-08-06, Postgres 2-A, Redis 2-B)
with no caller changes — the architecture is delivering exactly what the blueprint
predicted.

## API surface (10 routes)

`POST /reports` · `GET /reports/[id]` · `GET /reports/[id]/graph|stix|timeline|attck`
· `POST /reports/[id]/feedback` · `GET /jobs/[id]` · `POST /auth/login` ·
`POST /auth/logout`. UI calls: reports POST, jobs/[id], graph, login, logout, and the
pseudo-route `reports/session-probe` (dynamic `[id]` 401/404 — see AUDIT-14).

## Deployment shape

`docker-compose.yml` (app + worker + postgres 17 + redis 7, GHCR image
`pull_policy: always`, Ollama via host-gateway) — the canonical stack. Dockerfile:
node:22-alpine digest-pinned, multi-stage, standalone output, npm stripped from the
runner image, Prisma runtime copied explicitly, non-root user, HEALTHCHECK.
