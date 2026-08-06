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
