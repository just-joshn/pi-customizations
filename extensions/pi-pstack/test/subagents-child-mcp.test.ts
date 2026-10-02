import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const probeServer = fileURLToPath(new URL('./fixtures/mcp-probe-server.mjs', import.meta.url));

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
