import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-24] absent MCP server emits matched-none rather than invalid-name diagnostics', async () => {
  const fixture = await workerFixture();
  const events: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-zero-tools', (event) => events.push(event));
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/missing-server.md'), '---\nname: missing-server\ndescription: absent server\ntools: ["mcp__absent__*"]\n---\nComplete the task.');
    clearAgentCache();
    await expect(fixture.call('Agent', { description: 'missing MCP server', prompt: 'never runs', subagent_type: 'missing-server', run_in_background: false })).rejects.toThrow(
      'recognized but matched no tools in this session [mcp__absent__*]',
    );
    expect(events).toMatchObject([{ invalidCount: 0, validButEmptyCount: 1, refused: true }]);
    expect(events).toHaveLength(1);
    await expect(readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    off();
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-23] native child declares only the permitted MCP-named extension tools', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/extensions'), { recursive: true });
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(
      join(fixture.dir, '.pi/extensions/mcp-fixture.ts'),
      `export default function(pi) {
      for (const name of ['mcp__foo__a', 'mcp__foo__b', 'mcp__bar__c']) pi.registerTool({
        name, label: name, description: 'MCP-name matching fixture', parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} })
      });
    }`,
    );
    await writeFile(join(fixture.dir, '.pi/agents/mcp-probe.md'), '---\nname: mcp-probe\ndescription: MCP pool probe\ntools: ["mcp__*"]\ndisallowedTools: ["mcp__foo__*"]\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'MCP pool', prompt: 'ordinary task', subagent_type: 'mcp-probe', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'))).toEqual(['mcp__bar__c']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
