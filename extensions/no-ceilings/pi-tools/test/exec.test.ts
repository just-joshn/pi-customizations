import { mkdir, writeFile } from 'node:fs/promises';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createHarness, textOf } from './harness.ts';

describe('bash', () => {
  it('captures stdout, stderr, and the exit code', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'printf "out\\n"; printf "err\\n" >&2' });
      const text = textOf(result);
      expect(text).toContain('out');
      expect(text).toContain('err');
      expect((result.details as { exitCode?: number }).exitCode).toBe(0);
      expect(result.isError).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  it('marks a non-zero exit as an error result', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'printf "before\\n"; exit 7' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Command exited with code 7');
      expect((result.details as { exitCode?: number }).exitCode).toBe(7);
    } finally {
      await harness.cleanup();
    }
  });

  it('runs in the requested working directory', async () => {
    const harness = await createHarness();
    try {
      await harness.write('nested/marker.txt', 'here\n');
      const result = await harness.call('bash', { command: 'pwd', cwd: 'nested' });
      expect(textOf(result)).toContain(harness.file('nested'));
    } finally {
      await harness.cleanup();
    }
  });

  it('adds and overrides environment variables on top of the inherited environment', async () => {
    vi.stubEnv('PI_TOOLS_TEST_INHERITED', 'from-parent');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'printf "%s|%s" "$PI_TOOLS_TEST_INHERITED" "$PI_TOOLS_TEST_EXTRA"', env: { PI_TOOLS_TEST_EXTRA: 'extra value' } });
      expect(textOf(result)).toContain('from-parent|extra value');
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a missing working directory without running the command', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'touch should-not-exist', cwd: 'missing-dir' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Working directory does not exist');
    } finally {
      await harness.cleanup();
    }
  });

  it('times out and says so', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'sleep 5; printf done', timeout: 1 });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('timed out after 1');
    } finally {
      await harness.cleanup();
    }
  });

  it('stops on abort', async () => {
    const harness = await createHarness();
    try {
      const controller = new AbortController();
      const pending = harness.call('bash', { command: 'sleep 5; printf done' }, { signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      const result = await pending;
      expect(textOf(result)).toContain('Command aborted');
    } finally {
      await harness.cleanup();
    }
  });

  it('streams progress updates and spills truncated output to a file', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('bash', { command: 'i=0; while [ $i -lt 3000 ]; do echo "line $i"; i=$((i+1)); done' });
      expect(harness.updates.length).toBeGreaterThan(0);
      expect(textOf(result)).toContain('Full output:');
      const details = result.details as { fullOutputPath?: string; truncation?: { truncated?: boolean } };
      expect(details.truncation?.truncated).toBe(true);
      expect(details.fullOutputPath).toBeDefined();
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses commands the policy denies and asks before switching on approval mode', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'rm -rf *' }] } });
    try {
      const denied = await harness.call('bash', { command: 'rm -rf node_modules' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('Blocked by permissions configuration');

      const open = await createHarness({ config: { mode: 'allowlist', rules: [{ kind: 'exec', action: 'allow', pattern: 'printf allowed' }] } });
      try {
        const allowed = await open.call('bash', { command: 'printf allowed' });
        expect(allowed.isError).toBeUndefined();
        expect(textOf(allowed)).toContain('allowed');
        const blocked = await open.call('bash', { command: 'printf nope' });
        expect(blocked.isError).toBe(true);
      } finally {
        await open.cleanup();
      }
    } finally {
      await harness.cleanup();
    }
  });
});

describe('git', () => {
  it('runs status, add, commit, and log through the local executable', async () => {
    const harness = await createHarness();
    try {
      await mkdir(harness.file('repo'), { recursive: true });
      await writeFile(harness.file('repo/a.txt'), 'one\n', 'utf-8');
      const init = await harness.call('git', { subcommand: 'init', cwd: 'repo' });
      expect(init.isError).toBeUndefined();
      await harness.call('git', { subcommand: 'config', args: ['user.email', 'test@example.com'], cwd: 'repo' });
      await harness.call('git', { subcommand: 'config', args: ['user.name', 'Test'], cwd: 'repo' });
      const status = await harness.call('git', { subcommand: 'status', args: ['--porcelain'], cwd: 'repo' });
      expect(textOf(status)).toContain('a.txt');
      const add = await harness.call('git', { subcommand: 'add', args: ['a.txt'], cwd: 'repo' });
      expect(add.isError).toBeUndefined();
      const commit = await harness.call('git', { subcommand: 'commit', args: ['-m', 'initial'], cwd: 'repo' });
      expect(commit.isError).toBeUndefined();
      const log = await harness.call('git', { subcommand: 'log', args: ['--oneline'], cwd: 'repo' });
      expect(textOf(log)).toContain('initial');
      expect((log.details as { exitCode?: number }).exitCode).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  it('reports a failure with stderr', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('git', { subcommand: 'log' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not a git repository');
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects a malformed subcommand and a denied command', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'exec', action: 'deny', pattern: 'git push*' }] } });
    try {
      const malformed = await harness.call('git', { subcommand: 'status; rm -rf /' });
      expect(malformed.isError).toBe(true);
      expect(textOf(malformed)).toContain('Invalid git subcommand');
      const denied = await harness.call('git', { subcommand: 'push' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});
