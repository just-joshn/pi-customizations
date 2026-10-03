/**
 * Extracts `filename:linenum` pairs from tool output and converts them into a
 * LintResult with 0-indexed lines. The full output is always kept, even when
 * no line numbers are found.
 */

import type { LintResult } from './types.ts';

export function findFilenamesAndLinenums(text: string, fnames: readonly string[]): ReadonlyMap<string, ReadonlySet<number>> {
  const pattern = new RegExp(`(\\b(?:${fnames.map((fname) => escapeRegExp(fname)).join('|')}):\\d+\\b)`, 'g');
  const result = new Map<string, Set<number>>();
  for (const match of text.matchAll(pattern)) {
    const matched = match[1];
    if (matched === undefined) continue;
    const splitAt = matched.lastIndexOf(':');
    const fname = matched.slice(0, splitAt);
    const linenum = Number(matched.slice(splitAt + 1));
    const existing = result.get(fname) ?? new Set<number>();
    existing.add(linenum);
    result.set(fname, existing);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function errorsToLintResult(relFname: string, errors: string): LintResult | undefined {
  if (errors.length === 0) return undefined;
  const filenamesLinenums = findFilenamesAndLinenums(errors, [relFname]);
  let linenums: readonly number[] = [];
  const first = filenamesLinenums.entries().next();
  if (!first.done) {
    linenums = [...first.value[1]].map((num) => num - 1);
  }
  return { text: errors, lines: linenums };
}
