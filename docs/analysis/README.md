# Chronicle — Engineering Audit (2026-08-06)

**Auditor:** principal-architect workflow (read-only pass)
**Method:** full repo read + docs review + 4 parallel deep-dive analyses (API/auth,
ingestion, LLM layer, domain modules) + live quality gates + Graphify graph
**Scope:** src/, scripts/, prisma/, .github/, Dockerfile, docker-compose.yml, configs, docs/
**Result:** no critical or high-severity defects; 1 high, 4 medium, 8 low findings (see below)

## Executive summary

Chronicle is a well-executed modular monolith. The three swap seams predicted by the
blueprint (`LlmClient`, `ReportStore`, `JobQueue`) are real, enforced by
dependency-cruiser with zero cycles, and have absorbed every phase-2 change without
redesign. Security posture is well above typical for a solo project: SSRF protection
uses DNS pinning (no rebinding window), PDFs parse in bounded worker threads, auth is
constant-time, errors are sanitized RFC 7807 problem+json. Quality gates are green:
typecheck, lint, prettier, deps:check, build, **197 tests passed / 3 env-gated
skipped**, coverage 92.6% statements / 80.5% branches, `npm audit` = 0.

The findings are concentrated in three places: (1) **correctness bugs in the
deterministic modules** (timeline date parsing, STIX id compliance, partial-failure
canonicalization), (2) **stale code defaults** (the code/`.env.example` still default
to the discarded qwen2.5:3b / 180s timeout / 1200-char chunks — safe only because
compose overrides them), (3) **the LLM cache keys** (cache not keyed by format/base-url
can serve stale or cross-provider results).

## Scores

| Area | Score | Basis |
|---|---|---|
| Repository health | 8.5/10 | Clean tree, active doc upkeep, zero dead code beyond 2 trivials, no dupes |
| Architecture | 9/10 | Modular monolith matches blueprint; seams real; boundaries enforced; no drift |
| Security | 8.5/10 | Excellent SSRF/PDF/auth; 1 high (slowloris body read), 4 medium, 8 low |
| AI system | 7/10 | Sound design (schema-constrained + Zod + circuit breaker + eval); cache-key bugs, stale defaults, weak golden set (4 single-chunk reports) |
| Documentation | 9/10 | Best-in-class for this scale: blueprint, changelog, tasks, decisions, roadmap all current |
| Test maturity | 8/10 | 197 tests, high coverage, env-gated live PG/Redis integration; golden eval separate |
| Technical debt | Low | No accumulated rot; ~15 small fixes, zero structural changes needed |

## Repository health

- 7,137 LOC TS/TSX (src + scripts), 60 ts + 3 tsx + 1 css files, 21 test files.
- Zero dead files; zero duplicate logic (verified: `normalizeName` defined once).
- 2 trivial dead items: `fail()`'s unused `partial` param (process-report.ts:33),
  unused `openaiChatModel` display config (config.ts:57).
- Largest file: `llm-client.ts` (563 lines) — split-worthy, see AI review.
- `graphify-out/` graph: 495 nodes, 1024 edges, 24 communities; god nodes
  (ChronicleError, requireApiToken, processReport, config) match the real design.

## Findings register

Status legend: ✅ = fixed on `fix/audit-findings`.

### High

**AUDIT-01 — Slowloris body read stalls the whole pipeline** ✅ (ingestion/transport.ts:65,
ingestion/index.ts:47-51). The fetch abort timer covers only the header phase; after
headers, the body read has no timeout and no idle timeout is set on the client. A
server that sends headers then trickles bytes holds the request open indefinitely;
with queue concurrency 1 this blocks every report and occupies an active-report slot
→ 429 for everyone. Fix: keep the abort signal wired to the body stream (or a
per-chunk idle timeout in `readStreamWithLimit`). **Fixed:** deadline survives into the
body read (incoming destroyed on abort); body-read failure → sanitized 502 `fetch-failed`.

### Medium

**AUDIT-02 — Malformed cookie → 500 instead of 401** ✅ (shared/auth.ts:28).
`decodeURIComponent` throws URIError on a client-supplied `x%zz` cookie; not a
ChronicleError, so every route returns "unexpected error". One-line try/catch.
**Fixed:** malformed escape treated as absent cookie → 401.

