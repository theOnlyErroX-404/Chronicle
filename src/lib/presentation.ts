// Single source of truth for how the UI presents graph data, so a display
// literal (a color, a size limit, a type label) is defined once and shared by
// the server default and the client component instead of being hardcoded twice.

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

// Confidence drives the semantic dual accent: verified (teal) vs needs-review
// (rust). The percentage is ALWAYS shown next to the color, never the color
// alone. Mirrors --teal / --rust in globals.css for the canvas renderer.
const CONFIDENCE_VERIFIED = 0.7;

export const confidenceColor = (value: number): string =>
  value >= CONFIDENCE_VERIFIED ? '#4a8b8c' : '#c4622d';

// Server job statuses (queued/ingesting/extracting/modeling/done/failed) map to
// analyst-facing stage names for the status screen: pending → extracting →
// mapping → done. The returned label is shown verbatim under the stepper.
export const JOB_STAGE_LABELS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'extracting', label: 'Extracting entities' },
  { key: 'mapping', label: 'Mapping & graph' },
  { key: 'done', label: 'Done' },
];

export const jobStage = (status: string, progress?: string): { stage: string; label: string } => {
  switch (status) {
    case 'queued':
      return { stage: 'pending', label: 'Waiting for a worker' };
    case 'ingesting':
      return { stage: 'extracting', label: 'Fetching report text' };
    case 'extracting':
      return {
        stage: 'extracting',
        label: progress ? `Extracting entities · ${progress}` : 'Extracting entities',
      };
    case 'modeling':
      return { stage: 'mapping', label: 'Building graph and mappings' };
    case 'done':
      return { stage: 'done', label: 'Analysis complete' };
    default:
      return { stage: 'failed', label: 'Analysis failed' };
  }
};
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  for (const unit of ['KB', 'MB', 'GB', 'TB']) {
    value /= 1024;
    if (value < 1024 || unit === 'TB') {
      return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(value)} TB`;
};

export const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;
