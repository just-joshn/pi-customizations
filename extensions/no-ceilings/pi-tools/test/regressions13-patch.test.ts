import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the thirteenth adversarial pass, wave B. Each test names the finding it locks down. */

const denySecret = { rules: [{ kind: 'read' as const, action: 'deny' as const, pattern: '**/secret.txt' }] };

describe('finding 1: apply_patch applies the read deny to every source it opens', () => {
  it('refuses to move a read-denied file to a readable name and writes nothing', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: denySecret });
    try {
      await h.write('secret.txt', 'TOPSECRET-PAYLOAD-123\nsecond line\n');
      const denied = await h.call('read', { path: 'secret.txt' });
      expect(denied.isError).toBe(true);

      const moved = await h.call('apply_patch', {
        patch: ['*** Begin Patch', '*** Update File: secret.txt', '*** Move to: leaked.txt', '*** End Patch'].join('\n'),
      });
      expect(moved.isError).toBe(true);
      expect((moved.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(moved)).toContain('rule: **/secret.txt');
      expect(textOf(moved)).not.toContain('TOPSECRET');
      expect(JSON.stringify(moved.details ?? {})).not.toContain('TOPSECRET');
      expect(existsSync(h.file('leaked.txt'))).toBe(false);
      expect(await readFile(h.file('secret.txt'), 'utf8')).toBe('TOPSECRET-PAYLOAD-123\nsecond line\n');
    } finally {
      await h.cleanup();
    }
  });

  it('refuses to update or delete a read-denied file in place', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: denySecret });
    try {
      await h.write('secret.txt', 'TOPSECRET-PAYLOAD-123\n');

      const updated = await h.call('apply_patch', {
        patch: ['*** Begin Patch', '*** Update File: secret.txt', '@@', '-TOPSECRET-PAYLOAD-123', '+CHANGED', '*** End Patch'].join('\n'),
      });
      expect(updated.isError).toBe(true);
      expect((updated.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(textOf(updated)).not.toContain('TOPSECRET');
      expect(await readFile(h.file('secret.txt'), 'utf8')).toBe('TOPSECRET-PAYLOAD-123\n');

      const deleted = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Delete File: secret.txt', '*** End Patch'].join('\n') });
      expect(deleted.isError).toBe(true);
      expect((deleted.details as { failure?: { kind?: string } }).failure?.kind).toBe('permission_denied');
      expect(existsSync(h.file('secret.txt'))).toBe(true);
      expect(await readFile(h.file('secret.txt'), 'utf8')).toBe('TOPSECRET-PAYLOAD-123\n');
    } finally {
      await h.cleanup();
    }
  });

  it('keeps patching an unchanged path and an add when no read deny matches', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: denySecret });
    try {
      await h.write('public.txt', 'alpha\n');
      const updated = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: public.txt', '@@', '-alpha', '+beta', '*** End Patch'].join('\n') });
      expect(updated.isError).toBeUndefined();
      expect(await readFile(h.file('public.txt'), 'utf8')).toBe('beta\n');

      const moved = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: public.txt', '*** Move to: moved.txt', '*** End Patch'].join('\n') });
      expect(moved.isError).toBeUndefined();
      expect(await readFile(h.file('moved.txt'), 'utf8')).toBe('beta\n');
      expect(existsSync(h.file('public.txt'))).toBe(false);

      const added = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Add File: added.txt', '+new', '*** End Patch'].join('\n') });
      expect(added.isError).toBeUndefined();
      expect(await readFile(h.file('added.txt'), 'utf8')).toBe('new\n');
    } finally {
      await h.cleanup();
    }
  });

  it('needs no read allow rule to patch in allowlist mode', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'allowlist', rules: [{ kind: 'write', action: 'allow', pattern: '**' }] } });
    try {
      await h.write('visible.txt', 'one\n');
      const updated = await h.call('apply_patch', { patch: ['*** Begin Patch', '*** Update File: visible.txt', '@@', '-one', '+two', '*** End Patch'].join('\n') });
      expect(updated.isError).toBeUndefined();
      expect(await readFile(h.file('visible.txt'), 'utf8')).toBe('two\n');
    } finally {
      await h.cleanup();
    }
  });
});
