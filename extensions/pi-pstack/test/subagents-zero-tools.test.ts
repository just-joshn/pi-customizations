import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

const emptyCases = [
  { label: 'explicit empty', fields: 'tools: []' },
  { label: 'explicit denied', fields: 'tools: [read]\ndisallowedTools: [read]' },
];

async function definition(dir: string, fields: string) {
  await mkdir(join(dir, '.pi/agents'), { recursive: true });
  await writeFile(join(dir, '.pi/agents/zero.md'), `---\nname: zero\ndescription: zero tools\n${fields}\n---\nComplete the task without tool calls.`);
  clearAgentCache();
}

test.for(emptyCases)('[G2-24] $label permits an intentionally tool-free child', async ({ fields }) => {
  const fixture = await workerFixture();
  try {
    await definition(fixture.dir, fields);
    expect((await fixture.call('Agent', { description: 'intentional zero tools', prompt: 'ordinary task', subagent_type: 'zero', run_in_background: false })).details).toMatchObject({ status: 'completed', totalToolUseCount: 0 });
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'))).toStrictEqual([]);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-24] continuation with unavailable declared tools reports but does not refuse', async () => {
  const fixture = await workerFixture();
  const events: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-zero-tools', (event) => events.push(event));
  try {
    await definition(fixture.dir, 'tools: [read]');
    const started = await fixture.call('Agent', { description: 'continuation tools', prompt: 'ordinary task', subagent_type: 'zero', run_in_background: false });
    const { agentId } = started.details as { agentId: string };
    await definition(fixture.dir, 'tools: [UnavailableTool]');
    await fixture.call('SendMessage', { to: agentId, message: 'continue without tools' });
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled' });
    expect(events).toMatchObject([{ invalidCount: 1, isContinuation: true, refused: false }]);
    expect(events).toHaveLength(1);
  } finally {
    off();
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-24] unrecognized tool refusal emits native resolution diagnostics', async () => {
  const fixture = await workerFixture();
  const events: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-zero-tools', (event) => events.push(event));
  try {
    await definition(fixture.dir, 'tools: [UnavailableTool]');
    await expect(fixture.call('Agent', { description: 'zero tools diagnostic', prompt: 'never runs', subagent_type: 'zero', run_in_background: false })).rejects.toThrow(
      "Its tools list resolved to nothing: unrecognized [UnavailableTool]. Fix the agent's tools frontmatter or pass a different subagent_type.",
    );
    expect(events).toMatchObject([{ isBuiltIn: false, invalidCount: 1, unavailableCount: 0, validButEmptyCount: 0, hadWildcard: false, isContinuation: false, refused: true, isAsync: false }]);
    expect(events).toHaveLength(1);
    expect((events[0] as { availablePoolSize: number }).availablePoolSize).toBeGreaterThan(0);
    await expect(readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    off();
    clearAgentCache();
    await fixture.close();
  }
});
