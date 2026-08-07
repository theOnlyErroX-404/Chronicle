# Chronicle — Agent Project Brief

This file is the agent's persistent memory of what this project IS, what was decided,
and how to work here. Read it before any task; update it when a decision changes.

## The main idea (one paragraph, never forget this)

**Chronicle is an AI-driven CTI (Cyber Threat Intelligence) tool that turns threat
reports into interactive knowledge graphs.** A user uploads a threat report (PDF or a
public blog/URL); Chronicle extracts structured entities (threat actors, malware,
CVEs, infrastructure, techniques) and the relationships between them using a
**local, self-hosted LLM (Ollama)**, models the result as a graph, and serves it via
a REST API plus a **vis-network** workbench UI, with STIX 2.1-lite export, offline MITRE
ATT&CK mapping, and deterministic timeline extraction.

**Why it exists:** CTI analysts waste time mechanically extracting actors, malware,
IOCs, and behaviors from vendor reports. Chronicle automates that mechanical layer so
analysts can spend time on judgment.

**Architecture in one line:** a Next.js modular monolith (feature modules under
`src/modules/`, boundaries enforced by dependency-cruiser) with replaceable seams
(`LlmClient`, `ReportStore`, `JobQueue`) — deliberately NOT microservices (YAGNI).

## Working agreements (binding)

- **Small increments, one at a time** — never large one-shot implementations.
- **Quality gates before "done"**: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run prettier:check`, `npm run deps:check`; add `npm run build` when app/API/config
  changes. Tests for every behavior change; never weaken coverage.
- **Security is first-class** — ingestion, network, auth, API boundary get a security
  review (SSRF, DoS, constant-time auth, input validation). No secrets in code/commits.
- **YAGNI / ponytail** — stdlib and existing deps first; one-line over abstraction;
  dead code removed, never left.
- **Git**: conventional commits, branch per phase/task, merge to main ONLY after the
  user confirms. Docs updated with every change (docs/changelog.md, docs/tasks.md).
- **User hand-tests in the browser** — changes must remain CLI-verifiable; capture
  HTTP via the proxy at `127.0.0.1:3215` / server logs when needed.

## Current status (compact — verified 2026-08-07)

- **main = `61b7864` + today's uncommitted→committed work**, all 4 CI checks green
  (npm audit, typecheck·lint·test·build, Build & push image, CodeQL). 0 open PRs, 0
  open CodeQL alerts, **all branches deleted** (only `main` remains).
- **Shipped this week**: ThreatGraph frontend redesign (vis-network graphite shell,
  Graph/Timeline/ATT&CK/Export tabs, shared node inspector with Accept/Reject/Correct,
  STIX export) + follow-up round: **real analysis cancel** (`POST /api/v1/jobs/[id]/cancel`,
  Stop button, form lock), uniform slider timeline, categorized ATT&CK with
  attack.mitre.org links. Baseline: 246 passed / 3 skipped (249 total), coverage
  93.71% stmts / 82.06% branch.
- **Today (2026-08-07)**: comfort pass + audit round — 1440px shell, bigger graph
  with auto-fit, proportional timeline track with year axis, shared inspector for
  timeline/ATT&CK (per-view selection memory), form collapse strip, tier-colored
  confidence pills, folder tabs, PDF dropzone, STIX tokenizer, graph-no-rebuild-on-
  click fix. Extraction: `EXTRACTION_MAX_CHUNKS` cap (default 0) + `.env` switched
  to OpenRouter (`LLM_PROVIDER=openai`, gemma free, Gemini failover). Live-verified
  queued→ingesting transitions in <5s (earlier hang not reproducible).
- **Phases done**: 1 (MVP), 2-A Postgres, 2-B BullMQ, 2-D ATT&CK, 2-E timeline, 2-F
  feedback, 2-G deploy + UI auth, 2-I audit fixes (AUDIT-01..14), 2-H is pending.
- **Next: 2-C Neo4j** (start with the graph-design session mirroring Graphify's output),
  then **2-H ClamAV**, then backlog (llm-client split, PDF object storage, Redis LLM
  cache, DR backups, structured logging).
- **Extraction model**: local `nemotron-mini:latest` (measured choice); hosted runs
  use OpenRouter `google/gemma-4-26b-a4b-it:free` via `LLM_PROVIDER=openai` with a
  30-chunk cap (`.env`).
- Server runs on `127.0.0.1:3210` (`npm run build && npm run start`); user hand-tests
  through the capture proxy at `127.0.0.1:3215`. `.env` currently:
  `REPORT_STORE_BACKEND=postgres`, `JOB_QUEUE_BACKEND=memory` (in-process queue — no
  separate worker needed; switch to `redis` + `npm run worker` for durable mode).
- **Last session (2026-08-07, was `feat/graph-redesign`, now merged)**: real cancel
  implemented + fixed (see gotchas below), timeline slider, ATT&CK categorization,
  TLP chip removed. Work stopped mid-follow-up on one item: the queue-drop path for
  BullMQ is unit-tested but the redis-mode worker was never live-verified.
- **This session's gotcha refresh**: the frontend pass shipped on `main` with no
  feature branch (per user instruction); design follow-ups still open: scroll-snap
  on the timeline (incompatible with the absolute-positioned track), motion spec
  (crossfade/pulse/reduced-motion), confidence rust tier invisible on nodes (all
  entities extract at 1.0 — data, not UI).

## Gotchas for the next session (hard-earned, easy to trip on)

- **`ReportRecord` fields MUST have matching Prisma columns.** The Postgres store
  passes every patch verbatim to `db.update({ data })` — an unknown key throws and
  the route 500s. Before adding a field to `src/modules/shared/report-store.ts`, add
  a column to `prisma/schema.prisma` (and a migration) or reuse an existing field.
- **Cancel is the durable `status: 'cancelled'`** — not a separate flag. The pipeline
  (`process-report.ts`) polls it between stages/chunks, and every intermediate status
  write goes through `checkpoint()`, which re-reads the status before writing so a
  mid-run cancel is never clobbered. `JobQueue.remove` is best-effort; BullMQ jobs
  are keyed `jobId = reportId` so removal by report id works.
- **Server restart**: `pkill -f next-server` (and `serve.mjs`) then
  `npm run build && npm run start`. Killing the serve.mjs parent leaves the
  `next-server` child stale — kill it too. Stuck jobs ("Waiting for a worker ·
  queued") mean the in-memory queue is busy; restarting the server clears it.
- **LLM is slow on CPU** (~2.4 tok/s, up to 5 min/chunk): browser hand-tests take
  minutes per report; use curl against `127.0.0.1:3210` with
  `Authorization: Bearer $CHRONICLE_API_TOKEN` for quick API verification, and a
  200-serving URL (e.g. `https://httpbin.org/html`) when you need the job to reach
  the `extracting` stage (404 hosts fail instantly).

