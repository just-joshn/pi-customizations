import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalBashOperations, type ExtensionAPI, type ExtensionToolContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { createReadonlyBashTool, registerReadonlyShell, releaseReadonlySandbox } from '../../src/readonly-shell.ts';
import { createSessionShell, sessionBashDefinition } from '../../src/shell-state.ts';

function registeredBash(): ToolDefinition {
  const tools: ToolDefinition[] = [];
  const pi = { registerTool: (tool: ToolDefinition) => tools.push(tool), on: () => undefined } as unknown as ExtensionAPI;
  registerReadonlyShell(pi);
  const [bash] = tools;
  if (bash === undefined) throw new Error('no tool registered');
  return bash;
}

test('describes the subprocess boundary without claiming whole-process isolation', () => {
  const bash = registeredBash();
  expect(bash.name).toBe('bash');
  expect(bash.description).toContain('denies filesystem writes and Unix sockets. Network requests work, but run no command that changes state anywhere');
  expect(bash.description).toContain('Pi and trusted extensions are not sandboxed');
});

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('a process that used the shell exits on its own once its session shuts down', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-exit-'));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'fixtures/readonly-shell-exit.ts')], { cwd, encoding: 'utf8', timeout: 20_000 });
  expect(result.stdout).toContain('SANDBOXED');
  expect(result.stdout).toContain('SHUTDOWN-DONE');
  expect([result.error?.message, result.signal, result.status]).toEqual([undefined, null, 0]);
});

test('unsupported hosts fail closed without running a command', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd');
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const cwd = mkdtempSync(join(tmpdir(), 'pi-pstack-ro-'));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  await expect(registeredBash().execute('call-1', { command: 'touch escaped.txt' }, undefined, undefined, { cwd } as ExtensionToolContext)).rejects.toThrow('no verified OS sandbox is available');
  expect(existsSync(join(cwd, 'escaped.txt'))).toBe(false);
});

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('a read-only shell sharing a session shell continues from bash state and still denies writes', async () => {
  await releaseReadonlySandbox();
  onTestFinished(() => releaseReadonlySandbox());
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-ro-state-')));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const ctx = { cwd, model: undefined, sessionManager: { getSessionId: () => 'session', getSessionFile: () => undefined } } as unknown as ExtensionToolContext;
  const shell = createSessionShell();
  await sessionBashDefinition(shell, cwd, createLocalBashOperations()).execute('call', { command: 'mkdir sub && cd sub && export PSTACK_A=1' }, undefined, undefined, ctx);

  const result = await createReadonlyBashTool('plan_bash', shell).execute('call', { command: 'pwd; echo "a=$PSTACK_A"; touch escaped.txt 2>/dev/null || echo DENIED' }, undefined, undefined, ctx);

  expect(result.content).toEqual([{ type: 'text', text: `${cwd}/sub\na=1\nDENIED\n` }]);
  expect(existsSync(join(cwd, 'sub', 'escaped.txt'))).toBe(false);
});
