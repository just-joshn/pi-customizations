import { basename, extname, normalize } from 'node:path';

import { pythonSorted } from '../support/python-sort.ts';
import { PageRankError, pageRank, type RankEdge } from './pagerank.ts';
import { filterImportantFiles } from './special.ts';
import type { Tag } from './tag.ts';

/** Ranked map entry: full Tag or filename-only (`aider/repomap.py:569-572`). */
export type RankedEntry = Tag | { readonly relFname: string };

export function isTagEntry(entry: RankedEntry): entry is Tag {
  return 'kind' in entry;
}

/** Skeleton ranking without PageRank: other files as filename-only entries, sorted. */
export function filenameOnlyEntries(relOtherFnames: readonly string[]): RankedEntry[] {
  return pythonSorted(new Set(relOtherFnames)).map((relFname) => ({ relFname }));
}

interface IdentEdge extends RankEdge {
  readonly ident: string;
}

/** Aider identifier edge multiplier before chat and sqrt scaling (`aider/repomap.py:487-499`). */
export function identifierMultiplier(ident: string, mentionedIdents: ReadonlySet<string>, definerCount: number): number {
  let mul = 1;
  const isSnake = ident.includes('_') && [...ident].some((char) => /[a-zA-Z]/.test(char));
  const isKebab = ident.includes('-') && [...ident].some((char) => /[a-zA-Z]/.test(char));
  const isCamel = [...ident].some((char) => char >= 'A' && char <= 'Z') && [...ident].some((char) => char >= 'a' && char <= 'z');
  if (mentionedIdents.has(ident)) mul *= 10;
  if ((isSnake || isKebab || isCamel) && ident.length >= 8) mul *= 10;
  if (ident.startsWith('_')) mul *= 0.1;
  if (definerCount > 5) mul *= 0.1;
  return mul;
}

export interface RankTagsInput {
  readonly chatFnames: readonly string[];
  readonly otherFnames: readonly string[];
  readonly mentionedFnames: ReadonlySet<string>;
  readonly mentionedIdents: ReadonlySet<string>;
  readonly tagsByAbsPath: ReadonlyMap<string, readonly Tag[]>;
  readonly getRelFname: (absPath: string) => string;
  readonly fileExists?: (absPath: string) => boolean;
}

function pathPersonalizationBoost(relFname: string, mentionedIdents: ReadonlySet<string>): boolean {
  const normalized = normalize(relFname);
  const parts = new Set(normalized.split(/[/\\]/).filter((part) => part.length > 0 && part !== '.'));
  const base = basename(normalized);
  parts.add(base);
  parts.add(base.slice(0, base.length - extname(base).length));
  for (const part of parts) {
    if (mentionedIdents.has(part)) return true;
  }
  return false;
}

function definitionKey(fname: string, ident: string): string {
  return `${fname}\0${ident}`;
}

function parseDefinitionKey(key: string): [string, string] {
  const split = key.indexOf('\0');
  return [key.slice(0, split), key.slice(split + 1)];
}

function compareDefinitionKey(left: readonly [string, string], right: readonly [string, string]): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] === right[1]) return 0;
  return left[1] < right[1] ? -1 : 1;
}

interface ScanResult {
  readonly defines: Map<string, Set<string>>;
  readonly references: Map<string, string[]>;
  readonly definitions: Map<string, Tag[]>;
  readonly personalization: Record<string, number>;
  readonly chatRelFnames: Set<string>;
}

function scanFiles(input: RankTagsInput): ScanResult | null {
  const defines = new Map<string, Set<string>>();
  const references = new Map<string, string[]>();
  const definitions = new Map<string, Tag[]>();
  const personalization: Record<string, number> = {};
  const chatRelFnames = new Set<string>();
  const exists = input.fileExists ?? (() => true);
  const chatAbs = new Set(input.chatFnames);
  const absFiles = pythonSorted(new Set([...input.chatFnames, ...input.otherFnames]));
  if (absFiles.length === 0) return null;
  const personalize = 100 / absFiles.length;

  for (const absPath of absFiles) {
    if (!exists(absPath)) continue;
    const relFname = input.getRelFname(absPath);
    let currentPers = 0;
    if (chatAbs.has(absPath)) {
      currentPers += personalize;
      chatRelFnames.add(relFname);
    }
    if (input.mentionedFnames.has(relFname)) currentPers = Math.max(currentPers, personalize);
    if (pathPersonalizationBoost(relFname, input.mentionedIdents)) currentPers += personalize;
    if (currentPers > 0) personalization[relFname] = currentPers;
    for (const next of input.tagsByAbsPath.get(absPath) ?? []) {
      if (next.kind === 'def') {
        defines.set(next.name, new Set([...(defines.get(next.name) ?? []), relFname]));
        const key = definitionKey(relFname, next.name);
        definitions.set(key, [...(definitions.get(key) ?? []), next]);
      } else {
        references.set(next.name, [...(references.get(next.name) ?? []), relFname]);
      }
    }
  }
  return { defines, references, definitions, personalization, chatRelFnames };
}

