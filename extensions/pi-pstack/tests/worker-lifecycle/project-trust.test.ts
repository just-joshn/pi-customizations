import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { expect, test } from 'vitest';
import { type ContainerPlan, containerRunArgs } from '../../src/container.ts';
import { loadAssignment } from '../../src/run-files.ts';
import { type HostLaunch, parseLaunch, piArgs } from '../../src/worker-host.ts';

const PI = process.env['PSTACK_E2E_PI'] || '/Users/josh-desktop/.pi/agent/bin/pi';
const HOST = resolve(import.meta.dirname, '../../dist/worker-host.js');
const MARKERS = ['extension', 'settings-extension', 'package', 'mcp', 'mcp-env'];

function fixture(trust: 'always' | 'saved-project' | 'saved-parent') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-trust-')));
  const project = join(root, 'project');
  const agent = join(root, 'agent');
  const runRoot = join(project, '.pi/pstack/runs/trust');
  const workerDir = join(runRoot, 'workers/worker');
  const put = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const json = (path: string, value: unknown) => put(path, JSON.stringify(value));
  const marker = (name: string) => join(root, `${name}.marker`);
  const extension = (name: string) => `import { writeFileSync } from 'node:fs';\nexport default function () { writeFileSync(${JSON.stringify(marker(name))}, 'executed'); }\n`;
  put(join(project, '.pi/extensions/planted.ts'), extension('extension'));
  put(join(project, 'configured.ts'), extension('settings-extension'));
  put(join(project, 'package/index.ts'), extension('package'));
  json(join(project, 'package/package.json'), { name: 'planted-package', pi: { extensions: ['./index.ts'] } });
  json(join(project, '.pi/settings.json'), { extensions: ['../configured.ts'], packages: ['../package'] });
  put(join(project, '.pi/skills/planted/SKILL.md'), '---\nname: planted\ndescription: Unapproved project skill\n---\nNever load this skill.\n');
  put(join(project, '.pi/prompts/planted-prompt.md'), 'Unapproved project prompt.\n');
  const server = join(project, 'server.cjs');
  put(
    server,
    `const fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker('mcp'))}, 'executed');\nrequire('node:readline').createInterface({ input: process.stdin }).on('line', line => {\n  const request = JSON.parse(line);\n  if (request.id === undefined) return;\n  const result = request.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'planted', version: '1' } } : { tools: [] };\n  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');\n});\n`,
  );
  json(join(project, '.pi/mcp.json'), {
    mcpServers: {
      planted: {
        command: process.execPath,
        args: [server],
        env: { PLANTED: `!${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker('mcp-env'))}, 'executed'); process.stdout.write('ready')`)}` },
      },
    },
  });
  json(join(agent, 'settings.json'), { defaultProjectTrust: trust === 'always' ? 'always' : 'ask' });
  if (trust !== 'always') json(join(agent, 'trust.json'), { [trust === 'saved-project' ? project : root]: true });
  put(join(workerDir, 'brief.md'), 'Do not start a model call.\n');
  json(join(runRoot, 'run.json'), {
    schemaVersion: 1,
    runId: 'trust',
    title: 'project trust',
    playbook: 'bug-fix',
    upstreamRevision: 'test',
    createdAt: new Date().toISOString(),
    parentSessionFile: join(root, 'parent.jsonl'),
    inputCommit: null,
  });
  const file = join(workerDir, 'assignment.json');
  json(file, {
    schemaVersion: 1,
    runId: 'trust',
    workerId: 'worker',
    kind: 'pi',
    role: 'general',
    brief: 'brief.md',
    model: 'openai/gpt-4o',
    thinkingLevel: null,
    workspace: { mode: 'readonly', path: project },
    skills: [],
    capabilities: { mcp: 'inherit', env: 'inherit', externalWrite: false, spawn: false },
  });
  const loaded = loadAssignment(file);
  const launch: HostLaunch = {
    piCommand: [PI],
    model: { provider: 'openai', id: 'gpt-4o' },
    thinkingLevel: null,
    appendSystemPrompt: null,
    tools: null,
    tmuxSession: 'pstack_trust_worker_12345678',
    extraArgs: ['--offline', '--no-context-files'],
    credentialEnv: [],
    container: null,
  };
  const env = { PATH: process.env['PATH'], HOME: root, TMPDIR: tmpdir(), PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' };
  const markers = () => MARKERS.filter((name) => existsSync(marker(name)));
  return { root, project, agent, runRoot, workerDir, file, loaded, launch, env, markers, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

type Fixture = ReturnType<typeof fixture>;

async function rpc(f: Fixture, args: string[], approved = false) {
  const child = spawn(PI, args, { cwd: f.project, env: f.env, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const records = () =>
    stdout
      .split('\n')
      .slice(0, -1)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  child.stdin.write('{"id":"state","type":"get_state"}\n{"id":"commands","type":"get_commands"}\n');
  try {
    await expect.poll(() => records().find((record) => record.id === 'commands'), { timeout: 20_000 }).toMatchObject({ type: 'response', success: true });
    expect(records()).toContainEqual(expect.objectContaining({ id: 'state', type: 'response', success: true }));
    if (approved) await expect.poll(f.markers, { timeout: 10_000 }).toContain('mcp');
  } finally {
    child.stdin.end();
    expect(await closed, stderr).toEqual([0, null]);
    console.info(
      JSON.stringify({
        command: [PI, ...args],
        cwd: f.project,
        markers: f.markers(),
        responses: records()
          .filter((record) => record.type === 'response')
          .map(({ id, success }) => ({ id, success })),
        stderr,
      }),
    );
  }
  return records().find((record) => record.id === 'commands');
}

test.each(['always', 'saved-project', 'saved-parent'] as const)('worker RPC startup denies project resources despite %s operator trust', async (trust) => {
  const f = fixture(trust);
  try {
    const commands = await rpc(f, piArgs(f.loaded, f.launch));
    expect(f.markers()).toEqual([]);
    expect(JSON.stringify(commands)).not.toContain('planted');
  } finally {
    f.dispose();
  }
});

test('the planted executable resources run when the real binary explicitly approves them', async () => {
  const f = fixture('always');
  try {
    const commands = await rpc(f, [...piArgs(f.loaded, f.launch), '--approve'], true);
    expect(f.markers().sort()).toEqual([...MARKERS].sort());
    expect(JSON.stringify(commands)).toContain('planted');
  } finally {
    f.dispose();
  }
});

test.each(['--approve', '-a', '--'])('worker launch rejects an unaudited %s trust override', (override) => {
  const f = fixture('always');
  try {
    f.launch.extraArgs.push(override);
    expect(() => parseLaunch(JSON.stringify(f.launch))).toThrow('Worker Pi extra arguments must not override project trust');
  } finally {
    f.dispose();
  }
});

test('container argv carries the same explicit worker trust decision without starting Docker', () => {
  const f = fixture('always');
  try {
    const plan: ContainerPlan = { docker: '/usr/bin/docker', name: 'pstack_trust_worker_12345678', runId: 'trust', image: `sha256:${'a'.repeat(64)}`, user: '1000:1000', mounts: [] };
    writeFileSync(f.file, JSON.stringify({ ...f.loaded.assignment, workspace: { mode: 'container', inputCommit: 'a'.repeat(40) } }));
    const command = ['node', '/pi/cli.js', ...piArgs(loadAssignment(f.file), { ...f.launch, container: plan })];
    const argv = containerRunArgs(plan, f.workerDir, command);
    expect(argv.slice(argv.indexOf('pstack-container') + 1)).toEqual(command);
    expect(command).toContain('--no-approve');
    console.info(JSON.stringify({ containerArgv: [plan.docker, ...argv], executed: false }));
  } finally {
    f.dispose();
  }
});

test.each(['readonly', 'worktree'] as const)('the actual %s worker host records its deny decision and starts an unloaded project', async (mode) => {
  const f = fixture('saved-parent');
  if (mode === 'worktree') {
    const git = (...args: string[]) => execFileSync('git', ['-C', f.project, ...args], { encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('add', '.pi/extensions', '.pi/skills', '.pi/prompts', '.pi/settings.json', '.pi/mcp.json', 'configured.ts', 'package', 'server.cjs');
    git('-c', 'user.name=trust-test', '-c', 'user.email=trust@test.invalid', 'commit', '--quiet', '-m', 'Plant project resources');
    writeFileSync(f.file, JSON.stringify({ ...f.loaded.assignment, workspace: { mode, inputCommit: git('rev-parse', 'HEAD') }, capabilities: { ...f.loaded.assignment.capabilities, spawn: true } }));
  }
  const loaded = loadAssignment(f.file);
  mkdirSync(join(f.workerDir, 'claim'));
  writeFileSync(join(f.workerDir, 'claim/launch-env.json'), JSON.stringify(f.env), { mode: 0o600 });
  const host = spawn(process.execPath, [HOST, f.file, JSON.stringify(f.launch)], { cwd: f.project, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(host, 'close');
  let output = '';
  let stderr = '';
  host.stdout.on('data', (chunk) => {
    output += chunk;
  });
  host.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  try {
    await expect.poll(() => output, { timeout: 30_000 }).toContain('[host ready]');
    const launch = readFileSync(join(f.runRoot, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((record) => record.kind === 'launch');
    console.info(JSON.stringify({ hostLaunch: launch.data, markers: f.markers() }));
    expect(launch.data.projectTrust).toEqual({ decision: 'deny', flag: '--no-approve' });
    expect(launch.data.command).toEqual([PI, ...piArgs(loaded, f.launch)]);
    expect(f.markers()).toEqual([]);
    host.stdin.write('shutdown\n');
    expect(await closed, stderr).toEqual([0, null]);
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGTERM');
    await closed;
    f.dispose();
  }
});
