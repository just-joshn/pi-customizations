import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the twelfth adversarial pass, wave C. A repository nested in the workspace carries
 * the same git metadata hazard as the root one, so every write surface refuses both. */

const CONFIG = 'is git config';
const HOOK = 'is a git hook';

describe('finding 1: a nested repository lets the agent write .git/config and .git/hooks', () => {
  it('refuses every write surface on a nested .git/config and .git/hooks, and keeps the root refusal', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto' } });
    const nestedConfig = () => readFile(h.file('sub/.git/config'), 'utf8');
    const nestedHook = () => readFile(h.file('sub/.git/hooks/pre-commit'), 'utf8');
    try {
      expect((await h.call('bash', { command: 'git init -q sub' })).isError).toBeUndefined();
      expect((await h.call('bash', { command: 'git init -q .' })).isError).toBeUndefined();
      const originalConfig = await nestedConfig();
      const hostileHook = '#!/bin/sh\ntouch pwned\n';
      await h.write('sub/.git/hooks/pre-commit', hostileHook);

      const writeConfig = await h.call('write', { path: 'sub/.git/config', content: `${originalConfig}\n[core]\n\tfsmonitor = /tmp/evil.sh\n` });
      expect(writeConfig.isError).toBe(true);
      expect((writeConfig.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(writeConfig)).toContain('Blocked: sub/.git/config is git config');
      expect(await nestedConfig()).toBe(originalConfig);

      const writeHook = await h.call('write', { path: 'sub/.git/hooks/pre-commit', content: '#!/bin/sh\ntouch other\n' });
      expect(writeHook.isError).toBe(true);
      expect((writeHook.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(writeHook)).toContain('Blocked: sub/.git/hooks/pre-commit is a git hook');
      expect(await nestedHook()).toBe(hostileHook);

      const editedConfig = await h.call('edit', { path: 'sub/.git/config', edits: [{ oldText: 'repositoryformatversion = 0', newText: 'repositoryformatversion = 1' }] });
      expect(editedConfig.isError).toBe(true);
      expect(textOf(editedConfig)).toContain(`sub/.git/config ${CONFIG}`);
      expect(await nestedConfig()).toBe(originalConfig);

      const editedHook = await h.call('edit', { path: 'sub/.git/hooks/pre-commit', edits: [{ oldText: 'touch pwned', newText: 'touch other' }] });
      expect(editedHook.isError).toBe(true);
      expect(textOf(editedHook)).toContain(`sub/.git/hooks/pre-commit ${HOOK}`);
      expect(await nestedHook()).toBe(hostileHook);

      const patchedConfig = await h.call('apply_patch', {
        patch: ['*** Begin Patch', '*** Update File: sub/.git/config', '@@', '-\trepositoryformatversion = 0', '+\trepositoryformatversion = 1', '*** End Patch'].join('\n'),
      });
      expect(patchedConfig.isError).toBe(true);
      expect(textOf(patchedConfig)).toContain(`sub/.git/config ${CONFIG}`);
      expect(await nestedConfig()).toBe(originalConfig);

      const patchedHook = await h.call('apply_patch', {
        patch: ['*** Begin Patch', '*** Update File: sub/.git/hooks/pre-commit', '@@', '-#!/bin/sh', '+#!/bin/sh', '*** End Patch'].join('\n'),
      });
      expect(patchedHook.isError).toBe(true);
      expect(textOf(patchedHook)).toContain(`sub/.git/hooks/pre-commit ${HOOK}`);
      expect(await nestedHook()).toBe(hostileHook);

      const savedConfig = await h.call('save_resource', { path: 'sub/.git/config', content: '[core]\n\tfsmonitor = /tmp/evil.sh\n', overwrite: true });
      expect(savedConfig.isError).toBe(true);
      expect(textOf(savedConfig)).toContain(`sub/.git/config ${CONFIG}`);
      expect(await nestedConfig()).toBe(originalConfig);

      const savedHook = await h.call('save_resource', { path: 'sub/.git/hooks/pre-commit', content: '#!/bin/sh\ntouch other\n', overwrite: true });
      expect(savedHook.isError).toBe(true);
      expect(textOf(savedHook)).toContain(`sub/.git/hooks/pre-commit ${HOOK}`);
      expect(await nestedHook()).toBe(hostileHook);

      for (const [command, reason] of [
        ['printf pwn > sub/.git/config', `sub/.git/config ${CONFIG}`],
        ['printf pwn > sub/.git/hooks/pre-commit', `sub/.git/hooks/pre-commit ${HOOK}`],
        ['cp sub/.git/config sub/.git/hooks/pre-commit', `sub/.git/hooks/pre-commit ${HOOK}`],
        ['rm sub/.git/config', `sub/.git/config ${CONFIG}`],
      ] as const) {
        const result = await h.call('bash', { command });
        expect(result.isError, command).toBe(true);
        expect(textOf(result), command).toContain(reason);
      }
      expect(await nestedConfig()).toBe(originalConfig);
      expect(await nestedHook()).toBe(hostileHook);

      const removedConfig = await h.call('delete', { path: 'sub/.git/config' });
      expect(removedConfig.isError).toBe(true);
      expect((removedConfig.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(removedConfig)).toContain(`sub/.git/config ${CONFIG}`);
      expect(existsSync(h.file('sub/.git/config'))).toBe(true);

      // A repository deeper in the tree gets the same refusal, and the root control still holds.
      expect((await h.call('bash', { command: 'git init -q vendor/lib' })).isError).toBeUndefined();
      const deepConfig = await readFile(h.file('vendor/lib/.git/config'), 'utf8');
      for (const [target, reason] of [
        ['vendor/lib/.git/config', `vendor/lib/.git/config ${CONFIG}`],
        ['vendor/lib/.git/hooks/pre-commit', `vendor/lib/.git/hooks/pre-commit ${HOOK}`],
        ['.git/config', `.git/config ${CONFIG}`],
        ['.git/hooks/pre-commit', `.git/hooks/pre-commit ${HOOK}`],
      ] as const) {
        const result = await h.call('write', { path: target, content: 'pwn\n' });
        expect(result.isError, target).toBe(true);
        expect(textOf(result), target).toContain(`Blocked: ${reason}`);
      }
      expect(await readFile(h.file('vendor/lib/.git/config'), 'utf8')).toBe(deepConfig);

      // Reads still work, and the predicate does not catch an ordinary file beside `.git`.
      const readConfig = await h.call('read', { path: 'sub/.git/config' });
      expect(readConfig.isError).toBeUndefined();
      expect(textOf(readConfig)).toContain('repositoryformatversion');
      expect((await h.call('write', { path: 'sub/notes.txt', content: 'hello\n' })).isError).toBeUndefined();
      expect((await h.call('write', { path: 'sub/.gitattributes', content: '* text=auto\n' })).isError).toBeUndefined();
    } finally {
      await h.cleanup();
    }
  });
});
