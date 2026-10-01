import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const webFetchExtension = `import { Type } from 'typebox';
export default function (pi) {
  pi.registerTool({ name: 'WebFetch', label: 'WebFetch', description: 'fetch', parameters: Type.Object({ url: Type.String() }), execute: async () => ({ content: [{ type: 'text', text: 'page' }], details: {} }) });
}
`;

test('the built-in web-fetch agent ignores isolation and always runs locally', async () => {
  vi.stubEnv('CLAUDE_CODE_WEB_FETCH_AGENT', '1');
  const fixture = await workerFixture();
  try {
    execFileSync('git', ['init', '-q'], { cwd: fixture.dir });
    await writeFile(join(fixture.dir, 'extensions/webfetch.ts'), webFetchExtension);
    const done = (await fixture.call('Agent', { description: 'fetch page', prompt: 'hello', subagent_type: 'web-fetch', isolation: 'worktree', run_in_background: false })) as { details: Record<string, unknown> };
    expect(done.details).toMatchObject({ status: 'completed', agentType: 'web-fetch', requestedIsolation: 'worktree', effectiveIsolation: 'local' });
    expect(fixture.subagentLogs).toContain("[web-fetch agent] isolation:'worktree' ignored; the built-in web-fetch agent always runs as a local agent");
    await expect(fixture.call('Agent', { description: 'remote fetch', prompt: 'hello', subagent_type: 'web-fetch', isolation: 'remote', run_in_background: false })).rejects.toThrow(
      'Remote agent execution is not available in this runtime',
    );
  } finally {
    await fixture.close();
  }
});
