import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { registerReadonlyShell } from '../src/readonly-shell.ts';

function registeredBash(): ToolDefinition {
  const tools: ToolDefinition[] = [];
  const pi = { registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI;
  registerReadonlyShell(pi);
  const [bash] = tools;
  if (bash === undefined) throw new Error('no tool registered');
  return bash;
}

test('describes the subprocess boundary without claiming whole-process isolation', () => {
  const bash = registeredBash();
  expect(bash.name).toBe('bash');
  expect(bash.description).toContain('denies filesystem writes and network access');
  expect(bash.description).toContain('Pi and trusted extensions are not sandboxed');
});

test('unsupported hosts fail closed without running a command', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const cwd = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-'));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  await expect(registeredBash().execute('call-1', { command: 'touch escaped.txt' }, undefined, undefined, { cwd } as ExtensionToolContext)).rejects.toThrow('no verified OS sandbox is available');
  expect(existsSync(join(cwd, 'escaped.txt'))).toBe(false);
});
