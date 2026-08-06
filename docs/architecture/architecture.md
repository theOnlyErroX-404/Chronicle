# Chronicle — Threat Report Knowledge Graph Analyzer
## Technical Architecture Blueprint

**Document owner:** Abdullah Mousa - theOnlyErroX-404
**Role modeled:** Principal Software Architect / Systems Engineer
**Status:** Pre-development blueprint, v1.1 (Node/Next.js + self-hosted Ollama stack)
**Related:** Designed to operate standalone, with a defined path to becoming a DeltaTI ingestion module

---

## A note on scale, before anything else

Every section below is written the way a principal architect would write it for a *real* system — with justification, not just buzzwords. But the single most important architectural decision in this document is the one made right now:

**This is a solo-developer, portfolio-grade analytical tool, not a multi-tenant SaaS product.** Applying full microservice/Kubernetes/enterprise-observability patterns here would violate YAGNI and KISS — the exact principles you asked me to align with. So this blueprint deliberately right-sizes: a **modular monolith** with strict internal boundaries, deployed as a small number of containers, with clear seams where it *could* split into services if DeltaTI ever needs it to. Every infra decision below states the "would upgrade to X if Y" condition, so you know what you're deferring and why.

**v1.1 change:** the stack is now Node/TypeScript (Next.js) instead of Python/FastAPI, and the LLM is self-hosted via **Ollama running `qwen2.5:3b`** instead of a hosted API. This is a real trade — you're swapping API cost for hardware/latency cost and, honestly, some extraction quality. Where that trade-off matters, it's called out explicitly rather than glossed over.

---

## 1. Executive Summary & Scope

### Problem & Solution

**Problem:** CTI analysts spend a disproportionate amount of time on mechanical extraction — reading a vendor blog or threat report and manually pulling out actors, malware names, CVEs, IOCs, and mapping behavior to ATT&CK — before any actual analytical judgment happens. This is slow, inconsistent across analysts, and doesn't scale with report volume.

**Solution:** ThreatGraph ingests a single threat report (PDF or blog URL), uses an LLM-driven extraction pipeline to pull structured entities and relationships, maps observed behavior to MITRE ATT&CK techniques, reconstructs a campaign timeline, and renders the result as an interactive knowledge graph. Output is STIX 2.1-lite JSON, so it's portable into DeltaTI or any other STIX-consuming tool. The tool doesn't replace analyst judgment — it produces a fast, structured first draft that an analyst reviews, corrects, and builds on.

### Functional Requirements

Core user journey:
1. Analyst submits a report (PDF upload or blog URL).
2. System extracts and cleans the source text.
3. System extracts entities: threat actors, malware/tools, CVEs, IOCs (IP, domain, hash, email, file path), targeted sectors/countries, campaign/operation names.
4. System extracts relationships between entities (`uses`, `exploits`, `targets`, `attributed-to`, `communicates-with`, `mitigated-by`).
5. System maps extracted behavior to MITRE ATT&CK techniques, with a confidence score per mapping.
6. System reconstructs a chronological timeline from dates/temporal references in the text.
7. System assembles a STIX 2.1-lite bundle (subset of STIX objects sufficient for this use case, not full spec compliance).
8. Analyst views results as an interactive graph (nodes/edges) and a timeline view.
9. Analyst can correct/reject extracted entities or mappings (human-in-the-loop feedback — this matters more than it sounds, see §3 and §6, and matters *even more* with a 3B model, see the Assumptions section below).
10. Analyst exports the result (STIX JSON, or a rendered graph image).

