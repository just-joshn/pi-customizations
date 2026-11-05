import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { cursorReminder } from '../cursor-reference.ts';
import { makeSandbox, runJson, type Sandbox, script, toolEnds } from './harness.ts';

async function runShell(sandbox: Sandbox, prompt: string, options: Record<string, unknown> = {}) {
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'shell probe', subagent_type: 'shell', prompt, ...options } }]), ['--no-session']);
  expect(run.exitCode, run.stderr).toBe(0);
  const [result] = toolEnds(run.events, 'Task');
  if (result === undefined) throw new Error(`Task did not return a result: ${run.stderr}`);
  return result;
}

const response = (text: string) => /<response>\n([\s\S]*)\n<\/response>/.exec(text)?.[1];

// Cursor desktop 3.27.22 Jle/Mle retains SHELL, not READ, WRITE, TASK, AWAIT, or MCP.
test('shell exposes only native shell execution tools, even when an image model is available', async () => {
  const sandbox = makeSandbox({ extensions: [join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts'), join(PACKAGE_ROOT, 'test/fixtures/image-model.ts')] });
  onTestFinished(sandbox.dispose);
  const result = await runShell(sandbox, '@@tools-list');
  expect(result.isError, result.text).toBe(false);
  expect(response(result.text)?.split(',').toSorted()).toEqual(['bash', 'bash_background']);
});

test('shell executes commands but rejects calls to file-editing tools', async () => {
  const sandbox = makeSandbox();
  onTestFinished(sandbox.dispose);
  const result = await runShell(
    sandbox,
    script([
      { tool: 'bash', args: { command: "printf 'SHELL-WROTE\n' > shell.txt && printf SHELL-RAN" } },
      { tool: 'write', args: { path: 'write-tool.txt', content: 'NOT-ALLOWED' } },
    ]),
  );
  expect(result.isError, result.text).toBe(false);
  expect(response(result.text)).toBe('RESULTS:\n[bash] SHELL-RAN\n[write error] Tool write not found');
  expect(readFileSync(join(sandbox.workDir, 'shell.txt'), 'utf8')).toBe('SHELL-WROTE\n');
  expect(existsSync(join(sandbox.workDir, 'write-tool.txt'))).toBe(false);
});

test('shell instructions and canonical type survive a normalized invocation and a process restart', async () => {
  const sandbox = makeSandbox();
  onTestFinished(sandbox.dispose);
  const first = await runShell(sandbox, '@@sys', { subagent_type: ' SHELL_subagent-type ' });
  expect(first.isError, first.text).toBe(false);
  expect(first.text).toContain(`<pstack_subagent>\n${cursorReminder('shell')}\n</pstack_subagent>`);
  const agentId = /Agent ID: ([0-9a-f-]{36})/.exec(first.text)?.[1];
  if (agentId === undefined) throw new Error(`No agent ID in ${first.text}`);
  const resumed = await runShell(sandbox, '@@tools-list', { resume: agentId });
  expect(resumed.isError, resumed.text).toBe(false);
  expect(response(resumed.text)?.split(',').toSorted()).toEqual(['bash', 'bash_background']);
  expect(resumed.details).toMatchObject({ agentId, subagentType: 'shell' });
});

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('readonly shell intersects both restrictions and cannot write files', async () => {
  const sandbox = makeSandbox();
  onTestFinished(sandbox.dispose);
  const restricted = await runShell(sandbox, '@@tools-list', { readonly: true });
  expect(restricted.isError, restricted.text).toBe(false);
  expect(response(restricted.text)).toBe('bash');
  const denied = await runShell(sandbox, script([{ tool: 'bash', args: { command: 'touch forbidden.txt' } }]), { readonly: true });
  expect(denied.text).toContain('[bash error]');
  expect(existsSync(join(sandbox.workDir, 'forbidden.txt'))).toBe(false);
});
