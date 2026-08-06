import { ReportWorkbench } from '@/components/report-workbench';

export default function Home() {
  return (
    <main>
      <header className="brand-bar">
        <p className="eyebrow">Chronicle / ThreatGraph</p>
        <p className="brand-sub">Local AI-assisted threat report analysis</p>
      </header>
      <ReportWorkbench />
    </main>
  );
}
