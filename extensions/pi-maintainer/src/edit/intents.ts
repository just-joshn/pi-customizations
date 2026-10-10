import type { EditContext, EditIntent } from '../feature.ts';

export function intentPaths(intent: EditIntent | null): readonly string[] {
  if (intent === null) return [];
  switch (intent.kind) {
    case 'move':
      return [intent.source, intent.destination];
    case 'upsert':
    case 'add':
    case 'update':
    case 'delete':
      return [intent.path];
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}

export function mutationContext(context: EditContext, allowed: ReadonlySet<string>): EditContext {
  const check = (path: string) => {
    context.signal?.throwIfAborted();
    if (!allowed.has(context.absRootPath(path))) throw new Error(`File mutation not authorized: ${path}`);
  };
  return {
    ...context,
    tree: {
      ...context.tree,
      write: async (path, content) => {
        check(path);
        await context.tree.write(path, content);
      },
      touch: async (path) => {
        check(path);
        return context.tree.touch(path);
      },
      remove: async (path) => {
        check(path);
        return context.tree.remove(path);
      },
      mutate: async () => {
        throw new Error('Format must use its supplied edit transaction');
      },
    },
  };
}
