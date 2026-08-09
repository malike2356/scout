// scout-engine/src/security/prompt-guard.ts
// Standalone 3-layer prompt distillation filter for Scout's public API.
// This is a self-contained port of the PromptGuard concept used by Propreneur's
// console.labyrinthscout.com; it intentionally does NOT import shield-report,
// deception, or any other console module, and has no runtime dependency on
// Propreneur. Pattern data lives in ./injection-patterns.json (copied locally).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type PatternSeverity = 'info' | 'warning' | 'high' | 'critical';
export type PatternScope = 'input' | 'tool_result';
export type Verdict = 'allowed' | 'flagged' | 'blocked';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface InjectionPattern {
  id: string;
  pattern: string;
  flags?: string;
  severity: PatternSeverity;
  description: string;
  scope: PatternScope;
}

interface CompiledPattern {
  id: string;
  re: RegExp;
  severity: PatternSeverity;
  description: string;
  scope: PatternScope;
}

interface PatternLibraryFile {
  patterns: InjectionPattern[];
  whitelist: string[];
}

interface CompiledLibrary {
  patterns: CompiledPattern[];
  whitelist: string[];
}

export interface PromptFilterResult {
  verdict: Verdict;
  filtered_prompt: string;
  risk_level: RiskLevel;
  distillation: {
    layer_1: string;
    layer_2: string;
    layer_3: string;
  };
  matched_pattern_ids: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedLibrary: CompiledLibrary | null = null;

function loadLibrary(): CompiledLibrary {
  if (cachedLibrary) return cachedLibrary;

  const file = path.join(__dirname, 'injection-patterns.json');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as PatternLibraryFile;

  const patterns = (parsed.patterns ?? []).map((p) => ({
    id: p.id,
    re: new RegExp(p.pattern, p.flags ?? 'i'),
    severity: p.severity,
    description: p.description,
    scope: p.scope,
  }));

  cachedLibrary = { patterns, whitelist: parsed.whitelist ?? [] };
  return cachedLibrary;
}

function isWhitelisted(text: string, whitelist: string[]): boolean {
  const lower = text.toLowerCase();
  return whitelist.some((term) => lower.includes(term.toLowerCase()));
}

function severityRank(severity: PatternSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

function riskLevelFromSeverity(severity: PatternSeverity | null): RiskLevel {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'warning':
      return 'medium';
    default:
      return 'low';
  }
}

function toGlobalFlags(re: RegExp): RegExp {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
}

/**
 * Layer 1: regex match against the input-scoped injection pattern library.
 * Layer 2: strip matched spans from the prompt to produce filtered_prompt.
 * Layer 3: heuristic risk scoring; critical/high pattern hits escalate the verdict.
 */
export function filterPrompt(prompt: string): PromptFilterResult {
  const { patterns, whitelist } = loadLibrary();
  const inputPatterns = patterns.filter((p) => p.scope === 'input');

  const whitelisted = isWhitelisted(prompt, whitelist);
  const matched = whitelisted ? [] : inputPatterns.filter((p) => p.re.test(prompt));

  const layer1 = matched.length === 0
    ? 'Layer 1 (pattern match): no injection patterns matched.'
    : `Layer 1 (pattern match): ${matched.length} pattern(s) matched: ${matched.map((m) => m.id).join(', ')}.`;

  let filteredPrompt = prompt;
  for (const m of matched) {
    filteredPrompt = filteredPrompt.replace(toGlobalFlags(m.re), '[FILTERED]');
  }
  const layer2 = matched.length === 0
    ? 'Layer 2 (span stripping): no spans required stripping.'
    : `Layer 2 (span stripping): stripped ${matched.length} matched span(s) from the prompt.`;

  const highestSeverity = matched.reduce<PatternSeverity | null>((acc, m) => {
    if (!acc) return m.severity;
    return severityRank(m.severity) > severityRank(acc) ? m.severity : acc;
  }, null);

  const riskLevel = riskLevelFromSeverity(highestSeverity);

  let verdict: Verdict = 'allowed';
  if (highestSeverity === 'critical' || highestSeverity === 'high') {
    verdict = 'blocked';
  } else if (highestSeverity === 'warning') {
    verdict = 'flagged';
  }

  const layer3 = highestSeverity
    ? `Layer 3 (heuristic risk): highest matched severity is ${highestSeverity}, risk ${riskLevel}, verdict ${verdict}.`
    : `Layer 3 (heuristic risk): no risk signal detected, risk ${riskLevel}, verdict ${verdict}.`;

  return {
    verdict,
    filtered_prompt: verdict === 'blocked' ? filteredPrompt : prompt,
    risk_level: riskLevel,
    distillation: { layer_1: layer1, layer_2: layer2, layer_3: layer3 },
    matched_pattern_ids: matched.map((m) => m.id),
  };
}
