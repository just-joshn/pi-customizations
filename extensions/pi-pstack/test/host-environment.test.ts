import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { fixture, packageRoot, prompt, section } from './session-fixture.ts';

test.each([
  { owner: '', expected: 'create-skill, goal, loop, origin' },
  { owner: 'cloud-host-fixture', expected: 'create-skill, goal, loop' },
])('host catalog respects detached owner marker $owner', async ({ owner, expected }) => {
  vi.stubEnv('PI_PSTACK_WORKER_OWNER', owner);
  const f = await fixture({ extensionOnly: true });
  try {
    const { session } = await f.open();
    await prompt(session, 'Record the host contract');
    const host = section(f.requests, 'pstack_host');
    const advertised = host?.match(/^Host skills live at .+SKILL.md: (.+)\.$/m)?.[1];
    expect(advertised).toBe(expected);
  } finally {
    await f.close();
  }
});

test('real RPC delivers the cloud host catalog to a deterministic main-session provider', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const provider = join(f.root, 'record-provider.mjs');
    await writeFile(provider, `import journey from ${JSON.stringify(join(packageRoot, 'test/journey-provider.ts'))};\nprocess.env = { ...process.env, PSTACK_JOURNEY_LOG: ${JSON.stringify(f.root)} };\nexport default journey;\n`);
    const handle = await startDetachedRpc({
      directory: join(f.root, 'transport'),
      cwd: f.cwd,
      agentDir: join(f.root, 'real-agent'),
      ownerId: 'cloud-host-main-fixture',
      args: ['--approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(packageRoot, 'src/index.ts'), '-e', provider, '--provider', 'journey-test', '--model', 'recorder'],
    });
    try {
      const response = await handle.send({ type: 'prompt', message: 'Record the host contract without calling tools' });
      expect(response.success).toBe(true);
      await vi.waitFor(async () => {
        const path = (await readdir(f.root)).find((name) => /^requests-\d+\.jsonl$/.test(name));
        expect(path).toBeDefined();
        const request = JSON.parse((await readFile(join(f.root, path ?? ''), 'utf8')).trim().split('\n')[0] ?? '');
        const host = request.messages.find((message: { role: string; sections?: Record<string, string> }) => message.role === 'system' && message.sections?.pstack_host)?.sections.pstack_host;
        expect(host?.match(/^Host skills live at .+SKILL.md: (.+)\.$/m)?.[1]).toBe('create-skill, goal, loop');
      });
    } finally {
      await handle.close();
    }
  } finally {
    await f.close();
  }
}, 30000);
