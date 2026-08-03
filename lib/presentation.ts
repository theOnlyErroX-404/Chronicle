// Single source of truth for how the UI presents graph data, so a display
// literal (a color, a size limit, a type label) is defined once and shared by
// the server default and the client component instead of being hardcoded twice.

export const MAX_REPORT_BYTES = 10 * 1024 * 1024;

export const ENTITY_TYPE_COLORS: Record<string, string> = {
  "threat-actor": "#ef4444",
  malware: "#f97316",
  tool: "#eab308",
  "web-shell": "#84cc16",
  vulnerability: "#a855f7",
  indicator: "#06b6d4",
  sector: "#22c55e",
  country: "#3b82f6",
  campaign: "#ec4899",
  email: "#14b8a6",
  "file-path": "#94a3b8",
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  "threat-actor": "Threat actor",
  malware: "Malware",
  tool: "Tool",
  "web-shell": "Web shell",
  vulnerability: "Vulnerability",
  indicator: "Indicator",
  sector: "Sector",
  country: "Country",
  campaign: "Campaign",
  email: "Email",
  "file-path": "File path",
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  for (const unit of ["KB", "MB", "GB", "TB"]) {
    value /= 1024;
    if (value < 1024 || unit === "TB") {
      return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(value)} TB`;
};