function buildEdges(defines: Map<string, Set<string>>, references: Map<string, string[]>, mentionedIdents: ReadonlySet<string>, chatRelFnames: ReadonlySet<string>): IdentEdge[] {
  const effectiveRefs = references.size === 0 ? new Map([...defines].map(([name, files]) => [name, [...files]])) : references;
  const edges: IdentEdge[] = [];
  for (const [ident, definers] of defines) {
    if (effectiveRefs.has(ident)) continue;
    for (const definer of definers) edges.push({ src: definer, dst: definer, weight: 0.1, ident });
  }
  for (const ident of [...defines.keys()].filter((name) => effectiveRefs.has(name))) {
    const definers = defines.get(ident) ?? new Set<string>();
    const mul = identifierMultiplier(ident, mentionedIdents, definers.size);
    const counts = new Map<string, number>();
    for (const referencer of effectiveRefs.get(ident) ?? []) counts.set(referencer, (counts.get(referencer) ?? 0) + 1);
    for (const [referencer, numRefs] of counts) {
      for (const definer of definers) {
        edges.push({
          src: referencer,
          dst: definer,
          weight: (chatRelFnames.has(referencer) ? mul * 50 : mul) * Math.sqrt(numRefs),
          ident,
        });
      }
    }
  }
  return edges;
}

function runPageRank(edges: readonly IdentEdge[], personalization: Readonly<Record<string, number>>): Readonly<Record<string, number>> | null {
  try {
    return Object.keys(personalization).length > 0 ? pageRank(edges, { personalization, dangling: personalization }) : pageRank(edges);
  } catch (error) {
    if (!(error instanceof PageRankError)) throw error;
    try {
      return pageRank(edges);
    } catch {
      return null;
    }
  }
}

function scoreDefinitions(edges: readonly IdentEdge[], ranked: Readonly<Record<string, number>>): Array<readonly [string, number]> {
  const rankedDefinitions = new Map<string, number>();
  const outBySrc = new Map<string, IdentEdge[]>();
  for (const edge of edges) outBySrc.set(edge.src, [...(outBySrc.get(edge.src) ?? []), edge]);
  for (const [src, outs] of outBySrc) {
    const srcRank = ranked[src] ?? 0;
    const totalWeight = outs.reduce((acc, edge) => acc + edge.weight, 0);
    if (totalWeight === 0) continue;
    for (const edge of outs) {
      const key = definitionKey(edge.dst, edge.ident);
      rankedDefinitions.set(key, (rankedDefinitions.get(key) ?? 0) + (srcRank * edge.weight) / totalWeight);
    }
  }
  return [...rankedDefinitions.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return compareDefinitionKey(parseDefinitionKey(right[0]), parseDefinitionKey(left[0]));
  });
}

function assembleRankedEntries(
  sortedDefinitions: ReadonlyArray<readonly [string, number]>,
  definitions: ReadonlyMap<string, readonly Tag[]>,
  chatRelFnames: ReadonlySet<string>,
  ranked: Readonly<Record<string, number>>,
  otherRelFnames: readonly string[],
): RankedEntry[] {
  const rankedTags: RankedEntry[] = [];
  const included = new Set<string>();
  for (const [key] of sortedDefinitions) {
    const [fname] = parseDefinitionKey(key);
    if (chatRelFnames.has(fname)) continue;
    for (const next of definitions.get(key) ?? []) {
      rankedTags.push(next);
      included.add(next.relFname);
    }
  }
  let remaining = new Set(otherRelFnames);
  const topRank = Object.entries(ranked).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0] < right[0] ? 1 : left[0] > right[0] ? -1 : 0;
  });
  for (const [fname] of topRank) {
    if (remaining.has(fname)) remaining = new Set([...remaining].filter((name) => name !== fname));
    if (!included.has(fname)) {
      rankedTags.push({ relFname: fname });
      included.add(fname);
    }
  }
  for (const fname of remaining) rankedTags.push({ relFname: fname });
  return rankedTags;
}

/**
 * Aider `RepoMap.get_ranked_tags` without progress IO (`aider/repomap.py:365-574`).
 * Distributes weighted PageRank over same-name def/ref edges and omits chat definitions.
 */
export function getRankedTags(input: RankTagsInput): RankedEntry[] {
  const scan = scanFiles(input);
  if (!scan) return [];
  const edges = buildEdges(scan.defines, scan.references, input.mentionedIdents, scan.chatRelFnames);
  const ranked = runPageRank(edges, scan.personalization);
  if (!ranked) return [];
  const otherRel = input.otherFnames.map((abs) => input.getRelFname(abs));
  return assembleRankedEntries(scoreDefinitions(edges, ranked), scan.definitions, scan.chatRelFnames, ranked, otherRel);
}

/**
 * Aider important-file prepend before budget search (`aider/repomap.py:656-662`).
 * Prepends important other files absent from the ranked list (e.g. after PageRank failure).
 */
export function prependImportantFiles(ranked: readonly RankedEntry[], otherRelFnames: readonly string[]): RankedEntry[] {
  const rankedFnames = new Set(ranked.map((entry) => entry.relFname));
  const special = filterImportantFiles(pythonSorted(new Set(otherRelFnames))).filter((fname) => !rankedFnames.has(fname));
  return [...special.map((relFname) => ({ relFname })), ...ranked];
}
