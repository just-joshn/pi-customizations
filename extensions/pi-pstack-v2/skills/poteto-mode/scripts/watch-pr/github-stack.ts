import type { OpenPullRequest, PrContext, PrNumber, NonEmpty } from "./types.ts";
import { nonEmpty } from "./types.ts";

interface Descent {
  readonly items: readonly OpenPullRequest[];
  readonly seen: ReadonlySet<PrNumber>;
}
const byNumber = (a: OpenPullRequest, b: OpenPullRequest): number =>
  a.number - b.number;

// A base ref belongs to this repository. A fork head with the same name
// cannot be its parent, even when that name is the default branch.
function ancestors(
  pr: OpenPullRequest,
  byHead: ReadonlyMap<string, OpenPullRequest>
): readonly OpenPullRequest[] {
  const walk = (
    current: OpenPullRequest,
    visited: ReadonlySet<PrNumber>
  ): readonly OpenPullRequest[] => {
    const parent = byHead.get(current.baseRefName);
    if (parent === undefined || visited.has(parent.number)) return [];
    return [parent, ...walk(parent, new Set([...visited, parent.number]))];
  };
  return walk(pr, new Set([pr.number]));
}
function descendants(
  parent: OpenPullRequest,
  children: ReadonlyMap<string, readonly OpenPullRequest[]>,
  seen: ReadonlySet<PrNumber>
): Descent {
  if (parent.isCrossRepository) return { items: [], seen };
  const initial: Descent = { items: [], seen };
  return (children.get(parent.headRefName) ?? []).reduce((acc, child) => {
    if (acc.seen.has(child.number)) return acc;
    const marked = new Set([...acc.seen, child.number]);
    const below = descendants(child, children, marked);
    return { items: [...acc.items, child, ...below.items], seen: below.seen };
  }, initial);
}
export function orderStack(
  context: PrContext,
  open: readonly OpenPullRequest[]
): NonEmpty<PrContext> {
  const start = open.find((pr) => pr.number === context.number);
  if (start === undefined) return [context];
  const byHead = new Map(
    open.filter((pr) => !pr.isCrossRepository).map((pr) => [pr.headRefName, pr])
  );
  const children = new Map(
    [...Map.groupBy(open, (pr) => pr.baseRefName)].map(([base, prs]) => [
      base,
      prs.toSorted(byNumber),
    ])
  );
  const down = ancestors(start, byHead);
  const seen = new Set([...down.map((pr) => pr.number), start.number]);
  const up = descendants(start, children, seen).items;
  return (
    nonEmpty(
      [...down.toReversed(), start, ...up].map((pr) => ({
        ...context,
        number: pr.number,
      }))
    ) ?? [context]
  );
}
