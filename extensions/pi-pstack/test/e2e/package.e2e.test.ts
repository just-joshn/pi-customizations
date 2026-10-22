import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { contentText, makeSandbox, piInvocation, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox({ packages: [] });
});
afterEach(() => sandbox.dispose());

const pi = (...args: string[]) => execFileSync(...piInvocation(args), { cwd: sandbox.workDir, env: sandbox.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const settingsPackages = () => ((JSON.parse(readFileSync(join(sandbox.agentDir, 'settings.json'), 'utf8')) as { packages?: string[] }).packages ?? []).map((entry) => resolve(sandbox.agentDir, entry));

async function discovered(): Promise<{ commands: string[]; tools: string }> {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    rpc.send({ id: 'commands', type: 'get_commands' });
    const response = await rpc.waitFor((event) => event['id'] === 'commands');
    const commands = ((response['data'] as { commands: { name: string }[] }).commands ?? []).map((command) => command.name);
    rpc.send({ type: 'prompt', message: 'list\n@@tools-list' });
    const reply = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant');
    return { commands, tools: contentText((reply['message'] as { content: { type: string; text?: string }[] }).content) };
  } finally {
    await rpc.close();
  }
}

test('installs from a fresh copy without node_modules, then removes cleanly (PKG-001)', async () => {
  const copy = join(sandbox.root, 'pi-pstack');
  cpSync(PACKAGE_ROOT, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PACKAGE_ROOT.length)) });
  expect(existsSync(join(copy, 'node_modules'))).toBe(false);

  pi('install', copy);
  expect(settingsPackages()).toEqual([copy]);
  const installed = await discovered();
  expect(installed.commands.filter((name) => ['mode', 'loop', 'skill:poteto-mode', 'skill:how', 'skill:create-skill', 'skill:deslop'].includes(name)).toSorted()).toEqual([
    'loop',
    'mode',
    'skill:create-skill',
    'skill:deslop',
    'skill:how',
    'skill:poteto-mode',
  ]);
  expect(installed.commands.filter((name) => name.startsWith('skill:'))).toHaveLength(61);
  expect(
    installed.tools
      .split(',')
      .filter((name) => ['Task', 'TodoWrite', 'AskQuestion', 'Loop'].includes(name))
      .toSorted(),
  ).toEqual(['AskQuestion', 'Loop', 'Task', 'TodoWrite']);

  // A local install gets no dependency install, so the readonly shell has no sandbox module and must refuse (TASK-019).
  const steps = [{ tool: 'bash', args: { command: 'touch escaped.txt' } }];
  const readonlyRun = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'ro', prompt: `go\n@@script ${JSON.stringify(steps)}`, readonly: true } }]), ['--no-session']);
  expect(toolEnds(readonlyRun.events, 'Task')[0]?.text).toContain('no verified OS sandbox is available');
  expect(existsSync(join(sandbox.workDir, 'escaped.txt'))).toBe(false);

  pi('remove', copy);
  expect(settingsPackages()).toEqual([]);
  const removed = await discovered();
  expect(removed.commands.filter((name) => name === 'mode' || name.startsWith('skill:'))).toEqual([]);
  expect(removed.tools.split(',').filter((name) => ['Task', 'TodoWrite'].includes(name))).toEqual([]);
});
