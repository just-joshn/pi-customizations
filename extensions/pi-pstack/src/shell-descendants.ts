import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { signalProcess } from './process-signal.ts';

const run = promisify(execFile);

function childrenByParent(table: string): ReadonlyMap<number, readonly number[]> {
  const rows = table
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row): row is [number, number] => row.length === 2 && row.every(Number.isSafeInteger));
  const tree = new Map<number, number[]>();
  for (const [pid, ppid] of rows) tree.set(ppid, [...(tree.get(ppid) ?? []), pid]);
  return tree;
}

/** Every live descendant of root, including ones that left its process group with setsid. */
export async function descendants(root: number): Promise<readonly number[]> {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=']).catch(() => ({ stdout: '' }));
  const tree = childrenByParent(stdout);
  const found: number[] = [];
  const queue = [...(tree.get(root) ?? [])];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    found.push(pid);
    queue.push(...(tree.get(pid) ?? []));
  }
  return found;
}

export function killSurvivors(pids: readonly number[]): void {
  for (const pid of pids) signalProcess(pid, 'SIGKILL');
}
