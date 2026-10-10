import type { RankedEntry } from './rank.ts';

/** Aider `RepoMap.token_count` sampled estimate (`aider/repomap.py:89-101`). */
export function estimateMapTokens(text: string, tokenCount: (sample: string) => number): number {
  if (text.length < 200) return tokenCount(text);
  const lines = text.split(/(?<=\n)/);
  const step = Math.trunc(lines.length / 100) || 1;
  const sampleText = lines.filter((_, index) => index % step === 0).join('');
  if (!sampleText.length) return tokenCount(text);
  return (tokenCount(sampleText) / sampleText.length) * text.length;
}

/**
 * Binary search a ranked prefix within 15% of budget, keeping allowed over-budget results
 * (`aider/repomap.py:663-705`).
 */
export function selectRankedPrefix(input: {
  readonly ranked: readonly RankedEntry[];
  readonly maxMapTokens: number;
  readonly chatRelFnames: ReadonlySet<string>;
  readonly tokenCount: (text: string) => number;
  readonly render: (entries: readonly RankedEntry[], chatRelFnames: ReadonlySet<string>) => string;
}): string {
  const { ranked, maxMapTokens, chatRelFnames, tokenCount, render } = input;
  if (ranked.length === 0 || maxMapTokens <= 0) return '';

  let lower = 0;
  let upper = ranked.length;
  let bestTree = '';
  let bestTokens = 0;
  let middle = Math.min(Math.trunc(maxMapTokens / 25), ranked.length);

  while (lower <= upper) {
    const tree = render(ranked.slice(0, middle), chatRelFnames);
    const numTokens = estimateMapTokens(tree, tokenCount);
    const pctErr = Math.abs(numTokens - maxMapTokens) / maxMapTokens;
    if ((numTokens <= maxMapTokens && numTokens > bestTokens) || pctErr < 0.15) {
      bestTree = tree;
      bestTokens = numTokens;
      if (pctErr < 0.15) break;
    }
    if (numTokens < maxMapTokens) lower = middle + 1;
    else upper = middle - 1;
    middle = Math.trunc((lower + upper) / 2);
  }
  return bestTree;
}
