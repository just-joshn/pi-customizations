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
    const provider = join(f.root, 'record-provider.mjs'); await writeFile(provider, `import journey from ${JSON.stringify(join(packageRoot, 'test/journey-provider.ts'))};\nprocess.env = { ...process.env, PSTACK_JOURNEY_LOG: ${JSON.stringify(f.root)} };\nexport default journey;\n`);
    const handle = await startDetachedRpc({
      directory: join(f.root, 'transport'),
      cwd: f.cwd,
      agentDir: join(f.root, 'real-agent'),
      ownerId: 'cloud-host-main-fixture',
      args: [
        '--approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--session-dir',
        join(f.root, 'shared-session-store'),
        '-e',
        join(packageRoot, 'src/index.ts'),
        '-e',
        provider,
        '--provider',
        'journey-test',
        '--model',
        'recorder',
      ],
    });
    try {
      const state = await handle.send({ type: 'get_state' });
      if (!state.success || state.command !== 'get_state') throw new Error('missing RPC session state'); const parentId = state.data.sessionId;
      const response = await handle.send({ type: 'prompt', message: 'Record the host contract without calling tools' }); expect(response.success).toBe(true);
      await vi.waitFor(async () => {
        const path = (await readdir(f.root)).find((name) => /^requests-\d+\.jsonl$/.test(name));
        expect(path).toBeDefined();
        const request = JSON.parse((await readFile(join(f.root, path ?? ''), 'utf8')).trim().split('\n')[0] ?? '');
        const host = request.messages.find((message: { role: string; sections?: Record<string, string> }) => message.role === 'system' && message.sections?.pstack_host)?.sections.pstack_host;
        expect(host?.match(/^Host skills live at .+SKILL.md: (.+)\.$/m)?.[1]).toBe('create-skill, goal, loop');
        expect(host).toContain(`Pi session storage directory: ${join(f.root, 'shared-session-store')}`);
        expect(host).toContain('pstack_context({ history: true })');
        expect(host).toContain('The storage directory may contain other workspaces');
        expect(host).not.toContain('Workspace Pi session directory:');
        expect(host).not.toContain('<parent-session-id>');
        expect(host).toContain(`Task child transcripts owned by this parent session: ${join(f.root, 'shared-session-store', 'pstack-workers', parentId)}`);
      });
    } finally { await handle.close(); }
  } finally {
    await f.close();
  }
}, 30000);
