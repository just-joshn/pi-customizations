import type { GraphNode } from '../domain/graph.ts';
import { matches } from '../evidence/invalidation.ts';

function staticPrefix(pattern: string): string {
  const wildcard = pattern.search(/[*?]/);
  return wildcard === -1 ? pattern : pattern.slice(0, wildcard);
}

export function patternsOverlap(a: string, b: string): boolean {
  const aGlob = staticPrefix(a) !== a;
  const bGlob = staticPrefix(b) !== b;
  if (!aGlob && !bGlob) return a === b;
  if (aGlob && !bGlob) return matches(a, b);
  if (!aGlob && bGlob) return matches(b, a);
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

function shared(a: readonly string[], b: readonly string[]): string | undefined {
  return a.find((item) => b.includes(item));
}

export function conflict(a: GraphNode, b: GraphNode): string | null {
  for (const pa of a.writeSet) {
    const pb = b.writeSet.find((candidate) => patternsOverlap(pa, candidate));
    if (pb !== undefined) return `overlapping write set ${pa} / ${pb}`;
  }
  const schema = shared(a.schemas, b.schemas);
  if (schema !== undefined) return `shared schema ${schema}`;
  const migration = shared(a.migrations, b.migrations);
  if (migration !== undefined) return `shared migration ${migration}`;
  const ab = shared(a.definesInterfaces, b.consumesInterfaces);
  if (ab !== undefined) return `interface ${ab} defined by ${a.id} consumed by ${b.id}`;
  const ba = shared(b.definesInterfaces, a.consumesInterfaces);
  if (ba !== undefined) return `interface ${ba} defined by ${b.id} consumed by ${a.id}`;
  const runtime = shared(a.runtimeOwnership, b.runtimeOwnership);
  if (runtime !== undefined) return `shared runtime ownership ${runtime}`;
  return null;
}
