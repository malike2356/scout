/** Strip forbidden secret-scan fields from API payloads before UI render. */
const FORBIDDEN_KEYS = [
  /^secret$/i,
  /^secrets$/i,
  /^password$/i,
  /^token$/i,
  /^api[_-]?key$/i,
  /^private[_-]?key$/i,
  /^credential/i,
  /^match/i,
  /^source/i,
  /^file[_-]?content$/i,
  /^content$/i,
  /^raw/i,
  /^env/i,
  /^authorization$/i,
  /^absolute[_-]?path$/i,
  /^full[_-]?path$/i,
  /^author[_-]?email$/i,
  /^committer[_-]?email$/i,
  /^email$/i,
];

export function isForbiddenDisplayKey(key: string): boolean {
  return FORBIDDEN_KEYS.some((re) => re.test(key));
}

export function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('..');
}

const ALLOWED_EMAIL_KEYS = new Set(['actor', 'requested_by', 'remediation_owner']);

export function sanitizeRepoSecurityValue(
  value: unknown,
  parentKey: string = '',
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (looksLikeAbsolutePath(value)) return '[redacted-path]';
    if (
      !ALLOWED_EMAIL_KEYS.has(parentKey) &&
      value.includes('@') &&
      value.includes('.') &&
      !value.includes(' ')
    ) {
      return '[redacted-email]';
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeRepoSecurityValue(item, parentKey));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenDisplayKey(key)) continue;
      out[key] = sanitizeRepoSecurityValue(child, key);
    }
    return out;
  }
  return value;
}

export function displayPath(
  relativePath: string | null | undefined,
  policy: string = 'relative',
): string {
  if (!relativePath) return 'location withheld';
  if (looksLikeAbsolutePath(relativePath)) return 'location withheld';
  if (policy === 'basename') {
    const parts = relativePath.split('/');
    return parts[parts.length - 1] || relativePath;
  }
  return relativePath;
}
