import type { WorkingTree } from '../edit/working-tree.ts';
import type { OperationIntent } from './branch.ts';

export function journaledTree(tree: WorkingTree, reply: string, append: (data: unknown) => void, written: (path: string) => void, signal?: AbortSignal): WorkingTree {
  let ordinal = 0;
  const perform = async <T>(operation: OperationIntent['operation'], path: string, run: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    if (tree.dryRun) return run();
    const action = ordinal++;
    append({ schema: 1, kind: 'operation-intent', reply, ordinal: action, operation, path });
    try {
      const result = await run();
      const succeeded = result !== false;
      append({ schema: 1, kind: 'operation-observed', reply, ordinal: action, outcome: succeeded ? 'succeeded' : 'failed', error: succeeded ? null : 'Operation returned false' });
      if (succeeded && operation !== 'touch') written(path);
      return result;
    } catch (error) {
      append({ schema: 1, kind: 'operation-observed', reply, ordinal: action, outcome: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const wrap = (target: WorkingTree): WorkingTree => ({
    dryRun: target.dryRun,
    read: (path) => target.read(path),
    exists: (path) => target.exists(path),
    write: (path, content) => perform('write', path, () => target.write(path, content)),
    touch: (path) => perform('touch', path, () => target.touch(path)),
    remove: (path) => perform('remove', path, () => target.remove(path)),
    mutate: (paths, operation, operationSignal) => target.mutate(paths, (locked) => operation(wrap(locked)), operationSignal),
  });
  return wrap(tree);
}
