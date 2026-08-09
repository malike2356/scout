// scout-engine/src/secret-scanning/constants.ts
export const SECRET_SCAN_SCHEMA_VERSION = '1.0.0';
export const SECRET_SCAN_POSTURE_SCHEMA_VERSION = '1.0.0';

export const MAX_INGEST_BYTES = 256 * 1024;
export const MAX_FINDINGS_PER_INGEST = 500;
export const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export const SCAN_MODES = ['current', 'staged', 'history', 'environment'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SCAN_STATUSES = ['completed', 'failed', 'partial'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const REMEDIATION_STATUSES = [
  'open',
  'acknowledged',
  'rotation-required',
  'rotation-in-progress',
  'verification-pending',
  'resolved',
  'accepted-risk',
  'false-positive',
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

/** Keys / shapes that must never appear in an ingest envelope. */
export const FORBIDDEN_FIELD_PATTERNS: RegExp[] = [
  /^secret$/i,
  /^secrets$/i,
  /^password$/i,
  /^passwd$/i,
  /^token$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^api[_-]?key$/i,
  /^private[_-]?key$/i,
  /^credential(s)?$/i,
  /^match$/i,
  /^match[_-]?text$/i,
  /^matched[_-]?text$/i,
  /^source$/i,
  /^source[_-]?(text|content|file|code)$/i,
  /^file[_-]?content$/i,
  /^content$/i,
  /^raw$/i,
  /^raw[_-]?output$/i,
  /^env(ironment)?[_-]?(content|value|file|dump)$/i,
  /^authorization$/i,
  /^auth[_-]?header$/i,
  /^bearer$/i,
  /^absolute[_-]?path$/i,
  /^full[_-]?path$/i,
  /^author[_-]?email$/i,
  /^committer[_-]?email$/i,
  /^email$/i,
];

export const TERMINAL_REMEDIATION = new Set<RemediationStatus>([
  'resolved',
  'accepted-risk',
  'false-positive',
]);
