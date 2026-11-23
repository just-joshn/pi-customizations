#!/usr/bin/env bun
/**
 * Drive the real pi-tools extension through the real Pi CLI against a deterministic fake model.
 *
 * Usage:
 *   bun .agents/skills/verify-pi-tools/scripts/verify.ts doctor
 *   bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature files
 *   bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature policy
 *
 * The script starts a fake OpenAI-compatible server with scripted turns, creates a disposable
 * workspace and Pi profile, runs `pi --print --mode json` with the extension loaded, asserts the
 * tool results and files on disk, and writes evidence under
 * .agents/skills/verify-pi-tools/evidence/<timestamp>-<feature>/. Cleanup removes the temp root and
 * the server; the evidence survives.
 */
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FAKE_MODEL_ID, FAKE_PROVIDER, writeFakeModelConfig } from '../../../../extensions/no-ceilings/pi-tools/test/support/fake-model.ts';
import { type FakeModelServer, type FakeTurn, startFakeModel } from '../../../../extensions/no-ceilings/pi-tools/test/support/fake-model-server.ts';

const skillRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const extensionPath = path.join(repoRoot, 'extensions', 'no-ceilings', 'pi-tools', 'src', 'index.ts');
const evidenceRoot = path.join(skillRoot, 'evidence');
const extensionDir = path.join(repoRoot, 'extensions', 'no-ceilings', 'pi-tools');

interface Event {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly result?: { readonly content?: readonly { readonly text?: string }[] };
  readonly message?: { readonly role?: string; readonly content?: unknown };
}

interface Scenario {
  readonly feature: string;
  readonly tools: string;
  readonly prompt: string;
  readonly config: Record<string, unknown>;
  readonly seed: Readonly<Record<string, string>>;
  readonly turns: readonly FakeTurn[];
  readonly check: (context: RunContext) => void;
}

interface RunContext {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly Event[];
  readonly workspace: string;
  readonly server: FakeModelServer;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function eventText(event: Event | undefined): string {
  return (event?.result?.content ?? []).map((block) => block.text ?? '').join('\n');
}

function ends(context: RunContext): Event[] {
  return context.events.filter((event) => event.type === 'tool_execution_end');
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`check failed: ${message}`);
  }
}

function filesOnDisk(context: RunContext): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of ['notes.txt', 'out.txt', 'secret.txt', 'denied.txt', 'outside.txt']) {
    const file = path.join(context.workspace, name);
    if (existsSync(file)) {
      try {
        found[name] = readFileSync(file, 'utf-8');
      } catch {
        found[name] = '<unreadable>';
      }
    }
  }
  const outside = path.join(path.dirname(context.workspace), 'outside.txt');
  if (existsSync(outside)) {
    found['../outside.txt'] = readFileSync(outside, 'utf-8');
  }
  return found;
}

