# Chronicle — Roadmap

Status and phase order live in [`docs/tasks.md`](tasks.md) ("Next", "In progress",
"Deferred / backlog" sections) — that file is the working source of truth and is
updated as work happens. This page is the stable forward view.

## Current phase

**2-I (audit fixes) — done** on branch `fix/audit-findings` (2026-08-06, awaiting
merge): all AUDIT-01..14 findings fixed with tests; gates green (218 passed, coverage
93.4%/81.6%). Next: **2-C (Neo4j graph persistence)**, starting with the graph-design
session that mirrors Graphify's output organization.

## Next (in order, each on its own branch)

1. **2-C** — Neo4j as a compose service + `neo4j-driver` + `GraphStore` seam (single
   batched `UNWIND` write, env-gated, best-effort).
2. **2-H** — ClamAV compose service + stdlib INSTREAM client (no new npm deps) before
   PDF parsing; worker network restricted.
3. **Backlog** (audit deferred items): PDF object storage, Redis-backed LLM cache, DR
   backups, structured JSON logging, llm-client.ts split, golden-set enrichment.

## Deferred

- 2-E-D workbench timeline UI panel (mirrors 2-F, pending user spec).
- Deterministic IOC pre-extraction.
- Frontend redesign (four design docs in [`docs/designs/`](designs/)).

## Later / not planned

- OpenTelemetry (YAGNI until metrics needed).
- Version-tagged releases (CD scans the `main` tag; a `v*` tag push needs the Trivy
  step pointed at it).

Details and history: [`docs/tasks.md`](tasks.md) · [`docs/changelog.md`](changelog.md)