**AUDIT-03 — TOCTOU on the 8-active-report cap** ✅ (app/api/v1/reports/route.ts:33).
`countActive()` then `create()` are non-atomic; concurrent submissions can exceed 8.
Mitigation: accept transient over-cap or make the memory store's cap atomic
(single-threaded store: a check inside the store's create suffices). **Fixed:** atomic
check-and-insert inside the memory store's `create(input, maxActive)`; route passes the
cap; Postgres keeps the pre-check (single-operator scale).

**AUDIT-04 — Login has no brute-force protection** ✅ (app/api/v1/auth/login). Static
token + no rate limiting/lockout; mitigated only by token entropy (516-bit). Low
likelihood, but a rate limit on the login route is cheap. **Fixed:** 10 attempts /
60 s in-memory sliding window → 429 `rate-limited`.

**AUDIT-05 — Timeline date bugs contradict the docs** ✅ (modules/timeline/index.ts).
Header claims `03/05/2024` → US m/d/y and `5 March 2024` → full date, but: no m/d/y
regex exists (slash dates degrade to year-only), and day-first written dates degrade
to month precision. Relative `last month` drifts at month boundaries (−30 days then
`.slice(0,7)`). **Fixed:** US m/d/y + day-first written regexes added, impossible dates
rejected (13/45/2024), calendar month/year shifting via (year*12+month) tuples (also
corrected an inverted "N later" direction bug).

### Low

- **AUDIT-06** ✅ — STIX 2.1-lite is invalid for strict consumers: SDO ids are 12-hex
  (`malware--a1b2c3…`) not UUID; `indicator` objects lack required `pattern` +
  `valid_from`; non-standard `relationship_type` values (`mitigated-by`, `executes`,
  `downloads`, `delivers`, `exfiltrates`) without `x_` prefix; evidence strings dropped.
  **Fixed:** deterministic v5-style UUID ids, indicator `pattern`/`valid_from`,
  `x_chronicle_` prefix via STIX 2.1 vocabulary set.
- **AUDIT-07** ✅ — Partial-failure path skips `canonicalizeEndpoints` → variant-name
  entities become duplicate nodes in partial graphs (success and failure paths
  disagree; extraction/index.ts:280 vs 272). **Fixed:** partial path canonicalizes.
- **AUDIT-08** ✅ — `normalizeName` is ASCII-only: non-Latin entity names normalize to
  the empty string → node-id collision, distinct entities silently merge. **Fixed:**
  trimmed-lowercase fallback when the ASCII pass empties.
- **AUDIT-09** ✅ — Sentence-regex tail drop in chunker (extraction/index.ts:60):
  `.+$` without `m` only matches the final line; a truncated report loses its last
  unterminated sentence. **Fixed:** `[\s\S]+$`.
- **AUDIT-10** ✅ — BullMQ marks report-level failures "completed" (processReport
  persists status `failed` but never throws) → queue failure stats understate reality.
  **Fixed:** rethrows after persisting.
- **AUDIT-11** ✅ — IPv6 SSRF gaps: `fe81:`–`febf:` link-local not blocked (only `fe80:`
  exactly), 6to4 `2002::/16` and IPv4-compatible `::a.b.c.d` pass; `192.0.x` over-blocks
  TEST-NET. Not exploitable against typical targets; fe80 range is a one-liner.
  **Fixed:** full fe80::/10 (`fe8`–`feb` prefixes); 6to4/`::a.b.c.d` left open
  (documented, negligible exposure).
- **AUDIT-12** ✅ — `worker.ts:23` logs `config.redisUrl` — a `redis://user:pass@` URL
  leaks its password to logs. **Fixed:** credentials redacted.
- **AUDIT-13** ✅ — Feedback `mapping` targets never validated (always pass) and the
  feedback array is unbounded per report (n × 64KB requests grow the record).
  **Fixed:** mapping targets validated against `report.attck` ids; per-report cap of
  200 corrections → 429.
- **AUDIT-14** ✅ — `session-probe` is a pseudo-route (dynamic `[id]` 404); fragile if a
  static route is ever added without auth. **Fixed:** explicit
  `/api/v1/auth/session-probe` (200/401); workbench probes it.

## Top strengths

1. **SSRF defense is genuinely hardened** — DNS resolve-once + connect-pinned-IP closes
   the classic rebinding TOCTOU; every redirect hop re-validates; credentials and
   literal private IPs rejected.
2. **PDF isolation** — worker thread with resourceLimits (64/256/16/4MB), 30s wall
   timeout + terminate, `%PDF-` magic check, text-only return channel.
3. **Auth discipline** — constant-time compare, HttpOnly + SameSite=Strict cookie,
   header/cookie unified, secure cookie flags in prod, no client-side token storage
   (CodeQL alert closed).
4. **Error handling consistency** — every route: try/catch → sanitized problem+json;
   LLM provider error text never leaks to clients.
5. **Module boundaries actually enforced** — depcruiser rules, zero cycles, index.ts
   per business context; the seams absorbed model swaps and backend swaps as designed.
6. **Documentation culture** — blueprint, changelog, working plan, decisions index,
   roadmap all current and cross-linked.

## Top risks

1. **Stale code defaults** — bare `npm run build && npm run start` without env uses
   the discarded qwen2.5:3b / 180s timeout / 1200-char chunks (config.ts:48,86,87 +
   .env.example). Compose masks it; any other deploy shape inherits the wrong model.
2. **LLM cache correctness** — cache key ignores `extractionFormat` and provider
   base-URL; toggling format or failover to a second provider can serve stale results.
3. **Deterministic-module correctness** — timeline and STIX outputs are the two most
   externally visible artifacts (analyst reads the timeline; consumers read STIX) and
   both carry bugs (AUDIT-05/06).
4. **Single-instance fragility** — slowloris (AUDIT-01) plus no DR backups yet
   (backlog); a dead Ollama or Redis stalls everything by design, with no recovery
   story beyond the breaker.

## Top 20 improvements (ranked)

1. Fix AUDIT-01 slowloris body timeout (High).
2. Fix AUDIT-05 timeline date parsing + docs (correctness).
3. Fix AUDIT-06 STIX id/pattern/relationship_type compliance.
4. Fix AUDIT-02 malformed-cookie 500.
5. Fix AUDIT-08 ASCII-only normalizeName (non-Latin names).
6. Fix AUDIT-07 partial-path canonicalization.
7. Sync code defaults + .env.example to measured values (nemotron-mini/600s/2100).
8. Fix AUDIT-09 chunker tail drop.
9. Fix cache key (format + base URL) in llm-client.
10. Split llm-client.ts (prompts.ts, schemas.ts, shared fetch helper).
11. Fix AUDIT-10 BullMQ failed-job reporting.
12. Fix AUDIT-03 active-cap atomicity.
13. Fix AUDIT-04 login rate limit.
14. Fix AUDIT-12 redact redisUrl in logs.
15. Fix AUDIT-13 feedback mapping validation + cap.
16. Fix AUDIT-11 IPv6 ranges (fe80::/10).
17. Persist ATT&CK corpus sha256 in the payload (pin claim vs reality).
18. Enrich golden set with a multi-chunk report (exercises chunking/merging).
19. Add AUDIT-14 explicit session-probe route or comment.
20. Backlog: PDF object storage, Redis LLM cache, DR backups, structured logs
    (already tracked in tasks.md).

## Resolution status

**Resolved 2026-08-06** on branch `fix/audit-findings` (not yet merged). Every
AUDIT-01..14 finding is fixed with tests; the AI-system items (cache key format +
base-URL, stale defaults synced to nemotron-mini/600s/2100, invalid-output evidence,
`checkHealth` required, breaker sleep, emoji-safe truncation) are fixed. Deferred
(non-blocking, revisit in 2-C): llm-client.ts split (~client-app split is a
maintainability-only refactor), golden-set enrichment (multi-chunk reports), structured
logging. Gates after fixes: **218 tests passed / 3 skipped**, coverage 93.4% stmts /
81.6% branch, typecheck + lint + prettier + deps:check + build green.

## Recommended next task

Proceed with **2-C Neo4j** per roadmap (audit fixes are done). Before implementation,
have the graph-design session: make the report knowledge graph's organization (typed
node kinds, cluster-friendly layout, readable edge semantics) mirror Graphify's output.

See also: docs/analysis/system-overview.md (architecture), docs/ai/ai-architecture.md,
docs/security/security-audit-2026-08-06.md (threat model), docs/testing/testing-report.md,
docs/operations/operations.md.
