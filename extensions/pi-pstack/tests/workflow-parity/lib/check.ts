// A contract checker is a list of checks. Each check reads a RunView, cites the contract source span it enforces,
// and returns PASS, FAIL, or SKIP with the evidence it looked at.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PKG } from './driver.ts';
import { parentRan } from './integrity.ts';
import type { RunView } from './view.ts';

export interface Src {
  /** Relative to generated/skills, or to generated/ for agents. */
  file: string;
  /** A substring of the line the check enforces. The line number is found at report time, so drift in the upstream text fails loudly. */
  anchor: string;
}

export type Outcome = { ok: true; evidence: string } | { ok: false; evidence: string } | { skip: string } | { inconclusive: string };

export type ContractScope = 'upstream' | 'adaptation';

export interface Check {
  scope?: ContractScope;
  id: string;
  title: string;
  src: Src[];
  run: (view: RunView) => Outcome;
  /** The check's PASS rests on an action not happening. It is INCONCLUSIVE unless the parent completed without error and made a tool call. */
  absence?: boolean;
}

export interface CheckResult {
  scope: ContractScope;
  id: string;
  title: string;
  verdict: 'PASS' | 'FAIL' | 'SKIP' | 'INCONCLUSIVE';
  source: string;
  evidence: string;
}

export const pass = (evidence: string): Outcome => ({ ok: true, evidence });
export const fail = (evidence: string): Outcome => ({ ok: false, evidence });
export const when = (condition: boolean, good: string, bad: string): Outcome => (condition ? pass(good) : fail(bad));

export function check(id: string, title: string, src: Src | Src[], run: Check['run'], scope: ContractScope = 'upstream'): Check {
  return { id, title, src: Array.isArray(src) ? src : [src], run, scope };
}

/** Marks a check whose PASS rests on the absence of an action. Applied here once, so no family re-implements the guard. */
export const absence = (entry: Check): Check => ({ ...entry, absence: true });

export const scriptedProbe = (entry: Check): Check => ({
  ...entry,
  scope: 'adaptation',
  run: (view) => view.driver === 'real' ? { inconclusive: 'this fixture probe was not requested by the real-run prompt' } : entry.run(view),
});

/** `check` for a PASS that rests on the absence of an action. */
export const checkAbsence = (...args: Parameters<typeof check>): Check => absence(check(...args));

export const src = (file: string, anchor: string): Src => ({ file, anchor });

const sourceCache = new Map<string, string[]>();

function sourceLines(file: string): string[] {
  const hit = sourceCache.get(file);
  if (hit !== undefined) return hit;
  const candidates = [join(PKG, 'generated', 'skills', file), join(PKG, 'generated', file)];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) throw new Error(`source ${file} does not resolve under generated/`);
  const lines = readFileSync(path, 'utf8').split('\n');
  sourceCache.set(file, lines);
  return lines;
}

/** `generated/skills/<file>:<line>` of the anchor. Throws when the file or anchor is gone. */
export function resolveSource(source: Src): string {
  const lines = sourceLines(source.file);
  const index = lines.findIndex((line) => line.includes(source.anchor));
  if (index === -1) throw new Error(`anchor "${source.anchor}" not found in ${source.file}`);
  const base = existsSync(join(PKG, 'generated', 'skills', source.file)) ? `generated/skills/${source.file}` : `generated/${source.file}`;
  return `${base}:${index + 1}`;
}

export function evaluate(checks: Check[], view: RunView): CheckResult[] {
  return checks.map((entry) => {
    const source = entry.src.map(resolveSource).join(', ');
    const scope = entry.scope ?? 'upstream';
    let outcome: Outcome;
    try {
      outcome = entry.run(view);
    } catch (error) {
      outcome = fail(`checker threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (entry.absence === true && 'ok' in outcome && outcome.ok) {
      const unproven = parentRan(view);
      if (unproven !== undefined) outcome = { inconclusive: `${unproven}; would have passed: ${outcome.evidence}` };
    }
    if ('inconclusive' in outcome) return { id: entry.id, title: entry.title, scope, verdict: 'INCONCLUSIVE', source, evidence: outcome.inconclusive };
    if ('skip' in outcome) return { id: entry.id, title: entry.title, scope, verdict: 'SKIP', source, evidence: outcome.skip };
    return { id: entry.id, title: entry.title, scope, verdict: outcome.ok ? 'PASS' : 'FAIL', source, evidence: outcome.evidence };
  });
}

/** The checker table. A check listed as a known product defect prints DEFECT instead of FAIL, and only real FAILs are counted as failures. */
export function table(family: string, driver: string, results: CheckResult[], known: string[] = []): string {
  const shown = results.map((result) => ({ ...result, shown: result.verdict === 'FAIL' && known.includes(result.id) ? 'DEFECT' : result.verdict }));
  const rows = shown.map((result) => `${result.shown.padEnd(6)} [${result.scope}] ${result.id}\n       ${result.title}\n       source: ${result.source}\n       evidence: ${result.evidence.replace(/\n/g, ' ').slice(0, 300)}`);
  const scopes = summarize(results, known);
  const summary = (['upstream', 'adaptation'] as const).map((scope) => `${(['PASS', 'FAIL', 'DEFECT', 'INCONCLUSIVE', 'SKIP'] as const).filter((verdict) => scopes[scope][verdict] > 0 || verdict === 'PASS').map((verdict) => `${scopes[scope][verdict]} ${verdict}`).join(', ')} ${scope}`).join('; ');
  return `== ${family} (${driver} driver): ${summary} ==\n${rows.join('\n')}`;
}

export function summarize(results: CheckResult[], known: string[] = []) {
  const summaryFor = (scope: ContractScope) => {
    const scoped = results.filter((result) => result.scope === scope);
    const count = (verdict: CheckResult['verdict']) => scoped.filter((result) => result.verdict === verdict && !(verdict === 'FAIL' && known.includes(result.id))).length;
    const counts = { PASS: count('PASS'), FAIL: count('FAIL'), DEFECT: scoped.filter((result) => result.verdict === 'FAIL' && known.includes(result.id)).length, INCONCLUSIVE: count('INCONCLUSIVE'), SKIP: count('SKIP') };
    return { ...counts, verdict: counts.FAIL > 0 ? 'FAIL' : counts.INCONCLUSIVE > 0 ? 'INCONCLUSIVE' : 'PASS' };
  };
  return { upstream: summaryFor('upstream'), adaptation: summaryFor('adaptation') };
}

export function resultExitCode(results: CheckResult[], driver: 'scripted' | 'real', known: string[] = []): number {
  const summary = summarize(results, known);
  if (summary.upstream.FAIL > 0) return 1;
  if (summary.adaptation.FAIL > 0) return driver === 'scripted' ? 1 : 4;
  return summary.upstream.INCONCLUSIVE + summary.adaptation.INCONCLUSIVE > 0 ? 3 : 0;
}

export const failed = (results: CheckResult[]): string[] => results.filter((result) => result.verdict === 'FAIL').map((result) => result.id);

/** Throws when any check cites a source span that no longer resolves in the compiled skills. */
export function validateSources(checks: Check[]): void {
  for (const entry of checks) for (const source of entry.src) resolveSource(source);
}
