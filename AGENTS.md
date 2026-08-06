# Chronicle — Agent Project Brief

This file is the agent's persistent memory of what this project IS, what was decided,
and how to work here. Read it before any task; update it when a decision changes.

## The main idea (one paragraph, never forget this)

**Chronicle is an AI-driven CTI (Cyber Threat Intelligence) tool that turns threat
reports into interactive knowledge graphs.** A user uploads a threat report (PDF or a
public blog/URL); Chronicle extracts structured entities (threat actors, malware,
CVEs, infrastructure, techniques) and the relationships between them using a
**local, self-hosted LLM (Ollama)**, models the result as a graph, and serves it via
a REST API plus a Cytoscape.js workbench UI, with STIX 2.1-lite export, offline MITRE
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

## Current status (compact)

- **main** = green CI (typecheck/lint/test 197/build/CodeQL/audit), 0 open PRs, 0 open
  CodeQL alerts. Latest: `2a6f4c9` (docs up to date), before it `f93d84a` (docs/scripts
  restructure), `cd50532` (2-G auth + compose).
- **Phases done**: 1 (MVP), 2-A Postgres, 2-B BullMQ, 2-D ATT&CK, 2-E timeline, 2-F
  feedback, 2-G deploy + UI auth. **Next: 2-C Neo4j, then 2-H ClamAV, then backlog**
  (PDF object storage, Redis LLM cache, DR backups, structured logging).
- **Extraction model**: `nemotron-mini:latest` (measured choice — see Key decisions).
- Server runs on `127.0.0.1:3210` (`npm run build && npm run start`); durable worker:
  `npm run worker` (redis mode). Deployed shape: `docker-compose.yml`.

## Key decisions (canonical copies live in docs/decisions/ + docs/tasks.md "LOCKED PLAN")

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js modular monolith, TS strict, Prisma 7 + pg driver adapter | per architecture blueprint |
| Extraction model | `nemotron-mini:latest` local Ollama (CPU) | measured 2026-08-06: qwen2.5:3b missed all malware/IOCs; nemotron extracts them. `LLM_TIMEOUT_MS=600000`, chunks 2100 chars |
| Auth | static `CHRONICLE_API_TOKEN` header OR HttpOnly `chronicle_session` cookie | closes CodeQL clear-text-storage alert; workbench login gate |
| Persistence | Postgres via Prisma behind `ReportStore` seam | 2-A |
| Queue | BullMQ/Redis behind `JobQueue` seam, separate worker | 2-B |
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
