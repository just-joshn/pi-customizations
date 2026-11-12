import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { createReadonlyBashTool, releaseReadonlySandbox } from '../../src/readonly-shell.ts';

// Only macOS uses sandbox-runtime; Linux runs bubblewrap itself, and linux-readonly-sandbox-missing.test.ts covers its fail-closed path.
test.skipIf(process.platform === 'linux')('missing Unix socket isolation prevents the readonly command from running', async () => {
  const dependencyCheck = vi.spyOn(SandboxManager, 'checkDependencies').mockReturnValue({ errors: [], warnings: ['seccomp not available - unix socket access not restricted'] });
  onTestFinished(() => dependencyCheck.mockRestore());
  onTestFinished(releaseReadonlySandbox);
  const cwd = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-dependency-'));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));

  await expect(createReadonlyBashTool().execute('call', { command: 'touch escaped.txt' }, undefined, undefined, { cwd } as ExtensionToolContext)).rejects.toThrow(
    'no verified OS sandbox is available: seccomp not available - unix socket access not restricted',
  );
  expect(existsSync(join(cwd, 'escaped.txt'))).toBe(false);
});
