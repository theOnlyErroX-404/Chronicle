import { ReportWorkbench } from '@/components/report-workbench';

export default function Home() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Chronicle / ThreatGraph</p>
        <h1>Turn threat reporting into analyst-reviewable intelligence.</h1>
        <p className="lead">
          A local-first pipeline for extracting CTI entities and relationships, rendering an
          interactive graph, and exporting STIX 2.1-lite results.
        </p>
      </header>
      <ReportWorkbench />
      <section className="principles" aria-label="Phase 1 architecture">
        <article>
          <h2>Safe ingestion</h2>
          <p>
            URL requests reject private-network destinations and validate every redirect. PDF size
            and signature are checked before parsing.
          </p>
        </article>
        <article>
          <h2>Replaceable model seam</h2>
          <p>
            Extraction depends on a small LlmClient interface. Phase 1 uses Ollama with qwen2.5:3b
            and JSON-schema-constrained output.
          </p>
        </article>
        <article>
          <h2>Human review first</h2>
          <p>
            Every result is a candidate: the graph is designed as an analytical first draft, never a
            substitute for validation.
          </p>
        </article>
      </section>
    </main>
  );
}
