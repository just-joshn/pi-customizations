// A contract checker is a list of checks. Each check reads a RunView, cites the upstream source span it enforces,
// and returns PASS, FAIL, or SKIP with the evidence it looked at.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PKG } from './driver.ts';
import type { RunView } from './view.ts';

export interface Src {
  /** Relative to generated/skills, or to generated/ for agents. */
  file: string;
  /** A substring of the line the check enforces. The line number is found at report time, so drift in the upstream text fails loudly. */
  anchor: string;
}

export type Outcome = { ok: true; evidence: string } | { ok: false; evidence: string } | { skip: string };

export interface Check {
  id: string;
  title: string;
  src: Src[];
  run: (view: RunView) => Outcome;
}

export interface CheckResult {
  id: string;
  title: string;
  verdict: 'PASS' | 'FAIL' | 'SKIP';
  source: string;
  evidence: string;
}

export const pass = (evidence: string): Outcome => ({ ok: true, evidence });
export const fail = (evidence: string): Outcome => ({ ok: false, evidence });
export const when = (condition: boolean, good: string, bad: string): Outcome => (condition ? pass(good) : fail(bad));

export function check(id: string, title: string, src: Src | Src[], run: Check['run']): Check {
  return { id, title, src: Array.isArray(src) ? src : [src], run };
}

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
    let outcome: Outcome;
    try {
      outcome = entry.run(view);
    } catch (error) {
      outcome = fail(`checker threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if ('skip' in outcome) return { id: entry.id, title: entry.title, verdict: 'SKIP', source, evidence: outcome.skip };
    return { id: entry.id, title: entry.title, verdict: outcome.ok ? 'PASS' : 'FAIL', source, evidence: outcome.evidence };
  });
}

export function table(family: string, driver: string, results: CheckResult[]): string {
  const rows = results.map((result) => `${result.verdict.padEnd(4)} ${result.id}\n       ${result.title}\n       source: ${result.source}\n       evidence: ${result.evidence.replace(/\n/g, ' ').slice(0, 300)}`);
  const count = (verdict: string) => results.filter((result) => result.verdict === verdict).length;
  return `== ${family} (${driver} driver): ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('SKIP')} SKIP ==\n${rows.join('\n')}`;
}

export const failed = (results: CheckResult[]): string[] => results.filter((result) => result.verdict === 'FAIL').map((result) => result.id);

/** Throws when any check cites a source span that no longer resolves in the compiled skills. */
export function validateSources(checks: Check[]): void {
  for (const entry of checks) for (const source of entry.src) resolveSource(source);
}
