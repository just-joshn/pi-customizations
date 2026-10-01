import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-30] native invocation is durable and declared-memory telemetry is explicit when disabled', async () => {
  vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'true');
  const fixture = await workerFixture();
  let loaded: readonly unknown[] = [];
  let invoked: readonly unknown[] = [];
  const offLoaded = fixture.eventBus.on('pstack:agent-memory-loaded', (event) => {
    loaded = [...loaded, event];
  });
  const offInvoked = fixture.eventBus.on('pstack:agent-type-invoked', (event) => {
    invoked = [...invoked, event];
  });
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/lifecycle.md'), '---\nname: lifecycle\ndescription: memory lifecycle\nmemory: project\ntools: [read]\n---\nComplete the task.');
    clearAgentCache();
    for (const prompt of ['first invocation', 'second invocation']) {
      if (prompt === 'second invocation') {
        await fixture.session.reload();
        await fixture.session.bindExtensions({ mode: 'print' });
      }
      expect((await fixture.call('Agent', { description: 'lifecycle check', prompt, subagent_type: 'lifecycle', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    }
    expect(invoked).toMatchObject([
      { agentType: 'lifecycle', firstInvocation: true },
      { agentType: 'lifecycle', firstInvocation: false },
    ]);
    expect(loaded).toMatchObject([
      { agentType: 'lifecycle', scope: 'project', source: 'subagent', enabled: false },
      { agentType: 'lifecycle', scope: 'project', source: 'subagent', enabled: false },
    ]);
    const marks = fixture.session.sessionManager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-type-invoked');
    expect(marks).toMatchObject([{ data: 'lifecycle' }]);
  } finally {
    offLoaded();
    offInvoked();
    clearAgentCache();
    await fixture.close();
  }
});
