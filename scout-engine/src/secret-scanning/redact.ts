// scout-engine/src/secret-scanning/redact.ts
import { FORBIDDEN_FIELD_PATTERNS } from './constants.js';

export function displaySafePath(
  relativePath: string | null | undefined,
  policy: string = 'relative',
): string {
  if (!relativePath) return 'location withheld';
  if (relativePath.startsWith('/') || relativePath.includes('..') || relativePath.includes('\\')) {
    return 'location withheld';
  }
  if (policy === 'basename') {
    const parts = relativePath.split('/');
    return parts[parts.length - 1] || relativePath;
  }
  return relativePath;
}

export function stripForbiddenFields(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenFields(item));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(key))) continue;
    out[key] = stripForbiddenFields(child);
  }
  return out;
}

export function assertNoProhibitedExport(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (/sk_live_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}/.test(json)) {
    throw new Error('export_contains_credential_shaped_value');
  }
  if (/"match_text"|"Secret"|"author_email"|"absolute_path"/i.test(json)) {
    throw new Error('export_contains_forbidden_field');
  }
}
