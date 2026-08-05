# Changelog

All notable changes to Chronicle are documented here, newest first. The project
has no tagged releases yet — sections are anchored to the plan phases in
`PLAN.md`. Version tags are a planned 2-G (deploy) item.

## 2026-08-05 — Phase 2: timeline reconstruction (2-E)

- **Added** deterministic timeline extraction (`src/modules/timeline/`): temporal
  expressions parsed from the report text — ISO dates, written dates, month-year,
  year-only, and relative terms ("yesterday", "last week", "N days later") —
  resolved to concrete dates (relative terms anchor to the earliest exact date in
  the text) and ordered chronologically. Offline, no LLM call.
- **Added** `timeline` JSONB column + migration `20260805170000_add_report_timeline`,
  store round-trips (memory + Postgres), pipeline wiring in `process-report.ts`
  (computed alongside ATT&CK, survives partial-extraction failures).
- **Added** `GET /api/v1/reports/{id}/timeline` (404 unknown / 409 not ready yet),
  Postman collection entry + sync.

## 2026-08-05 — Security audit remediation (semgrep / bearer / trivy / gitleaks)

- **Added** `bearer.yml` documenting the 2 accepted rule classes (non-PII log
  interpolation, `Math.random` retry jitter) with rationale; Semgrep/Bearer/Trivy
  scans are now clean (Semgrep 0 unsuppressed, Bearer 0, Trivy 0/0/0). Full
  ledger: `SECURITY-AUDIT-2026-08-05.md`.
- **Fixed** unpinned CI actions — all 15 `uses:` across 5 workflows pinned to
  commit SHAs; dependabot `cooldown: default-days: 7` on npm/docker/github-actions.
- **Fixed** `unsafe-formatstring` log hits — constant format strings with args in
  `process-report.ts` / `queue.ts` (no suppression comments needed).
- **Fixed** gitleaks hits — intentional placeholder creds annotated same-line
  (`gitleaks:allow`), example DB URL de-credentialed.
- **Changed** `.gitignore` — agent/tooling config (`.opencode/`, `opencode.json`,
  `vibeguard.config.json`) excluded from the repo.

## 2026-08-05 — Phase 2: feedback, CI hardening, ATT&CK mapping (2-D)

- **Added** offline MITRE ATT&CK mapping. A compact corpus derived from the
  official v19.1 STIX bundle (`npm run attck:refresh`) covers techniques
  (T####), groups (G####), software (S####), and campaigns (C####) with names
  and aliases. The pipeline matches explicit ids and name/alias mentions
  offline (no LLM), persists them in a new `attck` JSONB column, and exposes
  them at `GET /api/v1/reports/{id}/attck`.
- **Added** feedback (human-in-the-loop) endpoint `POST /api/v1/reports/{id}/
  feedback` (2-F): accept/reject/correct corrections against graph entities and
  relationships, persisted on the report and replayed through graph/stix views.
- **Changed** CI to run live Postgres 17 + Redis 7 service containers and
  `prisma migrate deploy`; integration tests are env-gated. Prettier formatting
  is now enforced in CI (`.prettierrc.json`).
- **Fixed** CodeQL tag-regex check and gated dependency + image CVEs
  (npm audit, Trivy); cleared the CD Trivy gate by stripping base-image npm.
- **Changed** enforced module boundaries with dependency-cruiser
  (`npm run deps:check`).
- **Changed** bumped `actions/setup-node` to v7 and `fetch-metadata` to v3.
- **Removed** dead display labels and unused report options (YAGNI audit cuts).

## 2026-08-04 — Phase 2: durable persistence & queue (2-A, 2-B) + maintenance

- **Added** Postgres-backed durable report store via Prisma 7 driver adapters
  (2-A), behind the existing `ReportStore` seam.
- **Added** durable BullMQ/Redis job queue (2-B) with a separate `npm run
  worker` process that survives app restarts, behind the `JobQueue` seam.
- **Added** GitHub workflows (CI, CD with Docker image + Trivy, CodeQL),
  Dockerfile, and Postman collection + `postman:sync` script.
- **Added** cross-chunk extraction: entities are merged across chunks and
  relationships link against the merged set.
- **Added** automatic failover across OpenAI-compatible endpoints on rate
  limits/errors (up to 9, tried in order).
- **Changed** hardened URL fetching (SSRF pinning), streaming limits, and
  bearer-token auth.
- **Changed** migrated the project into a `src/` layout.
- **Changed** upgraded TypeScript to 6.x, Vitest to 4.x, Prisma to 7.
- **Changed** bumped GitHub Actions to current major versions.
- **Removed** speculative abstraction and dead flexibility (ponytail audit).

## 2026-08-03 — Phase 1: MVP

- **Added** scaffold for the Next.js modular monolith.
- **Added** shared foundation: config, errors, RFC 7807 problem responses,
  bearer-token auth, Zod contracts, in-memory report store.
- **Added** ingestion of URLs and PDFs with SSRF-hardened URL validation.
- **Added** chunked LLM extraction with retries, error classification, and
  OpenAI-compatible provider support (Ollama default, hosted failover).
- **Added** two-pass entity and relationship extraction with cross-chunk
  merging and alias resolution.
- **Added** knowledge modeling: entity resolution, graph assembly, and
  STIX 2.1-lite bundle export.
- **Added** serial job queue with progress and partial-failure survival.
- **Added** async reports API: `202` + job polling, graph/STIX endpoints.
- **Added** Cytoscape report workbench UI.
- **Added** golden-set evaluation harness scoring entities and relationships
  separately (`npm run eval:golden`).
- **Added** architecture blueprint and README.
