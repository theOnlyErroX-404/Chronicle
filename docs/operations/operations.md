# Chronicle — Operations Report (2026-08-06)

## Deploy shape

- **Canonical:** `docker-compose.yml` — app + worker + postgres 17 + redis 7,
  GHCR `ghcr.io/theonlyerrox-404/chronicle:main` (`pull_policy: always`), Ollama
  host-side via `host.docker.internal:host-gateway`. Coolify build pack target.
- **Image:** node:22-alpine digest-pinned, multi-stage (deps → builder → runner),
  standalone output, npm stripped from runner (Trivy hygiene), non-root `nextjs`
  user, HEALTHCHECK, `NEXT_TELEMETRY_DISABLED`.
- **Local:** `npm run build && npm run start` → `scripts/serve.mjs` assembles
  `.next/standalone`, copies static/public, spawns `node --env-file=.env server.js`
  on 127.0.0.1:3210. Durable worker: `npm run worker` (needs redis mode).
- **CI:** typecheck/lint/prettier/deps/coverage/build + live PG/Redis services.
- **CD:** image build + Trivy scan (HIGH/CRITICAL) → GHCR push on main.
- **Scanning:** CodeQL (3 jobs), npm audit (security.yml, weekly), dependabot
  (3 ecosystems, cooldown 7d, automerge waits for checks). Actions all SHA-pinned.

## Observability — current vs blueprint

| Concern | Now | Blueprint target (backlog) |
|---|---|---|
| Logs | Plain console with `[report {id}]` prefixes; errors redacted to `.message`; 18 console sites | Structured JSON logs with report/job correlation IDs |
| Metrics | None exported; the data exists (stats.reasons, chunk counts, latency) but no endpoint | Metrics "that matter": schema-validation failure rate, ATT&CK precision, per-report latency |
| Tracing | None | OTel **deferred (YAGNI)** — only when metrics are needed |
| Health | Docker HEALTHCHECK (HTTP /), queue/LLM health-checked at job start | — |
| Error reporting | None (no Sentry) — designs in docs/designs/DESIGN-sentry.md, deferred | Backlog decision pending |

## DR & reliability

- **Backups:** none automated yet (backlog: daily Postgres dump, blueprint RPO 24h).
  Postgres + Redis volumes are compose-managed.
- **Queue:** BullMQ/Redis durable — jobs survive app restarts (verified 2-B).
  `MAX_ACTIVE_REPORTS=8` bounds concurrent work; worker concurrency 1 (CPU-bound
  Ollama is the real ceiling).
- **Failure modes:** breaker waits out Ollama cooldowns; partial-extraction
  survival (>25% chunks failed → partial graph); ATT&CK/timeline computed before
  LLM so they survive extraction failure. Report-level failures persist status
  `failed` but BullMQ marks the job `completed` (AUDIT-10 — stats understate).

## Config & secrets

- `.env` local-only (git-ignored); `.env.example` ships placeholders; compose uses
  `${VAR:?}` required-vars so a missing secret fails fast.
- `CHRONICLE_API_TOKEN` — static, 516-bit base64url, rotated 2026-08-05. No secrets
  in code/commits (gitleaks clean; scanner ledger 2026-08-05).
- **Default drift note:** config.ts + .env.example still carry the discarded
  model/timeout/chunk defaults (qwen2.5:3b / 180s / 1200) — compose overrides
  them; any other deploy shape must set `OLLAMA_CHAT_MODEL=nemotron-mini:latest`,
  `LLM_TIMEOUT_MS=600000`, `EXTRACTION_MAX_CHUNK_CHARS=2100` explicitly.

## Operational watch-list

1. Ollama is the single point of failure (CPU, ~2.4 tok/s) — no GPU offload
   (2 GiB card too small, recorded).
2. `OLLAMA_NUM_CTX=4096` with 2048 max completion tokens: a long entity list can
   clip inside the context window → `invalidOutput`; watch schema-failure rate.
3. Redis job retention 500 completed jobs — bounded; fine.
4. Memory store cap 100 reports w/ eviction; Postgres backend unbounded growth of
   `reports` rows (no retention job — acceptable, note for DR planning).
5. Health check hits `/` (root page) — fine, but a dedicated `/api/v1/health`
   would also cover auth/queue in future.
