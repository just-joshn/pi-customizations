import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-08] native model receives Agent decision and prompt guidance', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.session.prompt('inspect tool guidance');
    const descriptions = JSON.parse(await readFile(join(fixture.dir, 'tool-descriptions.json'), 'utf8')) as Record<string, string>;
    const description = descriptions.Agent;
    expect(description?.startsWith('Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.')).toBe(true);
    for (const phrase of [
      '## When not to use',
      '## When to use',
      '## Writing the prompt',
      'specify a subagent_type parameter',
      'Always include a short description',
      'Trust but verify',
      'a new Agent call starts fresh',
      'Never delegate understanding',
      'If the target is already known, use the direct tool',
    ])
      expect(description).toContain(phrase);
    expect(description).not.toContain('## When to fork');
    expect(description).not.toContain('Only synchronous subagents are supported.');
  } finally {
    await fixture.close();
  }
});
