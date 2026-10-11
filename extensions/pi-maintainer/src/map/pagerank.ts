/** Weighted directed edge for Aider's MultiDiGraph PageRank (`aider/repomap.py:470-531`). */
export interface RankEdge {
  readonly src: string;
  readonly dst: string;
  readonly weight: number;
}

export class PageRankError extends Error {
  constructor(message = 'PageRank failed') {
    super(message);
    this.name = 'PageRankError';
  }
}

/**
 * NetworkX-compatible weighted PageRank (`networkx.algorithms.link_analysis.pagerank_alg._pagerank_python`).
 * Personalization and dangling maps may omit nodes (treated as zero); both are L1-normalized.
 */
export function pageRank(
  edges: readonly RankEdge[],
  options: {
    readonly personalization?: Readonly<Record<string, number>>;
    readonly dangling?: Readonly<Record<string, number>>;
    readonly alpha?: number;
    readonly maxIter?: number;
    readonly tol?: number;
  } = {},
): Readonly<Record<string, number>> {
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.src);
    nodes.add(edge.dst);
  }
  if (nodes.size === 0) return {};

  const alpha = options.alpha ?? 0.85;
  const maxIter = options.maxIter ?? 100;
  const tol = options.tol ?? 1e-6;
  const nodeList = [...nodes];
  const n = nodeList.length;

  const outWeight = new Map<string, number>();
  for (const node of nodeList) outWeight.set(node, 0);
  for (const edge of edges) outWeight.set(edge.src, (outWeight.get(edge.src) ?? 0) + edge.weight);

  const stochastic = edges.map((edge) => {
    const total = outWeight.get(edge.src) ?? 0;
    return { src: edge.src, dst: edge.dst, weight: total === 0 ? 0 : edge.weight / total };
  });

  const normalize = (vector: Readonly<Record<string, number>> | undefined): Map<string, number> => {
    if (!vector) {
      const value = 1 / n;
      return new Map(nodeList.map((node) => [node, value]));
    }
    const sum = Object.values(vector).reduce((acc, value) => acc + value, 0);
    if (sum === 0) throw new PageRankError('personalization sum is zero');
    return new Map(nodeList.map((node) => [node, (vector[node] ?? 0) / sum]));
  };

  const personalization = normalize(options.personalization);
  const danglingWeights = options.dangling ? normalize(options.dangling) : personalization;
  const danglingNodes = nodeList.filter((node) => (outWeight.get(node) ?? 0) === 0);

  let ranks = new Map(nodeList.map((node) => [node, 1 / n]));
  for (let iter = 0; iter < maxIter; iter += 1) {
    const previous = ranks;
    ranks = new Map(nodeList.map((node) => [node, 0]));
    const dangleSum = alpha * danglingNodes.reduce((acc, node) => acc + (previous.get(node) ?? 0), 0);
    for (const edge of stochastic) {
      ranks.set(edge.dst, (ranks.get(edge.dst) ?? 0) + alpha * (previous.get(edge.src) ?? 0) * edge.weight);
    }
    for (const node of nodeList) {
      ranks.set(node, (ranks.get(node) ?? 0) + dangleSum * (danglingWeights.get(node) ?? 0) + (1 - alpha) * (personalization.get(node) ?? 0));
    }
    const err = nodeList.reduce((acc, node) => acc + Math.abs((ranks.get(node) ?? 0) - (previous.get(node) ?? 0)), 0);
    if (err < n * tol) {
      return Object.fromEntries(ranks);
    }
  }
  throw new PageRankError(`power iteration failed to converge within ${maxIter} iterations`);
}
