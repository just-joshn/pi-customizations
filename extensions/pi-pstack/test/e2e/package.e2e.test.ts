import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

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

test('publishes bundled tools without locally installed script dependencies', async ({ signal }) => {
  const copy = join(sandbox.root, 'pi-pstack');
  cpSync(PACKAGE_ROOT, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PACKAGE_ROOT.length)) });
  const installed = join(copy, 'skills/statechart/scripts/node_modules/local-only');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'index.js'), 'throw new Error("must not ship");');

  const { stdout } = await promisify(execFile)('npm', ['pack', copy, '--dry-run', '--json'], { cwd: sandbox.workDir, env: sandbox.env, signal });
  const packed = JSON.parse(stdout.slice(stdout.indexOf('[\n'))) as { files: { path: string }[] }[];
  const paths = packed.flatMap((entry) => entry.files.map((file) => file.path));
  expect(paths.filter((path) => path.includes('node_modules/'))).toEqual([]);
  expect(paths).toEqual(
    expect.arrayContaining([
      'src/index.ts',
      'src/inbox.ts',
      'bin/pstack-routines-supervisor',
      'skills/statechart/scripts/statechart',
      'skills/poteto-mode/scripts/watch-pr/watch-pr',
      'rules/no-inline-imports.mdc',
      'rules/typescript-exhaustive-switch.mdc',
    ]),
  );
  expect(paths.filter((path) => path.startsWith('skills/') && path.endsWith('/SKILL.md'))).toHaveLength(78);
});

test('a missing YAML dependency rejects metadata operations without blocking other tools', async () => {
  const copy = join(sandbox.root, 'pi-pstack');
  cpSync(PACKAGE_ROOT, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PACKAGE_ROOT.length)) });
  pi('install', copy);
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    rpc.send({ id: 'plan', type: 'prompt', message: '/plan' });
    await rpc.waitFor((event) => event['id'] === 'plan');
    rpc.send({ type: 'prompt', message: script([{ tool: 'CreatePlan', args: { plan: '# Missing YAML', todos: [{ id: 'build', content: 'Build it' }] } }]) });
    const review = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'select');
    rpc.send({ type: 'extension_ui_response', id: review['id'], value: 'No, propose changes' });
    rpc.send({ id: 'build', type: 'prompt', message: '/plan build' });
    const result = await rpc.waitFor((event) => event['id'] === 'build');
    expect(result['success']).toBe(true);
    const error = await rpc.waitFor((event) => event.type === 'extension_error' && String(event['error']).includes('Plan metadata needs the yaml dependency.'));
    expect(error).toMatchObject({ extensionPath: 'command:plan', event: 'command', error: expect.stringContaining('Run bun install in the pi-pstack package directory, then reload Pi.') });
    rpc.send({ id: 'off', type: 'prompt', message: '/plan off' });
    await rpc.waitFor((event) => event['id'] === 'off');
    rpc.send({ type: 'prompt', message: 'list\n@@tools-list' });
    const reply = await rpc.waitFor(
      (event) =>
        event.type === 'message_end' &&
        (event['message'] as { role: string }).role === 'assistant' &&
        contentText((event['message'] as { content: string }).content)
          .split(',')
          .includes('Loop'),
    );
    expect(contentText((reply['message'] as { content: string }).content).split(',')).toEqual(expect.arrayContaining(['bash', 'Loop', 'TodoWrite']));
  } finally {
    await rpc.close();
  }
});

test('missing regex dependencies refuse a watched command before it runs', async () => {
  const copy = join(sandbox.root, 'pi-pstack');
  cpSync(PACKAGE_ROOT, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PACKAGE_ROOT.length)) });
  pi('install', copy);
  const run = await runJson(sandbox, script([{ tool: 'bash_background', args: { command: 'touch must-not-run.txt', notify_on_output: { pattern: 'READY', reason: 'ready' } } }]), ['--no-session']);
  expect(toolEnds(run.events, 'bash_background')).toEqual([expect.objectContaining({ isError: true, text: 'Shell output monitoring needs the re2js dependency. Run bun install in the pi-pstack package directory, then reload Pi.' })]);
  expect(existsSync(join(sandbox.workDir, 'must-not-run.txt'))).toBe(false);
});

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
  expect(installed.commands.filter((name) => name.startsWith('skill:'))).toHaveLength(78);
  expect(
    installed.tools
      .split(',')
      .filter((name) => ['Task', 'TodoWrite', 'AskQuestion', 'Loop'].includes(name))
      .toSorted(),
  ).toEqual(['AskQuestion', 'Loop', 'Task', 'TodoWrite']);

  // A local install gets no dependency install. On macOS the readonly shell then has no sandbox module and must refuse;
  // on Linux it runs bubblewrap from the system, so the command runs read-only (TASK-019). Neither may write.
  const steps = [{ tool: 'bash', args: { command: 'touch escaped.txt' } }];
  const readonlyRun = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'ro', prompt: `go\n@@script ${JSON.stringify(steps)}`, readonly: true } }]), ['--no-session']);
  expect(toolEnds(readonlyRun.events, 'Task')[0]?.text).toContain(process.platform === 'linux' ? 'Read-only file system' : 'no verified OS sandbox is available');
  expect(existsSync(join(sandbox.workDir, 'escaped.txt'))).toBe(false);

  pi('remove', copy);
  expect(settingsPackages()).toEqual([]);
  const removed = await discovered();
  expect(removed.commands.filter((name) => name === 'mode' || name.startsWith('skill:'))).toEqual([]);
  expect(removed.tools.split(',').filter((name) => ['Task', 'TodoWrite'].includes(name))).toEqual([]);
});
