# Chronicle — Security Review 2026-08-06 (threat model + findings)

Companion to docs/security/security-audit.md (2026-08-05 scanner ledger: Semgrep 0,
Bearer 0, Trivy 0/0/0, CodeQL 0 alerts). This pass adds a fresh architectural review.
New findings are registered as AUDIT-01..14 (ranked register in docs/analysis/README.md).

## Threat model (STRIDE-style, per surface)

| Surface | Threat | Verdict |
|---|---|---|
| URL ingestion | SSRF (private IPs, DNS rebinding, redirects) | **Strong.** scheme allow-list; credentialed URLs rejected; DNS resolved once + connect pinned to validated IPs (no rebinding window, transport.ts); per-hop redirect re-validation; IPv4 blocked comprehensively incl. CGNAT/link-local/mapped forms. Gaps: fe80::/10 link-local partial (only fe80::), 6to4/IPv4-compatible IPv6 forms — Low |
| URL ingestion | Slowloris DoS after headers | **AUDIT-01 (High)** — body read has no timeout (abort signal dropped after headers); concurrency-1 pipeline blocks |
| PDF upload | Malicious PDF (weaponized report) | **Strong.** worker thread + resourceLimits + 30s terminate + magic check; ClamAV planned (2-H). Post-parse PDF discarded (retention = backlog item) |
| API boundary | Oversized bodies, malformed input | **Strong.** Zod at boundary, 10MB streaming cap → 413 at crossing byte, 256KB multipart slack, 64KB feedback cap, 16KB login cap |
| API boundary | Unbounded fan-out (huge reports) | Capped: 250k chars → ≤~120 chunks; entity/relationship schema caps |
| Auth | Token brute force / cookie theft | Constant-time compare ✅; HttpOnly + SameSite=Strict ✅; **no login rate limit (AUDIT-04)**; static token in 30-day cookie, no rotation/binding (inherent to design, documented) |
| Auth | Malformed cookie crash | **AUDIT-02** — decodeURIComponent throws → 500 instead of 401 |
| Reports cap | Active-report flood | Cap 8 → 429, but **TOCTOU (AUDIT-03)**; memory-store eviction caps growth |
| Feedback | Stored growth / invalid targets | **AUDIT-13** — mapping targets unvalidated; array unbounded per report |
| LLM | Prompt injection via report text | Schema-constrained + Zod + system instruction — sound |
| LLM | Provider error leak | Sanitized (`error.message` only; redaction pass verified) ✅ |
| Logs | Secret leakage | **AUDIT-12** — worker.ts logs `config.redisUrl` (password if redis://user:pass@) |
| UI | XSS | React escaping; no dangerouslySetInnerHTML; CSP prod headers; entity names never rendered as HTML ✅ |
| CI/CD | Supply chain | Actions pinned to SHAs, dependabot cooldown, Trivy + npm audit gates ✅ |
| Data at rest | Report text / PDFs | Postgres/Redis at rest (self-hosted, accepted); PDF not retained (backlog) |
| Deploy | Secrets in env | Compose requires `${VAR:?set in .env}`; no secrets in image ✅ |

## Attack surface (minimal, by design)

- 10 API routes, all behind `requireApiToken` (except login/logout by design).
- One outbound network surface: URL fetch (pinned) + Ollama (local) + optional
  hosted LLM endpoints.
- One inbound binary surface: PDF upload (isolated worker).
- No external JS/CSS/CDN in prod (CSP `default-src 'self'`).

## New findings since the 2026-08-05 ledger

| ID | Sev | Area | One-line |
|---|---|---|---|
| AUDIT-01 | High | ingestion | no body-read timeout after headers → slowloris stalls pipeline |
| AUDIT-02 | Med | auth | malformed cookie value → 500 not 401 |
| AUDIT-03 | Med | API | active-cap TOCTOU |
| AUDIT-04 | Med | auth | no login rate limit |
| AUDIT-11 | Low | SSRF | fe80::/10 partial, 6to4 + IPv4-compat IPv6, 192.0.x over-block |
| AUDIT-12 | Low | ops | redisUrl logged |
| AUDIT-13 | Low | API | feedback mapping unvalidated + unbounded |
| AUDIT-14 | Low | API | session-probe pseudo-route fragile |

## Accepted / documented (unchanged)

- `Math.random` retry jitter (bearer.yml) — not crypto.
- corpus.ts dynamic regex (nosemgrep) — static MITRE bundle, hash-verified at refresh.
- CI service creds placeholders (gitleaks:allow) — loopback ephemeral.
- LLM provider absence → 503 — config, not a leak.

## Verdict

No Critical. One High (AUDIT-01, easy fix). Four Medium, eight Low — none structural.
Posture remains appropriate for a single-operator self-hosted CTI tool; the upgrade
path (multi-user auth, ClamAV, object storage) is already mapped in the roadmap.
