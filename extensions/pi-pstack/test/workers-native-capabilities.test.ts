import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const probeServer = fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url));

test.for([
  { enabled: true, readonly: false },
  { enabled: false, readonly: false },
  { enabled: true, readonly: true },
])('uppercase workers honor native capabilities with enabled=$enabled and readonly=$readonly', async ({ enabled, readonly }) => {
  const fixture = await workerFixture({ settings: { defaultTools: ['+codemode', '+tool_search'] } });
  try {
    await writeFile(join(fixture.dir, 'mcp.json'), JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [probeServer], exposure: 'direct' } } }));
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: { probe: { enabled } } }));
    await fixture.call('Task', { prompt: 'hello', model: 'worker-test/deterministic', run_in_background: false, readonly });
    const tools: unknown = JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'));

    expect(tools).toBeInstanceOf(Array);
    if (readonly) {
      expect(tools).toEqual(expect.arrayContaining(['read', 'grep', 'find', 'ls']));
      expect(tools).toHaveLength(4);
    } else {
      expect(tools).toEqual(expect.arrayContaining(['codemode', 'tool_search']));
      expect(Array.isArray(tools) && tools.includes('mcp__probe__echo')).toBe(enabled);
    }
  } finally {
    await fixture.close();
  }
});