## Key decisions (canonical copies live in docs/decisions/ + docs/tasks.md "LOCKED PLAN")

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js modular monolith, TS strict, Prisma 7 + pg driver adapter | per architecture blueprint |
| Extraction model | `nemotron-mini:latest` local Ollama (CPU) | measured 2026-08-06: qwen2.5:3b missed all malware/IOCs; nemotron extracts them. `LLM_TIMEOUT_MS=600000`, chunks 2100 chars |
| Auth | static `CHRONICLE_API_TOKEN` header OR HttpOnly `chronicle_session` cookie | closes CodeQL clear-text-storage alert; workbench login gate |
| Persistence | Postgres via Prisma behind `ReportStore` seam | 2-A |
| Queue | BullMQ/Redis behind `JobQueue` seam, separate worker | 2-B |
| Graph renderer | vis-network 10 in the workbench (not Cytoscape) | 2026-08-06 redesign |
| Cancel | `status: 'cancelled'` is durable + polled; `POST /jobs/[id]/cancel` | 2026-08-07; survived a real bug (see gotchas) |
| Infra | Docker compose (app+worker+postgres+redis), GHCR pull, Ollama host-side | 2-G; Coolify target |
| LLM extraction | JSON-schema constrained (`EXTRACTION_FORMAT=schema`), Zod backstop | loose json is unusable (model invents schema) |
| Anti-patterns | no microservices, no OTel (YAGNI), no GPU (2GiB card too small) | recorded in tasks.md |

## Repo layout (after 2026-08-06 restructure)

```
src/          source (app, components, lib, modules/*, evaluation, tests)
scripts/      serve.mjs, attck-refresh.ts, postman-sync.ts
prisma/       schema + migrations
docs/         architecture/ security/ decisions/ designs/ + changelog/roadmap/tasks/tooling
postman/      collection + environment
public/       static
.github/      CI/CD workflows
graphify-out/ graphify knowledge-graph output (git-ignored, regenerate with `graphify .`)
```

## Tools

- **Graphify** (`graphify`, PyPI `graphifyy` v0.9.34, user-installed): codebase → queryable
  knowledge graph (tree-sitter AST, offline, no API). Commands:
  `graphify .` (build), `graphify update .` (incremental), `graphify query "…"`,
  `graphify path A B`, `graphify explain X`, `graphify cluster-only .` (report).
  Output: `graphify-out/{graph.json,GRAPH_REPORT.md,graph.html}`. Regenerate after
  meaningful changes; always prefer `graphify query` over grepping for architecture
  questions.
- **Ponytail**: active working mode (lazy = efficient; smallest correct diff).
- **Understand**: available (`~/.agents/skills/understand*`) for deeper dives on demand.
- **Security scanners**: CodeQL + npm audit + Trivy in CI; bearer/semgrep skills exist,
  CLIs not host-installed (intentional).
- Details: docs/tooling/README.md.

## Golden rules for the agent

1. NEVER commit secrets; `.env` is local-only; `CHRONICLE_API_TOKEN`/`GITHUB_API_TOKEN`
   come from `.env`.
2. NEVER merge to main without user confirmation.
3. Update docs/changelog.md + docs/tasks.md in the same change as the work.
4. Ask when unsure — do not guess architecture decisions.
5. Regenerate `graphify-out/` when the module graph meaningfully changes, and consult
   GRAPH_REPORT.md for architecture questions before reading files.
6. When the session ends, update this file's "Current status" + "Gotchas" sections —
   they are the handoff note for the next session.
