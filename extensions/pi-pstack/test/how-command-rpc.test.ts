import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { fixture, packageRoot } from './session-fixture.ts';

test.each([
  { input: '/how inspect the fixture without executing agents', resource: '--prompt-template', path: 'prompts/how.md', expected: ['Read how/SKILL.md in full', 'resolving references and supporting scripts'] },
  {
    input: '/skill:how inspect the fixture without executing agents',
    resource: '--skill',
    path: 'skills/how/SKILL.md',
    expected: ['<skill name=', 'references/explorer-prompt.md', 'references/explainer-prompt.md', 'When in doubt, take the simple path.', 'Do not substantially rewrite it.'],
  },
])(
  'real RPC $resource delivers How without executing agents',
  async ({ input, resource, path, expected }) => {
    const f = await fixture({ extensionOnly: true });
    try {
      const provider = join(f.root, 'record-provider.mjs');
      await writeFile(provider, `import journey from ${JSON.stringify(join(packageRoot, 'test/journey-provider.ts'))};\nprocess.env = { ...process.env, PSTACK_JOURNEY_LOG: ${JSON.stringify(f.root)} };\nexport default journey;\n`);
      const handle = await startDetachedRpc({
        directory: join(f.root, 'transport'),
        cwd: f.cwd,
        agentDir: join(f.root, 'real-agent'),
        args: ['--approve', '--no-extensions', '--no-skills', '--no-prompt-templates', resource, join(packageRoot, path), '-e', join(packageRoot, 'src/index.ts'), '-e', provider, '--provider', 'journey-test', '--model', 'recorder'],
      });
      try {
        expect((await handle.send({ type: 'prompt', message: input })).success).toBe(true);
        await vi.waitFor(async () => {
          const log = (await readdir(f.root)).find((name) => /^requests-\d+\.jsonl$/.test(name));
          if (!log) throw new Error('no provider request captured');
          const request = JSON.parse((await readFile(join(f.root, log), 'utf8')).trim().split('\n')[0]);
          const users = request.messages.filter((message: { role: string }) => message.role === 'user');
          const text = JSON.stringify(users);
          expect(text).toContain('inspect the fixture without executing agents');
          for (const value of expected) expect(text).toContain(value);
        });
      } finally {
        await handle.close();
      }
    } finally {
      await f.close();
    }
  },
  30000,
);
