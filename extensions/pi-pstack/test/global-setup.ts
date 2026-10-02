import { closeRunDir, openRunDir, type RunDir } from './support/run-dir.ts';

let run: RunDir | undefined;

export function setup(): void {
  run = openRunDir();
}

export async function teardown(): Promise<void> {
  if (!run) return;
  const failure = await closeRunDir(run);
  if (failure) throw new Error(failure);
}
