import { afterAll } from 'bun:test';

import { closeRunDir, openRunDir } from '../support/run-dir.ts';

const run = openRunDir();

afterAll(async () => {
  const failure = await closeRunDir(run);
  if (failure) throw new Error(failure);
});
