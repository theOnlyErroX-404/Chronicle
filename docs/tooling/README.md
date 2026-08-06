# Tooling — what this repo uses, and why

## Repository analysis & architecture

| Tool | Status | Role here |
|---|---|---|
| **Ponytail** | ✅ Installed (global opencode skill, `~/.config/opencode/ponytail/`) | Working mode for every code change: smallest diff, stdlib-first, YAGNI. Actively used — see `ponytail:` comments in `src/`. |
| **Graphify** | ✅ Installed (PyPI `graphifyy` v0.9.34, user-level `pip install --user --break-system-packages graphifyy`; CLI `graphify`) | **Primary repo-analysis tool.** Builds a queryable knowledge graph from the codebase with tree-sitter AST — fully offline, no API cost on code files. Output lands in `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `graph.html`, cache). Commands: `graphify .` (build), `graphify update .` (incremental), `graphify query "…"`, `graphify path A B`, `graphify explain X`, `graphify cluster-only .` (regenerate report without re-extracting). Prefer `graphify query` over grepping for architecture questions. Git-ignored — regenerate after meaningful changes. |
| **Understand** | ✅ Installed (skills in `~/.agents/skills/understand*`) | Interactive knowledge graph of the codebase (`knowledge-graph.json` + dashboard). Secondary/on-demand: use for `/understand-diff` per change or deep dives. Overlaps with Graphify — use Graphify first, Understand when a dashboard or per-change analysis is wanted. |

## Quality gates (enforced in CI — `.github/workflows/ci.yml`)

| Tool | Local command | Role |
|---|---|---|
| TypeScript | `npm run typecheck` | Strict type checking |
| ESLint (next config) | `npm run lint` | Linting |
| Prettier | `npm run prettier:check` | Formatting gate |
| Vitest | `npm test` | Unit tests (21 files, 197 passing) |
| dependency-cruiser | `npm run deps:check` | Module-boundary enforcement (modular monolith) |
| esbuild | `npm run build:worker` | Bundles the extraction worker into the standalone image |

## Security scanners

| Tool | Status | Role |
|---|---|---|
| CodeQL | ✅ CI (`.github/workflows/codeql.yml`) | GitHub-native static analysis |
| npm audit | ✅ CI (`.github/workflows/security.yml`) | Known-vulnerable dependencies |
| Trivy (image) | ✅ CI (`.github/workflows/cd.yml`) | Container image scan on push |
| Bearer / Semgrep | ⚠️ Skills installed, **CLIs not installed** (no host install, per prior audit decision) | Manual SAST when needed; `bearer.yml` holds accepted findings. Add only if a scan is explicitly requested. |

## Runtime tools

Docker, Ollama (host systemd service), curl/jq/rg — installed. Postgres + Redis run
as ad-hoc containers locally; the canonical shape is `docker-compose.yml`.

## Notes

- `.opencode/` (project skills: security-review, semgrep, z-audit, design, etc.) is
  git-ignored local agent config, not part of the product.
- `vibeguard.config.json` / `opencode.json` — local opencode plugin config, git-ignored.
- Decision to use/not use each tool is recorded in `docs/decisions/README.md`.
