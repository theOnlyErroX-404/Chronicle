# Decisions

Record of architectural and tooling decisions. The authoritative user-confirmed
decisions list lives in [`docs/tasks.md`](../tasks.md) ("LOCKED PLAN — decisions");
this index maps each area to its primary source so there is a single copy of each
decision, not duplicates.

| Area | Decision record |
|---|---|
| Stack / framework | `docs/architecture/architecture.md` (blueprint v1.1) |
| User-confirmed locked decisions (phases, Prisma, infra, parallelism, queue) | `docs/tasks.md` → "LOCKED PLAN — decisions" |
| Extraction model choice (nemotron-mini vs qwen2.5:3b, measured) | `docs/tasks.md` → "Measured LLM performance" |
| Auth (static token → HttpOnly cookie session) | this session (2026-08-06); see PR #22 |
| Deployment (Coolify local, GHCR pull, Ollama host-side) | `docs/roadmap.md` + `docker-compose.yml` |
| Security posture | `docs/security/security-audit.md` + `docs/security/code-findings.md` |
| Module boundaries | `.dependency-cruiser.cjs` (enforced) |
| Toolchain usage (Ponytail / Understand / Graphify) | [`tooling/README.md`](tooling/README.md) |

## Decision log — 2026-08-06

- **Adopt Graphify as the primary repo-analysis tool.** PyPI `graphifyy` v0.9.34
  (CLI `graphify`), user-level install (PEP 668 machine: `pip install --user
  --break-system-packages graphifyy`). Tree-sitter AST extraction is offline and
  free; output `graphify-out/` is git-ignored and regenerated on meaningful
  changes. Rationale: queryable architecture graph (`graphify query`) beats
  grepping; Understand remains available for dashboard/diff use.
- **Correction to earlier guidance:** a previous session rejected "Graphify"
  based on the npm package `graphify` (a random-graph generator). The real tool
  is the PyPI `graphifyy` package — verified working on this repo (495 nodes,
  1024 edges, 24 communities, 2026-08-06).
| Toolchain usage (Ponytail / Understand / Graphify) | [`tooling/README.md`](tooling/README.md) |

## How new decisions get recorded

1. User confirms a decision during a session.
2. It is written into `docs/tasks.md` ("LOCKED PLAN — decisions") — the working memory.
3. If it outlives the current phase, this index gains a row pointing at the source.
4. Structural changes land in `docs/architecture/architecture.md`.

No decision is duplicated here — this file is an index only.
