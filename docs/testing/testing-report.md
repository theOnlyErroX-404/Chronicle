# Chronicle — Testing Report (2026-08-06)

## Current state (verified this audit)

- **197 tests passed / 3 env-gated skipped** across 21 files; `npm test` green in 5s.
- **Coverage** (vitest 4, `test:coverage`): 92.62% statements, 80.47% branches,
  96.94% functions, 93.87% lines. Per-module branch thresholds enforced:
  extraction 74, ingestion 76, knowledge-modeling 80, global 80 (recalibrated for
  vitest 4's implicit-branch counting).
- **CI** (ci.yml): typecheck, lint, prettier:check, deps:check, coverage, build, plus
  **live Postgres 17 + Redis 7 service containers** with `prisma migrate deploy` and
  env-gated integration tests (postgres-report-store.test.ts, queue.test.ts run real
  round-trips in CI).
- **Golden-set evaluation** (`npm run eval:golden`): 4 labeled reports, entities and
  relationships scored separately (one-to-one greedy matching, macro-aggregated).
  Last known: entities 97.9% F1, relationships 86–89% F1 (qwen2.5:3b-era). Cached;
  run against the live Ollama model — not in CI (by design).

## Test inventory by area

| Area | File(s) | Coverage |
|---|---|---|
| Ingestion (SSRF, fetch, text, PDF) | ingestion.test.ts, ingestion-security.test.ts | branch 78.26% |
| Extraction (chunker, retry, breaker, partial) | extraction.test.ts, processing.test.ts | branch 74.82% |
| LLM clients (Ollama, failover, cache) | llm-client.test.ts, openai-llm-client.test.ts, failover-llm-client.test.ts, cache.test.ts | good |
| Knowledge modeling (merge, graph, STIX) | knowledge-modeling.test.ts | branch ≥80 |
| ATT&CK matching | attck-explicit.test.ts | good |
| Timeline | timeline tests (in knowledge-modeling or own file) | good |
| API routes (auth, reports, jobs, graph, stix, timeline, attck, feedback) | api-get-routes.test.ts, feedback-route.test.ts, auth tests | good |
| Report store (memory eviction, postgres) | report-store.test.ts, postgres-report-store.test.ts | good |
| Evaluation scoring | evaluation-scoring.test.ts | good |

## Gaps (ranked)

1. **Golden set has no multi-chunk report** — chunking, cross-chunk merging, and the
   partial-failure graph path are untested against real model output.
2. **No test for AUDIT-01/02** (slowloris body read, malformed cookie) — they're
   untested bugs.
3. **Timeline date formats** are documented but the m/d/y and day-first claims are
   untested (and wrong) — the tests didn't catch AUDIT-05.
4. **STIX validity** is not checked against any `stix2` validator (AUDIT-06 would
   have been caught).
5. **No load/perf test** for ATT&CK label matching (2,838 regex execs over up to
   250k chars per report — worst case ~seconds, untested).
6. **No E2E browser test** — the workbench is hand-tested in the browser (accepted
   for solo scale; the API surface it rides is covered by route tests).

## Assessment

Solid unit/integration posture for a solo project: boundary validation, store
round-trips against real Postgres/Redis in CI, breaker semantics tested. The gaps
are in the deterministic-module correctness area (timeline, STIX) and golden-set
breadth — exactly the "AI quality gate" the blueprint says matters most.
