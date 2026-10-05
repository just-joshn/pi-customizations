import { afterAll, beforeAll } from 'vitest';
import { closeRunDir, openRunDir } from '../support/run-dir.ts';

let run: ReturnType<typeof openRunDir> | undefined;

beforeAll(() => {
  run = openRunDir();
});

afterAll(async () => {
  if (!run) return;
  const failure = await closeRunDir(run);
  if (failure) throw new Error(failure);
});