const scenarios: Record<string, Scenario> = {
  files: {
    feature: 'files',
    tools: 'write,read,edit',
    prompt: 'Write notes.txt with alpha, read it back, then replace alpha with beta.',
    config: { mode: 'auto' },
    seed: {},
    turns: [
      { toolCalls: [{ name: 'write', arguments: { path: 'notes.txt', content: 'alpha\n' } }] },
      { toolCalls: [{ name: 'read', arguments: { path: 'notes.txt' } }] },
      { toolCalls: [{ name: 'edit', arguments: { path: 'notes.txt', edits: [{ oldText: 'alpha', newText: 'beta' }] } }] },
      { text: 'FILES-OK' },
    ],
    check: (context) => {
      assert(context.code === 0, `pi exited ${context.code}`);
      assert(context.stdout.includes('FILES-OK'), 'final assistant text');
      const tools = ends(context);
      assert(tools.map((event) => event.toolName).join(',') === 'write,read,edit', `tool order ${tools.map((event) => event.toolName).join(',')}`);
      assert(
        tools.every((event) => event.isError !== true),
        'every tool call succeeds',
      );
      assert(eventText(tools[1]).includes('[file: 1 line, 6 bytes]'), 'read footer reports the file');
      assert(eventText(tools[1]).includes('[sha256: '), 'read footer carries the digest');
      const disk = filesOnDisk(context);
      assert(disk['notes.txt'] === 'beta\n', `notes.txt on disk is ${JSON.stringify(disk['notes.txt'])}`);
      const requests = context.server.requests;
      assert(requests.length >= 4, `model turns ${requests.length}`);
    },
  },
  search: {
    feature: 'search',
    tools: 'grep,find,ls',
    prompt: 'Search the workspace for needle, list TypeScript files, then list the root.',
    config: { mode: 'auto' },
    seed: { 'keep/a.ts': 'needle\n', 'skip/b.ts': 'needle\n', '.piignore': 'skip/\n' },
    turns: [{ toolCalls: [{ name: 'grep', arguments: { pattern: 'needle' } }] }, { toolCalls: [{ name: 'find', arguments: { pattern: '*.ts' } }] }, { toolCalls: [{ name: 'ls', arguments: {} }] }, { text: 'SEARCH-OK' }],
    check: (context) => {
      assert(context.code === 0, `pi exited ${context.code}`);
      assert(context.stdout.includes('SEARCH-OK'), 'final assistant text');
      const tools = ends(context);
      assert(
        tools.every((event) => event.isError !== true),
        'every search succeeds',
      );
      const grep = eventText(tools[0]);
      const find = eventText(tools[1]);
      const listing = eventText(tools[2]);
      assert(grep.includes('keep/a.ts'), `grep found keep/a.ts: ${grep}`);
      assert(!grep.includes('skip/b.ts'), `grep filtered skip/b.ts: ${grep}`);
      assert(find.includes('keep/a.ts'), `find found keep/a.ts: ${find}`);
      assert(!find.includes('skip/b.ts'), `find filtered skip/b.ts: ${find}`);
      assert(listing.includes('keep/'), `ls shows keep/: ${listing}`);
      assert(!listing.includes('skip'), `ls filtered skip: ${listing}`);
    },
  },
  policy: {
    feature: 'policy',
    tools: 'read,write',
    prompt: 'Try the forbidden reads and writes.',
    config: {
      mode: 'auto',
      rules: [
        { kind: 'read', action: 'deny', pattern: '**/secret.txt' },
        { kind: 'write', action: 'deny', pattern: '**/denied.txt' },
      ],
    },
    seed: { 'secret.txt': 'TOP-SECRET\n', 'denied.txt': 'original\n' },
    turns: [
      { toolCalls: [{ name: 'read', arguments: { path: 'secret.txt' } }] },
      { toolCalls: [{ name: 'write', arguments: { path: 'denied.txt', content: 'pwned\n' } }] },
      { toolCalls: [{ name: 'write', arguments: { path: '../outside.txt', content: 'escaped\n' } }] },
      { text: 'POLICY-OK' },
    ],
    check: (context) => {
      assert(context.code === 0, `pi exited ${context.code}`);
      assert(context.stdout.includes('POLICY-OK'), 'final assistant text');
      const tools = ends(context);
      assert(tools.length === 3, `tool calls ${tools.length}`);
      assert(
        tools.every((event) => event.isError === true),
        'every forbidden call is an error',
      );
      assert(eventText(tools[0]).includes('rule: **/secret.txt'), 'read deny rule named');
      assert(eventText(tools[1]).includes('rule: **/denied.txt'), 'write deny rule named');
      assert(eventText(tools[2]).includes('outside the workspace'), 'outside write refused');
      assert(eventText(tools[0]).includes('TOP-SECRET') === false, 'no secret content in the result');
      const disk = filesOnDisk(context);
      assert(disk['secret.txt'] === 'TOP-SECRET\n', 'secret.txt unchanged');
      assert(disk['denied.txt'] === 'original\n', 'denied.txt unchanged');
      assert(disk['../outside.txt'] === undefined, 'outside file was not created');
    },
  },
  shell: {
    feature: 'shell',
    tools: 'bash',
    prompt: 'Run a harmless shell write, then try a denied delete.',
    config: { mode: 'auto', rules: [{ kind: 'exec', action: 'deny', pattern: 'rm *' }] },
    seed: {},
    turns: [{ toolCalls: [{ name: 'bash', arguments: { command: 'printf "shell-ok" > out.txt && cat out.txt' } }] }, { toolCalls: [{ name: 'bash', arguments: { command: 'rm -f out.txt' } }] }, { text: 'SHELL-OK' }],
    check: (context) => {
      assert(context.code === 0, `pi exited ${context.code}`);
      assert(context.stdout.includes('SHELL-OK'), 'final assistant text');
      const tools = ends(context);
      assert(tools.length === 2, `tool calls ${tools.length}`);
      assert(tools[0]?.isError !== true, 'harmless command succeeds');
      assert(eventText(tools[0]).includes('shell-ok'), 'command stdout');
      assert(tools[1]?.isError === true, 'denied command fails');
      assert(eventText(tools[1]).includes('rule: rm *'), 'deny rule named');
      const disk = filesOnDisk(context);
      assert(disk['out.txt'] === 'shell-ok', `out.txt survives: ${JSON.stringify(disk['out.txt'])}`);
    },
  },
};

