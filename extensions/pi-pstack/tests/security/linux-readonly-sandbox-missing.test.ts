import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { createReadonlyBashTool } from '../../src/readonly-shell.ts';

// Its own file, because the sandbox check runs once per process and keeps its outcome.
test.skipIf(process.platform !== 'linux')('without bubblewrap the readonly command fails closed and never runs', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'pi-pstack-nopath-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-missing-'));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(empty, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
  vi.stubEnv('PATH', empty);
  await expect(createReadonlyBashTool().execute('call', { command: 'touch escaped.txt' }, undefined, undefined, { cwd } as ExtensionToolContext)).rejects.toThrow(
    /^no verified OS sandbox is available: bubblewrap \(bwrap\) is not available: /,
  );
  expect(existsSync(join(cwd, 'escaped.txt'))).toBe(false);
});
