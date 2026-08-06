# Chronicle — Roadmap

Status and phase order live in [`docs/tasks.md`](tasks.md) ("Next", "In progress",
"Deferred / backlog" sections) — that file is the working source of truth and is
updated as work happens. This page is the stable forward view.

## Current phase

**2-G (deployment)** — docker-compose stack (app + worker + postgres + redis), GHCR
pull, UI auth (HttpOnly cookie session). Merged `cd50532` (2026-08-06).

## Next (in order, each on its own branch)

1. **2-C** — Neo4j as a compose service + `neo4j-driver` + `GraphStore` seam (single
   batched `UNWIND` write, env-gated, best-effort).
2. **2-H** — ClamAV compose service + stdlib INSTREAM client (no new npm deps) before
   PDF parsing; worker network restricted.
3. **Backlog** (audit findings): PDF object storage, Redis-backed LLM cache, DR
   backups, structured JSON logging.

## Deferred

- 2-E-D workbench timeline UI panel (mirrors 2-F, pending user spec).
- Deterministic IOC pre-extraction.
- Frontend redesign (three design docs in [`docs/designs/`](designs/)).

## Later / not planned

- OpenTelemetry (YAGNI until metrics needed).
- Version-tagged releases (CD scans the `main` tag; a `v*` tag push needs the Trivy
  step pointed at it).

Details and history: [`docs/tasks.md`](tasks.md) · [`docs/changelog.md`](changelog.md)
