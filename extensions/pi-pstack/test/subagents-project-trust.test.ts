import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test.for([
  { trusted: true, ran: true },
  { trusted: false, ran: false },
])('a project subagentStart hook runs: $ran when the project trusted is $trusted', async ({ trusted, ran }) => {
  const dir = { current: '' };
  const fixture = await workerFixture({
    projectTrusted: trusted,
    settings: {},
    projectSettings: { hooks: { subagentStart: ['touch "$PWD/project-hook-ran"'] } },
  });
  dir.current = fixture.dir;
  try {
    await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello', mode: 'sync' });
    expect(existsSync(join(dir.current, 'project-hook-ran'))).toBe(ran);
  } finally {
    await fixture.close();
  }
});
