import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const probeServer = fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url));

test.for([true, false])('a child honors the native project enabled override %s for a user MCP server', async (enabled) => {
  const fixture = await workerFixture();
  try {
    await writeFile(join(fixture.dir, 'mcp.json'), JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [probeServer], exposure: 'direct' } } }));
    await mkdir(join(fixture.dir, '.pi'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: { probe: { enabled } } }));
    await fixture.call('task', { agent_type: 'general-purpose', name: 'override', description: 'probe', prompt: 'hello', mode: 'sync' });
    const childTools: unknown = JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'));

    expect(childTools).toBeInstanceOf(Array);
    expect(Array.isArray(childTools) && childTools.includes('mcp__probe__echo')).toBe(enabled);
  } finally {
    await fixture.close();
  }
});

test('a child connects the MCP server its parent registered', async () => {
  const fixture = await workerFixture({ extensions: [(pi) => pi.registerMcpServer('probe', { command: process.execPath, args: [probeServer], exposure: 'direct' })] });
  try {
    await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello', mode: 'sync' });
    const childTools = JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8')) as string[];
    expect(childTools).toContain('mcp__probe__echo');
  } finally {
    await fixture.close();
  }
});
