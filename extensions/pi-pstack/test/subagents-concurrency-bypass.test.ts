import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test.for([
  { bypass: true, statuses: ['fulfilled', 'fulfilled'] },
  { bypass: false, statuses: ['fulfilled', 'rejected'] },
])('pstack.bypassSubagentConcurrencyCap=$bypass decides whether the concurrency cap refuses', async ({ bypass, statuses }) => {
  vi.stubEnv('PI_MAX_CONCURRENT_SUBAGENTS', '1');
  const fixture = await workerFixture();
  try {
    const settings = JSON.parse(await readFile(join(fixture.dir, 'settings.json'), 'utf8'));
    await writeFile(join(fixture.dir, 'settings.json'), JSON.stringify({ ...settings, pstack: { bypassSubagentConcurrencyCap: bypass } }));
    const launches = await Promise.allSettled([fixture.call('Agent', { description: 'first slot', prompt: 'hello' }), fixture.call('Agent', { description: 'second slot', prompt: 'hello' })]);
    expect(launches.map((result) => result.status)).toEqual(statuses);
  } finally {
    await fixture.close();
  }
});
