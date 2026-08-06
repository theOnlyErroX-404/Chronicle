# Changelog

All notable changes to Chronicle are documented here, newest first. The project
has no tagged releases yet — sections are anchored to the plan phases in
`docs/tasks.md`. Version tags are a planned 2-G (deploy) item.

## 2026-08-06 — Graph redesign: provenance, implied edges, vis-network UI (branch feat/graph-frontend)

- **Graph contract enriched (additive)**: `GraphNode` now carries extraction
  `evidence` + `aliases` (previously dropped at `buildGraph`); `GraphEdge`
  carries `evidence` + a `derived` flag; `Graph` gains `clusters[]` — connected
  components named by their hub (highest degree, source-anchoring tiebreak),
  mirroring Graphify's community naming. Relationship vocabulary gains
  `associated-with`.
- **Derived edges for density** (`deriveImpliedEdges`): deterministic,
  evidence-anchored `associated-with` links — entities co-mentioned in the same
  relationship evidence, and indicator hostnames under the same registrable
  domain (compound TLDs handled). Confidence 0.3, always flagged `derived`;
  the STIX bundle excludes them so exports stay faithful.
- **UI**: cytoscape swapped for vis-network (Graphify's engine) — cluster-colored
  nodes (Tableau-style palette), kind-based shapes, size ∝ degree, dashed
  derived edges, hover highlight. Node inspector shows type/confidence/aliases/
  evidence + every incident relationship with direction + `inferred` badge.
  Controls: search, implied-edge toggle, fit.
- **Panels**: `ReportWorkbench` split into `GraphViewer` + `ReportPanels`
  (timeline / ATT&CK / STIX-export tabs, lazy fetch from existing endpoints).
- **Styling**: Sentry-inspired tokens (violet-midnight canvas, lime accent);
  stale qwen2.5 hero copy removed.
- 226 tests passing (was 218), coverage 93.62% stmts (was 93.39).

## 2026-08-06 — Audit fixes (2-I, branch fix/audit-findings)

- **Fixed** AUDIT-01 (High, slowloris): the fetch deadline now survives past the
  response headers — an aborted request destroys the body stream instead of
  hanging; body-read failures surface as a sanitized 502 `fetch-failed`.
- **Fixed** AUDIT-02: a malformed percent-escape in the session cookie now
  yields 401 instead of a 500.
- **Fixed** AUDIT-03: the active-report cap is enforced atomically inside the
  store's `create` (memory backend) — the API-level count-then-create TOCTOU
  window is closed; Postgres backend keeps the pre-check (single-operator scale).
- **Fixed** AUDIT-04: the login route is throttled (10 attempts/minute sliding
  window, in-memory).
- **Fixed** AUDIT-05: timeline now parses US m/d/y and day-first written dates
  (`5 March 2024`), rejects impossible dates, and calendar-shifts relative
  months/years (no 30/365-day drift; also fixed an inverted direction bug for
  "N months later").
- **Fixed** AUDIT-06: STIX ids are now deterministic UUIDs (v5-style from the
  node id), `indicator` SDOs carry `pattern` + `valid_from`, and non-standard
  relationship types get the `x_chronicle_` prefix.
- **Fixed** AUDIT-07: the partial-extraction path now canonicalizes endpoints
  like the success path; **AUDIT-08**: non-Latin names no longer normalize to an
  empty key (distinct entities stay distinct); **AUDIT-09**: unterminated final
  sentences survive chunking.
- **Fixed** AUDIT-10: `processReport` rethrows after persisting failure, so
  BullMQ records failed jobs instead of "completed"; **AUDIT-11**: full
  fe80::/10 link-local range blocked in URL validation; **AUDIT-12**: redis URL
  is redacted in worker logs; **AUDIT-13**: feedback targets validated against
  the report's attck mappings + per-report feedback cap (200); **AUDIT-14**:
  explicit `/api/v1/auth/session-probe` route replaces the broken 404 probe.
- **Fixed** AI items: LLM cache key now includes extraction format and provider
  base URL; `checkHealth` is required on `LlmClient`; invalid LLM output errors
  carry a truncated raw-output excerpt; defaults synced to the measured
  nemotron-mini/600s/2100 configuration (code + `.env.example`); circuit
  breaker sleeps once (no busy-wait); emoji evidence is truncated by code point.
- **Added** tests for every fix (timeline formats, cookie handling, slowloris
  abort, atomic cap, login throttle, STIX compliance, partial canonicalization,
  cache scoping, non-Latin names, chunker tail, rethrow-on-fail).
- **Changed** docs: audit register marked resolved in `docs/analysis/README.md`,
  roadmap order updated (2-I before 2-C), decisions log entry added.
- **Deferred** (noted in register): llm-client.ts split, golden-set enrichment,
  structured logging — low value, revisit in 2-C.

## 2026-08-06 — Full engineering audit (read-only)

- **Performed** a complete engineering audit per the principal-architect workflow:
  repo + docs + configs read, 4 parallel deep-dive analyses (API/auth, ingestion,
  LLM layer, domain modules), live quality gates, Graphify graph.
- **Added** `docs/analysis/` (README.md = findings register AUDIT-01..14 + scores;
  system-overview.md = component map, data flow, module graph, seams),
  `docs/ai/ai-architecture.md` (prompts, cache, guardrails, golden set),
  `docs/security/security-audit-2026-08-06.md` (threat model + new findings),
  `docs/testing/testing-report.md` (inventory, gaps, assessment),
  `docs/operations/operations.md` (deploy, observability, DR, watch-list).
- **Verdict:** no Critical/High structural issues; 1 High (slowloris body-read
  timeout — AUDIT-01), 4 Medium, 8 Low. Gates re-verified: 197 passed / 3
  skipped, coverage 92.6%/80.5%, deps:check 0 violations, audit 0.
- **No code changes** — audit is read-only; fix set awaits approval before 2-C.

## 2026-08-06 — Docs restructure (repo organization)

- **Moved** root docs into `docs/`: `Chronicle-architecture.md` →
  `docs/architecture/architecture.md`, `CHANGELOG.md` → `docs/changelog.md`,
  `SECURITY-AUDIT-2026-08-05.md` → `docs/security/security-audit.md`,
  `CODEFINDINGS.md` → `docs/security/code-findings.md`, `PLAN.md` →
  `docs/tasks.md`, `Designs/` → `docs/designs/`.
- **Added** `docs/roadmap.md` (stable forward view), `docs/decisions/README.md`
  (index — single copy per decision, no duplication), `docs/tooling/README.md`
  (toolchain matrix: Ponytail used, Understand available, Graphify rejected —
  npm's `graphify` is a random-graph generator, not a codebase analyzer).
- **Consolidated** scripts: `src/scripts/{attck-refresh,postman-sync}.ts` →
  `scripts/` (all project scripts in one place; package.json + `corpus.ts`
  references updated).
- **Fixed** stale links (README, `bearer.yml`, `.dependency-cruiser.cjs`
  `src/scripts/` → `scripts/`), `.gitignore`/`.dockerignore` paths.
- **Reverted** `next-env.d.ts` build-noise churn.
- Verified: typecheck / lint / prettier / 197 tests / deps:check / worker boots /
  compose YAML valid. No behavior change.

## 2026-08-06 — Phase 2-G: deployment stack + cookie session auth (merged `cd50532`)

- **Added** `POST /api/v1/auth/login` (sets HttpOnly `chronicle_session` cookie,
  `SameSite=Strict`, `Max-Age=30d`, `Secure` in production) and `POST
  /api/v1/auth/logout` (clears it). `requireApiToken` accepts the `Authorization`
  header or the session cookie (constant-time, shared `verifyApiToken`) — the
  existing 8 API routes are unchanged.
- **Added** workbench login gate (`src/components/report-workbench.tsx`
  rewritten): token no longer touches the browser — **closes CodeQL alert #3
  `js/clear-text-storage-of-sensitive-data`** (localStorage token removed).
  Session probe rides the existing `GET /api/v1/reports/{id}` route (401 without
  cookie, 404 with).
- **Added** `docker-compose.yml`: app + worker + postgres 17 + redis 7, pulling
  `ghcr.io/theonlyerrox-404/chronicle:main` (`pull_policy: always`), Ollama
  reached via `host.docker.internal:host-gateway` (host systemd service, models
  already pulled).
- **Added** `build:worker`: bundles `worker.ts` with esbuild into
  `.next/standalone/worker.cjs` — the standalone trace does not include ioredis
  and the runner image has no npm/tsx, so the worker needs the self-contained
  bundle. esbuild added as a direct devDependency (`0.28.1`).
- **Verified** live: no cookie → 401, bad token → 401, good token → 204 +
  cookie, cookie probe → 404 (ok), logout → 204, post-logout → 401, legacy
  Bearer header still works.

## 2026-08-06 — Extraction quality pass (model benchmark + breaker resilience)

- **Benchmarked** local models on the same APT41 chunk (2,100 chars, production
  schema, temp 0, seed 1337): `qwen2.5:3b` ~160s/chunk but extracted zero
  malware/IOCs (actors/sectors/countries only); `nemotron-mini:latest` ~2.4
  tok/s, extracted all malware + web-shells (ANTSWORD, BLUEBEAM, DUSTPAN,
  BEACON, DUSTTRAP, SQLULDR2, PINEGROVE, OneDrive); `qwen3-vl:4b` 2,120s and
  invalid JSON — rejected.
- **Switched default model**: `.env` → `OLLAMA_CHAT_MODEL=nemotron-mini:latest`,
  `LLM_TIMEOUT_MS=600000` (old 180s would kill every nemotron chunk);
  `EXTRACTION_MAX_CHUNK_CHARS=2100` retained.
- **APT41 end-to-end** (PDF multipart; loopback URLs are blocked by the SSRF
  guard): report done, 11 chunks, 1 flaky chunk skipped without aborting,
  **19 entities / 11 relationships**, stats recorded. Previous run under the
  old code failed 4/11 with 0 edges.
- **Fixed** breaker fail-fast (merged `4541770`, PR #21): `withRetry` no longer
  throws while the breaker is open — it waits out the cooldown
  (`while (breaker?.isOpen()) sleep(25)`) so one flaky chunk can't abort the
  remaining chunks. Tests rewritten to the new contract.
- **CI green-fix** (merged `18a952c`, PR #20): prettier-formatted
  `scripts/serve.mjs`, `report-workbench.tsx`, postman collection (the `Check
  formatting` failure in 4 pushed commits); bumped all three `codeql-action`
  steps to v4.37.3 (same pinned SHA). All 4 dependabot PRs (#16 TS7 wall,
  #17/#18/#19 superseded) closed with rationale. Main CI fully green; **all
  CodeQL alerts closed** (0 open).

## 2026-08-05 — Web connection fixes + auth token rotation

- **Fixed** CSP breaking the UI: `script-src 'self'` blocked Next.js's inline bootstrap scripts (React hydration #412, form submitted natively). Added `'unsafe-inline'` to script-src/style-src — the standard Next.js CSP; nonce-based policy remains the documented upgrade path.
- **Fixed** `next start` not working with `output: standalone` (it never loaded `.env`
  and served stale state → persistent 401s). New `npm run start` runs
  `scripts/serve.mjs`: assembles `.next/standalone` (copies `.next/static` + `public`)
  and spawns `node --env-file=.env server.js` — shell-safe env loading, default
  `127.0.0.1:3210`.
- **Fixed** `node --env-file` truncating unquoted values at `#`; rotated
  `CHRONICLE_API_TOKEN` to a clean 516-bit base64url token (old token's
  `#`/`$`/`@`/`%` chars were fragile across env/header parsers). Verified auth on
  both `npm run start` and `npm run dev`: no token → 401, wrong → 401, correct → 202.

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