function doctor(): number {
  const pi = spawnSync('pi', ['--version'], { encoding: 'utf-8' });
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf-8' });
  const checks: Array<[string, boolean, string]> = [
    ['pi on PATH', pi.error === undefined, pi.error?.message ?? text(pi.stdout).trim()],
    ['bun on PATH', bun.error === undefined, bun.error?.message ?? text(bun.stdout).trim()],
    ['extension entry exists', existsSync(extensionPath), extensionPath],
    ['extension dependencies installed', existsSync(path.join(extensionDir, 'node_modules')), path.join(extensionDir, 'node_modules')],
    ['fake model server exists', existsSync(path.join(extensionDir, 'test', 'support', 'fake-model-server.ts')), 'test/support/fake-model-server.ts'],
    [
      'evidence directory writable',
      (() => {
        try {
          mkdirSync(evidenceRoot, { recursive: true });
          accessSync(evidenceRoot, constants.W_OK);
          return true;
        } catch {
          return false;
        }
      })(),
      evidenceRoot,
    ],
  ];
  let ok = true;
  for (const [label, passed, detail] of checks) {
    console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${passed ? '' : `: ${detail}`}`);
    ok &&= passed;
  }
  console.log(ok ? 'doctor: ok' : 'doctor: failed');
  return ok ? 0 : 1;
}

async function run(feature: string): Promise<number> {
  const scenario = scenarios[feature];
  if (scenario === undefined) {
    console.error(`unknown feature: ${feature}. Choose one of ${Object.keys(scenarios).join(', ')}`);
    return 2;
  }
  const server = await startFakeModel(scenario.turns);
  const root = await mkdtemp(path.join(tmpdir(), 'pi-tools-verify-'));
  const workspace = path.join(root, 'workspace');
  const agentDir = path.join(root, 'agent');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${feature}`;
  const evidenceDir = path.join(evidenceRoot, runId);
  let failure: string | undefined;
  try {
    await mkdir(workspace, { recursive: true });
    await writeFakeModelConfig(agentDir, server.baseUrl);
    await writeFile(path.join(agentDir, 'pi-tools.json'), JSON.stringify(scenario.config, null, 2));
    for (const [name, content] of Object.entries(scenario.seed)) {
      const file = path.join(workspace, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf-8');
    }

    const args = ['--print', '--mode', 'json', '--model', `${FAKE_PROVIDER}/${FAKE_MODEL_ID}`, '--provider', FAKE_PROVIDER, '--tools', scenario.tools, '-e', extensionPath, scenario.prompt];
    const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
    delete env['NODE_V8_COVERAGE'];
    const child = spawn('pi', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`pi did not finish within 45s`));
      }, 45_000);
      timeout.unref?.();
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
    const events = stdout
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line) as Event;
        } catch {
          return undefined;
        }
      })
      .filter((event): event is Event => event !== undefined);

    const context: RunContext = { code, stdout, stderr, events, workspace, server };
    try {
      scenario.check(context);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, 'command.txt'), `cwd: ${workspace}\npi ${args.join(' ')}\n`, 'utf-8');
    await writeFile(path.join(evidenceDir, 'stdout.jsonl'), stdout, 'utf-8');
    await writeFile(path.join(evidenceDir, 'stderr.txt'), stderr, 'utf-8');
    await writeFile(path.join(evidenceDir, 'events.json'), JSON.stringify(events, null, 2), 'utf-8');
    await writeFile(path.join(evidenceDir, 'files.json'), JSON.stringify(filesOnDisk(context), null, 2), 'utf-8');
    const toolLines = ends(context).map((event) => `${event.toolName}: ${event.isError === true ? 'error' : 'ok'} ${eventText(event).replace(/\n/g, ' | ').slice(0, 300)}`);
    await writeFile(
      path.join(evidenceDir, 'summary.txt'),
      [`feature: ${feature}`, `exit: ${code}`, `model turns: ${server.requests.length}`, `result: ${failure === undefined ? 'PASS' : `FAIL ${failure}`}`, '', ...toolLines, '', failure === undefined ? '' : `failure: ${failure}`].join('\n'),
      'utf-8',
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
  if (!existsSync(path.join(evidenceDir, 'summary.txt'))) {
    console.error(`evidence missing after cleanup: ${evidenceDir}`);
    return 1;
  }
  console.log(`feature: ${feature}`);
  console.log(`result: ${failure === undefined ? 'PASS' : 'FAIL'}`);
  if (failure !== undefined) {
    console.error(`failure: ${failure}`);
  }
  console.log(`evidence: ${evidenceDir}`);
  return failure === undefined ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'doctor') {
  process.exit(doctor());
} else if (command === 'run') {
  const featureIndex = rest.indexOf('--feature');
  const feature = featureIndex === -1 ? '' : (rest[featureIndex + 1] ?? '');
  run(feature)
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
} else {
  console.error('usage: verify.ts doctor | verify.ts run --feature <files|search|policy|shell>');
  process.exit(2);
}