Explicitly **out of scope for v1** (stated so scope doesn't silently creep):
- Multi-report correlation / cross-report entity resolution
- Continuous feed ingestion (this was your original constraint — no pipeline)
- IOC enrichment against external threat intel APIs (VirusTotal, OTX, etc.)
- Multi-user accounts / RBAC
- Non-English report support (Arabic support is a natural Phase 3 stretch given your bilingual background, not a v1 requirement)

### Non-Functional Requirements

Right-sized for actual usage, not enterprise defaults:

| Attribute | Target | Rationale |
|---|---|---|
| Availability | ~99% (best-effort single instance) | Personal/demo tool; no SLA-bearing customers |
| Latency | Report processing: 1–5 minutes acceptable (async job) | CPU/modest-GPU inference on a 3B model is slower per chunk than a hosted API call; `qwen2.5:3b` is small enough to be usable without a dedicated GPU, but budget more wall-clock time than you would with Claude API |
| API response (status/read) | <300ms p95 | Standard web responsiveness for the UI — unaffected by the LLM swap, since this path doesn't touch the model |
| Scalability | Single instance handles current load; horizontal worker scaling designed-in but not required at launch | Avoid pre-optimizing for load that doesn't exist yet |
| Maintainability | Bounded contexts with clear interfaces; >80% test coverage on extraction/mapping logic | This is the part of the codebase that will change most as you tune prompts and mappings |
| Cost | $0 marginal cost per report (self-hosted model) — the real cost is now hardware and *your time* tuning a small model to be reliable | With Claude API this section was about token spend; with Ollama it's about not burning weeks fighting a 3B model's inconsistency instead of shipping |

### Assumptions & Constraints

- **Technical:** Reports are public OSINT sources (vendor blogs, PDFs) — no classified or access-restricted content, no auth-walled sources.
- **Business:** Single operator (you) initially; no monetization or compliance obligations (GDPR/HIPAA) apply at this stage — noted as *not applicable*, not ignored.
- **Language:** English-language reports for v1; Arabic-language reports are a defined stretch goal, not a current constraint on the schema (the data model should not assume English-only entity strings).
- **LLM dependency — updated for self-hosting:** the system now depends on a locally-run Ollama instance serving `qwen2.5:3b` instead of an external API. This removes the external rate-limit/cost risk from the original design, but introduces a different one: **a 3B-parameter model is meaningfully less reliable at structured entity/relationship extraction than a frontier hosted model.** Expect more malformed-JSON retries, lower recall on subtle relationships, and weaker performance on ATT&CK *behavioral inference* specifically (matching implied technique use, not just explicit mentions). This is a named risk, addressed concretely in §2, §4, and §6 — not a footnote.
- **Model swap point (deliberate design decision):** the Extraction context talks to the model through a single internal interface (`LlmClient`), not directly to the Ollama SDK. Today it points at local `qwen2.5:3b`. If extraction quality proves insufficient once you test it against the golden dataset (see §6, Phase 1), swapping to a larger local model (`qwen2.5:14b`, hardware permitting) or a hosted API is a one-file change, not a rewrite. Build this seam in from day one — retrofitting it later is far more painful.

---

## 2. Engineering Principles & Architecture

### Architecture Pattern: Modular Monolith

**Justification:** Microservices buy you independent scaling, independent deployment, and fault isolation between teams — none of which apply to a single developer building a single deployable tool. The cost of microservices (network overhead, distributed tracing complexity, service discovery, multiple CI/CD pipelines) would dominate actual feature work. A **modular monolith** — one deployable application, internally organized into strict bounded contexts with well-defined interfaces — gives you:

- DDD-aligned module boundaries (so a future split into services, e.g. if the "Extraction" context becomes its own DeltaTI microservice, is a refactor, not a rewrite)
- Single build/deploy/test pipeline (fits solo-dev velocity)
- In-process calls between modules during v1 (fast, simple, debuggable) instead of premature network calls
- **A single language across the whole stack (TypeScript)** — this is the actual argument *for* Next.js here beyond just "you asked for it": one type system shared between API routes and frontend, one dependency ecosystem, one less context switch for a solo developer than the earlier Python/React split had.

The **asynchronous processing** of report analysis (LLM calls, graph construction) *is* handled via a task queue internally — this isn't a contradiction of "monolith," it's necessary because report processing now takes 1–5 minutes with a local model and can't block an HTTP request. The queue lives inside the same deployable unit for now (Redis + a **BullMQ** worker process), not as a separately-scaled service.

### High-Level Topology

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT                                                       │
│  Next.js App Router (React) — graph visualization (Cytoscape. │
│  js) + timeline (D3.js or vis-timeline)                       │
└───────────────────────────┬─────────────────────────────────┘
                             │ HTTPS (REST + SSE for job status)
┌───────────────────────────▼─────────────────────────────────┐
│  EDGE                                                         │
│  Caddy or Nginx reverse proxy — TLS termination, static assets│
│  (Cloudflare in front if publicly deployed, for TLS/DDoS)     │
└───────────────────────────┬─────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────┐
│  APPLICATION (modular monolith — Next.js / Node / TypeScript) │
│                                                                 │
│  ┌───────────────┐ ┌───────────────┐ ┌────────────────────┐  │
│  │  Ingestion    │ │  Extraction   │ │  Knowledge Modeling │  │
│  │  Context      │→│  Context      │→│  Context            │  │
│  │  (PDF/URL     │ │  (LLM entity/ │ │  (dedup, STIX-lite  │  │
│  │  fetch+clean) │ │  relation ext)│ │  bundle assembly)   │  │
│  └───────────────┘ └───────┬───────┘ └──────────┬─────────┘  │
│                             │ LlmClient interface  │            │
│                             ▼                      │            │
│                    ┌─────────────────┐             │            │
│                    │  OLLAMA          │             │            │
│                    │  (self-hosted)   │             │            │
│                    │  qwen2.5:3b       │             │            │
│                    └─────────────────┘             │            │
│                                                       │            │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────▼─────────┐ │
│  │  ATT&CK       │ │  Timeline     │ │  Graph/API           │ │
│  │  Mapping      │ │  Context      │ │  Context              │ │
│  │  Context      │ │  (temporal    │ │  (serves graph JSON   │ │
│  │  (embedding   │ │  reasoning)   │ │  to frontend)          │ │
│  │  similarity,  │ │               │ │                        │ │
│  │  Ollama embed │ │               │ │                        │ │
│  │  model)       │ │               │ │                        │ │
│  └───────────────┘ └───────────────┘ └───────────────────────┘ │
│                                                                 │
│  Job Queue (BullMQ, Redis-backed) — glues async pipeline steps│
└───────┬──────────────────────────────────────┬────────────────┘
        │                                        │
┌───────▼────────┐                     ┌─────────▼──────────┐
│  DATA — SQL     │                     │  DATA — GRAPH        │
│  Postgres       │                     │  Neo4j:               │
│  (via Prisma):  │                     │  entities + relations │
│  reports, jobs, │                     │  (queryable via Cypher│
│  raw extraction,│                     │  for graph traversal, │
│  feedback,      │                     │  writes batched via   │
│  STIX bundles   │                     │  UNWIND)               │
│  (JSONB)        │                     │                        │
└─────────────────┘                     └────────────────────────┘
        │
┌───────▼────────┐        ┌──────────────────────┐
│  Object Storage │        │  Cache — Redis         │
│  (S3-compatible │        │  LLM response cache     │
│  or local for   │        │  by content hash;        │
│  v1) — raw PDFs │        │  precomputed ATT&CK       │
└─────────────────┘        │  technique embeddings     │
                            │  (Ollama embed model)      │
                            └────────────────────────────┘
```

### Domain-Driven Design: Bounded Contexts

| Context | Responsibility | Key entities |
|---|---|---|
| **Ingestion** | Accept PDF/URL, extract raw text, clean/normalize (strip boilerplate, nav menus, ads) | `Report`, `RawText` |
| **Extraction** | Chunk text, call the local LLM (via `LlmClient`) for entity + relationship extraction, return structured candidates | `ExtractedEntity`, `ExtractedRelationship` |
| **Knowledge Modeling** | Deduplicate/resolve entities within a report, assemble STIX-lite bundle, persist to graph DB | `StixBundle`, `GraphNode`, `GraphEdge` |
| **ATT&CK Mapping** | Match extracted behavior descriptions against ATT&CK technique corpus via embedding similarity, produce confidence-scored mappings | `TechniqueMapping` |
| **Timeline** | Parse temporal expressions, order events chronologically, handle relative/ambiguous dates | `TimelineEvent` |
| **Graph/API** | Serve processed results to the frontend; job status; export endpoints | `JobStatus`, API DTOs |
| **Feedback** (cross-cutting) | Capture analyst corrections; feed back into prompt/mapping quality over time | `Correction` |

Each context is a TypeScript module with an explicit public interface (a small set of exported functions/classes other contexts import); everything else stays internal to the module. This is the enforcement mechanism for "modular" — nothing structural, just discipline plus a lint rule (e.g., `eslint-plugin-boundaries` or `dependency-cruiser`) that fails CI if a context reaches into another context's internals.

### Data Flow

**Synchronous (request/response):**
- `POST /reports` → validates input, persists a `Report` + `Job` row, enqueues processing, returns `202 Accepted` with `job_id` immediately.
- `GET /jobs/{id}` → polls current status (`pending`, `extracting`, `mapping`, `done`, `failed`).
- `GET /reports/{id}/graph`, `/timeline`, `/stix` → read-complete results once `done`.

**Asynchronous (event/queue-driven), inside the BullMQ worker process:**
1. Worker picks up job from the Redis-backed queue.
2. Ingestion: fetch PDF/URL → extract text → clean.
3. Extraction: chunk text into **smaller-than-you'd-use-with-Claude segments** (a 3B model's effective attention degrades faster over long, dense context than a frontier model's — smaller chunks with more explicit few-shot examples in the prompt produce more reliable output than one large context dump) → sequential or lightly-parallel local inference calls (bounded by however many concurrent Ollama requests your hardware can actually serve — likely 1–2, not the wide fan-out you'd do against a hosted API) → merge candidate entities/relationships.
4. Knowledge Modeling: entity resolution within the report (e.g., "APT trailing snow" and "TrailingSnow Group" merged) → assemble STIX-lite bundle → write to Postgres (bundle) + Neo4j (graph, batched via `UNWIND`).
5. ATT&CK Mapping: for each behavior-bearing sentence/entity, embed (via an Ollama embedding model, e.g. `nomic-embed-text`) and compare against precomputed ATT&CK technique embeddings → attach top-k matches with similarity scores.
6. Timeline: extract date expressions, resolve relative dates against report publish date, order events.
7. Job marked `done`; frontend either polls or receives a Server-Sent Event.

### Infrastructure & Deployment

- **Containerization:** Docker for all components; `docker-compose` for local dev (Next.js app + BullMQ worker + Postgres + Neo4j + Redis + Ollama).
- **Ollama hosting — the real decision point:** `qwen2.5:3b` is small enough (roughly 2GB quantized) to be genuinely usable on CPU-only hardware, which is the main reason it's a reasonable choice for a free/local setup — you're not forced into a GPU rental just to get something working. Two realistic deployment shapes:
  - **Local-only (recommended for development and for demoing the portfolio piece):** Ollama runs on your own machine; the rest of the stack can run alongside it or in the cloud pointed at your machine's Ollama endpoint while you're actively demoing. Free, simplest, but the app is only "live" when your machine is on.
  - **Small always-on CPU VPS running Ollama too:** works for `qwen2.5:3b` specifically (it would not work for a 70B model), but expect the 1–5 minute per-report processing time from the table above, and size the VPS with enough RAM (8GB+) to hold the model comfortably alongside Postgres/Neo4j/Redis.
  - **Not recommended for v1:** renting a GPU instance just for a 3B model — the model doesn't need it, and it reintroduces the recurring cost you're trying to avoid by going local in the first place.
- **Deployment target (v1):** Single small VPS or a managed container platform (Fly.io / Render / a single DigitalOcean droplet). **Not Kubernetes** — there is no multi-service scaling problem to solve yet.
- **IaC:** Terraform, scoped to what actually exists as managed cloud infra (DNS record, object storage bucket, managed Postgres if you outgrow the containerized one). Kept intentionally small.
- **Secrets:** Environment variables via a `.env` file locally and platform-native secret storage in deployment (never committed; 12-Factor config principle). Note there's no LLM API key to manage anymore — one less secret, one less rotation concern.

---

## 3. Detailed System Design

### API Design (REST, versioned via URI)

```
POST   /api/v1/reports              # submit PDF (multipart) or {"url": "..."}
GET    /api/v1/jobs/{job_id}        # processing status
GET    /api/v1/reports/{id}         # report metadata
GET    /api/v1/reports/{id}/graph   # nodes/edges JSON for visualization
GET    /api/v1/reports/{id}/timeline
GET    /api/v1/reports/{id}/stix    # STIX 2.1-lite bundle export
GET    /api/v1/reports/{id}/attck   # technique mappings + confidence
POST   /api/v1/reports/{id}/feedback # analyst correction (entity/edge/mapping)
```

Example response shape for `/graph`:

```json
{
  "nodes": [
    {"id": "actor-1", "type": "threat-actor", "name": "TrailingSnow", "confidence": 0.91},
    {"id": "malware-1", "type": "malware", "name": "RustyWater", "confidence": 0.95},
    {"id": "cve-1", "type": "vulnerability", "name": "CVE-2025-XXXX", "confidence": 0.99}
  ],
  "edges": [
    {"source": "actor-1", "target": "malware-1", "type": "uses", "confidence": 0.88},
    {"source": "malware-1", "target": "cve-1", "type": "exploits", "confidence": 0.79}
  ]
}
```

Conventions: nouns for resources, standard HTTP verbs/status codes, `202` for accepted-async, cursor-based pagination if a report ever has enough entities to need it (unlikely at single-report scale, but stated for consistency), errors as RFC 7807 problem+json. Implemented as Next.js API routes (App Router `route.ts` handlers), request/response bodies validated with **Zod** at the boundary.

### Database & Storage Strategy (Polyglot, justified per store)

| Store | Used for | Why this store, not another |
|---|---|---|
| **Postgres** (via **Prisma** ORM) | Report/job metadata, raw extraction JSON, STIX bundles (as JSONB), feedback records | Relational integrity for jobs/status; JSONB gives schema flexibility for STIX objects without a second document DB; Prisma gives type-safe queries that match the Zod schemas at the API boundary |
| **Neo4j** (official `neo4j-driver` npm package, raw Cypher) | Entity/relationship graph | Native graph traversal (e.g., "show all techniques used by actors that targeted the finance sector") is what Cypher is built for; forcing this into Postgres joins would be slower and uglier |

**Implementation note:** write nodes/edges for a report in a single batched `UNWIND` Cypher statement, not one transaction per entity. Even at single-report scale this avoids unnecessary per-write transaction overhead, and it's the difference between "fine" and "slow" once a report has 50+ entities.

| **Redis** | Job queue backend for BullMQ, LLM response cache (keyed by content hash), precomputed ATT&CK embedding cache | Sub-millisecond cache reads matter for avoiding redundant (and now *slow*, not just costly) local inference calls; also doubles as the queue backend, avoiding a second piece of infra |
| **Object storage** (local disk v1 → S3-compatible later) | Raw uploaded PDFs | Keeps large binary blobs out of Postgres |

High-level schema (Postgres, defined via Prisma schema):

```prisma
model Report {
  id         String   @id @default(uuid())
  sourceType String
  sourceUrl  String?
  filename   String?
  status     String
  createdAt  DateTime @default(now())
}

model Job {
  id             String    @id @default(uuid())
  reportId       String
  state          String
  errorMessage   String?
  startedAt      DateTime?
  finishedAt     DateTime?
}

model ExtractedEntity {
  id             String  @id @default(uuid())
  reportId       String
  type           String
  rawText        String
  normalizedName String
  confidence     Float
}

model AttckMapping {
  id           String @id @default(uuid())
  reportId     String
  entityId     String
  techniqueId  String
  confidence   Float
  matchedText  String
}

model StixBundle {
  id         String   @id @default(uuid())
  reportId   String
  bundleJson Json
  createdAt  DateTime @default(now())
}

model Feedback {
  id              String   @id @default(uuid())
  reportId        String
  targetType      String
  targetId        String
  correctionType  String
  correctedValue  Json
  createdAt       DateTime @default(now())
}
```

**Caching & invalidation:** LLM extraction results are cached by a hash of (chunk text + prompt version). If the prompt changes (you will iterate on this a lot with a 3B model), the cache key changes automatically, so stale results from an old prompt are never served. This caching matters even more now than it did with a hosted API — re-running local inference is slow, not just wasteful. ATT&CK technique embeddings are precomputed once against the official ATT&CK STIX corpus and only recomputed when MITRE publishes a new ATT&CK version.

### Statelessness & Scalability

- API process is fully stateless — all state in Postgres/Neo4j/Redis, so it can be horizontally replicated behind the reverse proxy with zero session affinity concerns.
- Worker processes are the scaling lever that actually matters, but **the real ceiling now is Ollama itself, not your own code** — a single local model instance typically serves one inference request efficiently at a time on modest hardware. Running multiple BullMQ workers doesn't help if they're all queued behind the same Ollama process; concurrency here is bounded by hardware, not `WORKER_COUNT`.
- **Concurrency/race conditions:** the only real contention point is entity resolution during Knowledge Modeling. This is handled by making entity resolution a single-threaded step *per report* — avoids distributed-lock complexity for a problem that doesn't need it.
- **The real bottleneck is now local inference throughput, not an external rate limit** — addressed in §4.

### Third-Party Integrations & Local AI Runtime

- **Ollama (self-hosted, `qwen2.5:3b`)** — entity/relationship extraction, ATT&CK behavioral matching assistance. Not a "third-party" dependency in the API-key sense anymore, but still the core dependency of the whole pipeline; the model-swap seam described in §1 exists specifically because this is a single point of failure for extraction quality. Structured output is produced via Ollama's JSON-schema-constrained generation mode where available, with Zod validation as a hard backstop.
- **Ollama embedding model** (`nomic-embed-text` or similar) — local embeddings for ATT&CK technique matching, keeping the entire pipeline free of external API calls.
- **MITRE ATT&CK STIX corpus** (public, downloaded/cached locally, refreshed periodically) — source of truth for technique descriptions used in embedding-based mapping.
- **Stretch, Phase 3:** VirusTotal / AlienVault OTX for IOC enrichment; MISP/TAXII-compatible export for DeltaTI or other platform interop.

---

## 4. Security, Reliability & Observability

### Security & Privacy

- **AuthN:** v1 is single-user — a static bearer API token is sufficient (12-Factor: config via env var). Upgrade path to OAuth2/JWT (e.g. `next-auth`) is only needed if this becomes multi-user.
- **AuthZ:** N/A at single-user scale; the module boundary is already in place (Feedback context) so RBAC could be layered on later without a redesign.
- **Encryption:** TLS in transit (via edge proxy/Cloudflare); at-rest encryption via the managed Postgres/volume provider's native disk encryption — no custom crypto.
- **OWASP-relevant risks specific to this system, not generic boilerplate:**
  - **SSRF via URL ingestion** is the sharpest real risk here — a "submit a blog URL" feature that fetches arbitrary URLs server-side is a classic SSRF vector. Mitigation: strict allow-list of URL schemes (`http`/`https` only), resolve and reject requests to private/link-local/loopback IP ranges before fetching, timeout + size-limit the fetch.
  - **Stored XSS in rendered graph labels** — extracted entity names come from untrusted report text and are rendered in the frontend graph. Mitigation: treat all extracted strings as untrusted on render (React's default escaping handles this if you don't use `dangerouslySetInnerHTML`), and never render entity names as raw HTML anywhere.
  - **Injection via PDF parsing** — malformed/malicious PDFs are a known attack surface for parsing libraries. Mitigation: use a well-maintained Node parser (e.g. `unpdf` or `pdf-parse`), run parsing in a resource-bounded child process, reject files above a size threshold.
  - **Weaponized threat reports** — this risk is specific to the domain, not generic boilerplate: threat intel PDFs are a documented vector for attacking the researchers reading them. Mitigation: scan every uploaded PDF with ClamAV (or equivalent) before parsing, strip/refuse to execute embedded JavaScript, and run the entire Ingestion context worker with no outbound network access except to object storage — it should never be able to reach the rest of your infrastructure even if a malicious file compromises it.
  - **LLM prompt injection from report content** — a malicious "report" could contain text designed to manipulate the extraction prompt. Mitigation: every extraction call uses Ollama's structured/JSON-schema output mode (not free-text parsing), and every returned object is validated against a **Zod** schema before it's persisted or trusted — malformed or out-of-schema output is rejected and retried, not coerced. This matters *more* with a 3B model than it did with Claude: smaller models are both more prone to malformed JSON and more susceptible to having their output steered by adversarial text in the input, since they have less capacity to "notice" an injection attempt. Extraction results remain *candidates* requiring the human feedback step — with this model size, treat that as load-bearing, not optional polish.

### Reliability & Fault Tolerance

- **Retries:** Local inference calls wrapped with retry logic (e.g., 3 retries) for malformed-JSON output or transient failures — expect to use this more than you would have against Claude's API, since schema-conformance failures are more common with a 3B model.
- **Circuit breaker:** If the local Ollama process is unresponsive or repeatedly erroring (crashed, out of memory, model unloaded), stop dispatching new extraction calls for a cooldown window and mark jobs `queued-delayed` rather than burning through retries against a dead local service.
- **Graceful degradation:** If ATT&CK mapping fails but entity extraction succeeded, still surface the entity graph — don't fail the whole job because one downstream step had an issue.
- **Disaster recovery:** Daily automated Postgres dump + Neo4j export to object storage. RPO ~24h, RTO a few hours — appropriate for a personal analytical tool.

### Observability — right-sized to solo-dev reality

- **Structured logging:** JSON logs to stdout, shipped to a lightweight hosted log service (e.g., Better Stack, Axiom, or persisted log files if fully offline). Every log line carries the `report_id`/`job_id` as a correlation ID, so a single report's path through Ingestion → Extraction → Mapping → Timeline is traceable end-to-end.
- **Tracing:** OpenTelemetry instrumentation on the processing pipeline specifically — now even more valuable than before, since you'll want to see exactly how much of your 1–5 minute processing time is local inference versus everything else, while you're tuning chunk sizes and prompts.
- **Metrics that matter here, not generic ones:** extraction success rate, **JSON-schema-validation failure rate per prompt version** (this is your primary signal for whether `qwen2.5:3b` is holding up — watch it closely), ATT&CK mapping precision against a small labeled eval set, per-report processing latency, local inference time per chunk.
- **Upgrade path:** if this becomes a hosted multi-user DeltaTI service, that's the trigger to add Prometheus/Grafana for real-time dashboards — not before.

---

## 5. DevOps & CI/CD Pipeline

### Pipeline Architecture

- **Branching:** trunk-based with short-lived feature branches; `main` is always deployable.
- **CI (GitHub Actions), on every PR:**
  1. Lint (`eslint`, `prettier --check`)
  2. Unit tests (`vitest`)
  3. Integration tests against ephemeral Postgres/Neo4j/Redis (via `docker-compose` in the CI job) — Ollama itself is mocked in CI via the `LlmClient` interface (see §1) rather than running real local inference in every CI run, which would be slow and non-deterministic
  4. Extraction regression tests against a small **golden dataset** of labeled reports, run against the real model locally/on a schedule (not every CI run, given inference time) — critical for this project specifically, since a small local model's output quality is *more* sensitive to prompt/chunking changes than a frontier model's would be
  5. SAST (`semgrep`) and dependency scanning (`npm audit` / Dependabot)
  6. Build Docker image, scan it with Trivy (fails the build on critical known-CVE base images/packages), push to registry (tagged with commit SHA)
- **CD:** merge to `main` auto-deploys to staging; promotion to production is a manual approval step.

### Environments

`Local (docker-compose, including local Ollama)` → `Staging (same compose stack, smaller instance)` → `Production (promoted image, same infra shape)`.

### Quality Gates

- Unit coverage target: >80% on Extraction, Knowledge Modeling, and ATT&CK Mapping contexts specifically.
- Golden-dataset regression suite (a handful of real, hand-labeled threat reports) — the single highest-leverage quality gate in this pipeline, and the main defense against `qwen2.5:3b`'s output quietly drifting as you tune prompts.

---

## 6. Project Phases & Execution Roadmap

### Phase 1 — MVP (Weeks 1–4)

**Goal:** prove the core value loop end-to-end on a single report — and specifically, find out whether `qwen2.5:3b` is actually good enough before building anything else on top of it.

- Deliverables: PDF/URL ingestion, local LLM-based entity + relationship extraction via Ollama, basic STIX-lite JSON output, simple interactive graph render (in-memory, no DB required yet), minimal web UI.
- Tech stack: Next.js (TypeScript), `unpdf`/`pdf-parse` (PDF parsing), Ollama (`qwen2.5:3b`), Zod, React + Cytoscape.js for graph render.
- Effort: ~60–80 hours (solo, part-time pace).
- Risks & mitigation:
  - **`qwen2.5:3b` extraction quality may be insufficient for reliable relationship extraction, not just entity extraction** (this is the risk most worth naming explicitly — entities like "APT29" or a CVE ID are easy for a small model; correctly linking "Actor X uses Malware Y which exploits CVE Z" is a harder reasoning task that smaller models are more likely to get subtly wrong). Mitigation: build the golden-dataset eval harness in week 1, evaluate entity extraction and relationship extraction *separately* (don't average them into one score — you need to know which one is failing), and use the `LlmClient` swap point immediately if relationship-extraction quality is unusable, rather than trying to prompt-engineer around a capability gap.
  - *Scope creep toward "just one more feature"* → the explicit out-of-scope list in §1 is the guardrail.

### Phase 2 — Hardening & Scaling (Weeks 5–8)

**Goal:** make it a real, persistent, reviewable tool.

- Deliverables: Postgres (Prisma) + Neo4j persistence, async job queue (BullMQ + Redis), ATT&CK mapping via Ollama embedding similarity, timeline construction, human-feedback correction endpoint, basic bearer-token auth, staging deployment.
- Tech stack: Redis, BullMQ, Neo4j, Postgres/Prisma, OpenTelemetry instrumentation on the pipeline.
- Effort: ~80–100 hours.
- Risks & mitigation:
  - *ATT&CK mapping ambiguity* (already hard for humans, harder for a 3B model doing behavioral inference) → start with explicit technique-mention matching only; treat embedding-based behavioral inference as a clearly-labeled "suggested, lower confidence" tier, and expect to lean on the human feedback loop more heavily here than you would with a larger model.
  - *SSRF via URL ingestion* → implement the IP-range allowlist/blocklist before URL ingestion ships, not after.

### Phase 3 — Enterprise & Optimization (Weeks 9–12+)

**Goal:** polish for portfolio use and lay the DeltaTI integration path.

**Reprioritization note:** of the stretch items below, **cross-report entity correlation** is ranked above the others — it's the single feature that most directly turns this from a standalone demo into something that justifies being a DeltaTI module. Arabic support and IOC enrichment are valuable but additive; cross-report correlation changes what the tool fundamentally *is*. If Phase 3 time is limited, this is the one to protect.

- Deliverables: cross-report entity correlation (priority), DeltaTI export/sync path (STIX/TAXII-compatible), local-inference performance tuning (chunk size, prompt length, possibly a larger local model if hardware allows), IOC enrichment stretch (VirusTotal/OTX), Arabic-report support stretch, public demo deployment, written case study of the build.
- Tech stack additions: TAXII client library if DeltaTI integration goes that route; any enrichment API SDKs.
- Effort: ~60–80 hours, more open-ended given the stretch goals.
- Risks & mitigation:
  - *Local inference throughput becomes the limiting factor for a public demo* (multiple visitors submitting reports concurrently would queue behind a single Ollama instance) → for a public demo specifically, consider a request queue with visible position/ETA in the UI rather than pretending this scales like a hosted API would.
  - *DeltaTI integration scope mismatch* → treat the integration as an explicit adapter/translation layer, not an assumption that the schemas are identical.

---

## Summary of deliberate right-sizing decisions

So these don't get lost in the detail above:

1. Modular monolith, not microservices — until there's an actual multi-team or independent-scaling need.
2. Single-VPS/container deployment, not Kubernetes — until there's a real multi-instance load problem.
3. Lightweight hosted logging, not self-hosted ELK — until observability needs real-time dashboards for multiple users.
4. Single bearer token auth, not full OAuth2 — until there's more than one user.
5. Golden-dataset regression testing is treated as equally important as unit tests — because this system's correctness depends on non-deterministic LLM output in a way a typical CRUD app's doesn't, and *more so* with a 3B local model than it would be with a frontier hosted model.
6. **Self-hosted Ollama (`qwen2.5:3b`) over a hosted API — a deliberate cost-for-quality trade, made explicit rather than silent.** The `LlmClient` abstraction exists specifically so this trade can be revisited in one place if Phase 1 testing shows it doesn't hold up, without redesigning the rest of the system.
