import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeSandbox, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

const IMAGE = process.env['PSTACK_TEST_CLOUD_IMAGE'] ?? 'node:22.22.2-bookworm';

function dockerReady(): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** An address both this host and a container can reach, so a container can push to a git daemon on the host. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  return undefined;
}

const ready = dockerReady() && lanAddress() !== undefined;
const AGENT_ID = /Agent ID: ([0-9a-f-]{36})/;
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 }).trim();

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '0.0.0.0', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

describe.skipIf(!ready)(`cloud agents on a container machine (needs a Docker engine with ${IMAGE} and a LAN address)`, () => {
  let sandbox: Sandbox;
  let daemon: ChildProcess | undefined;
  const containers: string[] = [];
  beforeEach(() => {
    sandbox = makeSandbox();
    sandbox.env['PSTACK_CLOUD_DRIVER'] = 'container';
    sandbox.env['PSTACK_CLOUD_IMAGE'] = IMAGE;
    delete sandbox.env['GH_TOKEN'];
    delete sandbox.env['GITHUB_TOKEN'];
  });
  afterEach(() => {
    for (const name of containers.splice(0)) {
      try {
        docker('rm', '--force', name);
      } catch {}
    }
    daemon?.kill();
    sandbox.dispose();
  });

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();

  /** A bare remote served by git daemon at the LAN address, cloned into the work directory with one unpushed commit and one uncommitted edit. */
  async function pushedRepo(): Promise<{ remote: string; url: string; pushed: string }> {
    const remote = join(sandbox.root, 'remote.git');
    const seed = join(sandbox.root, 'seed');
    mkdirSync(seed);
    git(seed, 'init', '-q', '-b', 'main');
    writeFileSync(join(seed, 'a.txt'), 'PUSHED');
    git(seed, 'add', 'a.txt');
    git(seed, 'commit', '-qm', 'pushed commit');
    execFileSync('git', ['clone', '-q', '--bare', seed, remote]);
    git(remote, 'config', 'daemon.receivepack', 'true');
    const port = await freePort();
    daemon = spawn('git', ['daemon', '--reuseaddr', '--export-all', '--enable=receive-pack', `--base-path=${sandbox.root}`, `--port=${port}`, '--listen=0.0.0.0', sandbox.root], { stdio: 'ignore' });
    const url = `git://${lanAddress()}:${port}/remote.git`;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync('git', ['ls-remote', url], { stdio: 'ignore', timeout: 5_000 });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    execFileSync('git', ['clone', '-q', url, sandbox.workDir]);
    writeFileSync(join(sandbox.workDir, 'a.txt'), 'UNPUSHED');
    git(sandbox.workDir, 'commit', '-qam', 'local only');
    writeFileSync(join(sandbox.workDir, 'a.txt'), 'UNCOMMITTED');
    return { remote, url, pushed: git(remote, 'rev-parse', 'main') };
  }

  test('runs the agent on its own container with a fresh clone of the pushed remote, and the agent pushes its branch (G1)', async () => {
    const { remote, url, pushed } = await pushedRepo();
    const hostOnly = join(sandbox.root, 'host-only.txt');
    writeFileSync(hostOnly, 'SECRET');
    const command = `pwd; hostname; cat a.txt; echo; test -e ${hostOnly} && echo HOST-FILE-VISIBLE || echo HOST-FILE-HIDDEN; grep -q bookworm /etc/os-release && echo DEBIAN; echo CHILD > b.txt; git add b.txt; git -c user.email=t@t -c user.name=t commit -qm CHILD-COMMIT; git push -q 2>&1; echo PUSHED-$?`;
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'cloud probe', prompt: `go\n@@script ${JSON.stringify([{ tool: 'bash', args: { command } }])}`, environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    if (result === undefined) throw new Error(`Task never ran\n${run.stderr}`);
    expect(result.isError, result.text).toBe(false);
    const agentId = AGENT_ID.exec(result.text)?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    const machine = (result.details as { machine?: { driver: string; path: string; container: string; branch: string; commit: string; remote: string } }).machine;
    expect(machine).toMatchObject({ driver: 'container', container: `pstack-${agentId}`, branch: `pstack/${agentId}`, commit: pushed, remote: url });
    const lines = (/<response>\n([\s\S]*)\n<\/response>/.exec(result.text)?.[1] ?? '').split('\n');
    expect(lines).toEqual(['RESULTS:', `[bash] ${machine?.path}`, `pstack-${agentId.slice(0, 8)}`, 'PUSHED', 'HOST-FILE-HIDDEN', 'DEBIAN', 'PUSHED-0', '']);
    expect(git(remote, 'log', '-1', '--format=%s', `pstack/${agentId}`)).toBe('CHILD-COMMIT');
    expect(git(remote, 'rev-parse', `pstack/${agentId}~1`)).toBe(pushed);
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${agentId}`), { timeout: 20_000 }).toBe('exited');
    expect(readFileSync(join(sandbox.workDir, 'a.txt'), 'utf8')).toBe('UNCOMMITTED');
  });

  test('a resume boots the stopped machine and continues the same agent there (G1)', async () => {
    await pushedRepo();
    const first = await runJson(
      sandbox,
      script([{ tool: 'Task', args: { description: 'first', prompt: `go\n@@script ${JSON.stringify([{ tool: 'bash', args: { command: 'echo KEPT > /tmp/state.txt; echo ONE' } }])}`, environment: 'cloud' } }]),
      ['--no-session'],
      180_000,
    );
    const [started] = toolEnds(first.events, 'Task');
    const agentId = AGENT_ID.exec(started?.text ?? '')?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    expect(started?.isError, started?.text).toBe(false);
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${agentId}`), { timeout: 20_000 }).toBe('exited');
    const second = await runJson(
      sandbox,
      script([{ tool: 'Task', args: { description: 'again', resume: agentId, prompt: `go\n@@script ${JSON.stringify([{ tool: 'bash', args: { command: 'cat /tmp/state.txt; hostname' } }])}` } }]),
      ['--no-session'],
      180_000,
    );
    const [resumed] = toolEnds(second.events, 'Task');
    expect(resumed?.isError, resumed?.text).toBe(false);
    expect(resumed?.text).toContain(`RESULTS:\n[bash] KEPT\npstack-${agentId.slice(0, 8)}`);
    const runs = join(sandbox.agentDir, 'pstack/workspaces', `--${sandbox.workDir.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`, 'machines', agentId, 'runs');
    expect(existsSync(runs) ? readdirSync(runs).toSorted() : []).toEqual(['1', '2']);
  });

  test("the agent's file tools act on the machine: only the clone and the workspace's shared Project folders reach the host (G1, G2)", async () => {
    const { pushed } = await pushedRepo();
    const hostTmp = join(sandbox.root, 'probe-dir');
    const projectNotes = join(sandbox.agentDir, 'pstack/workspaces', `--${sandbox.workDir.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`, 'projects/demo/notes.md');
    const steps = [
      { tool: 'write', args: { path: projectNotes, content: 'SHARED-CONTEXT' } },
      { tool: 'write', args: { path: '/tmp/machine-only/note.txt', content: 'IN-MACHINE' } },
      { tool: 'read', args: { path: '/tmp/machine-only/note.txt' } },
      { tool: 'edit', args: { path: 'a.txt', edits: [{ oldText: 'PUSHED', newText: 'EDITED' }] } },
      { tool: 'read', args: { path: 'a.txt' } },
      { tool: 'ls', args: { path: '/tmp/machine-only' } },
      { tool: 'grep', args: { pattern: 'IN-MACHINE', path: '/tmp/machine-only' } },
      { tool: 'find', args: { pattern: '*.txt', path: '/tmp/machine-only' } },
      { tool: 'write', args: { path: join(hostTmp, 'x.txt'), content: 'NOT-ON-HOST' } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'tools probe', prompt: `go\n@@script ${JSON.stringify(steps)}`, environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = AGENT_ID.exec(result?.text ?? '')?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    expect(result?.isError, result?.text).toBe(false);
    const text = result?.text ?? '';
    expect(text).toContain('[read] IN-MACHINE');
    expect(text).toContain('[read] EDITED');
    expect(text).toContain('[ls] note.txt');
    expect(text).toMatch(/\[grep\] \/tmp\/machine-only\/note.txt:1:IN-MACHINE/);
    expect(text).toContain('[find] /tmp/machine-only/note.txt');
    expect(existsSync('/tmp/machine-only/note.txt')).toBe(false);
    expect(existsSync(join(hostTmp, 'x.txt'))).toBe(false);
    expect(readFileSync(projectNotes, 'utf8')).toBe('SHARED-CONTEXT');
    const machine = (result?.details as { machine: { path: string } } | undefined)?.machine;
    if (machine === undefined) throw new Error('the Task result names no machine');
    expect(readFileSync(join(machine.path, 'a.txt'), 'utf8')).toBe('EDITED');
    expect(git(machine.path, 'rev-parse', 'HEAD')).toBe(pushed);
  });

  test('a background cloud agent keeps running after its chat closes, and the reopened chat gets its result (G1, G13)', async () => {
    await pushedRepo();
    const first = startRpc(sandbox);
    first.send({
      type: 'prompt',
      message: script([{ tool: 'Task', args: { description: 'slow cloud', prompt: `go\n@@script ${JSON.stringify([{ tool: 'bash', args: { command: 'sleep 6; echo SURVIVED' } }])}`, environment: 'cloud', run_in_background: true } }]),
    });
    const launched = await first.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task', 120_000);
    const launchText = (launched['result'] as { content: { text: string }[] }).content[0]?.text ?? '';
    const agentId = AGENT_ID.exec(launchText)?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    await first.waitFor((event) => event.type === 'agent_settled', 60_000);
    first.send({ id: 'state', type: 'get_state' });
    const state = await first.waitFor((event) => event.type === 'response' && event['id'] === 'state');
    const sessionFile = (state['data'] as { sessionFile: string }).sessionFile;
    await first.close();
    expect(docker('inspect', '--format', '{{.State.Status}}', `pstack-${agentId}`)).toBe('running');
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${agentId}`), { timeout: 60_000, interval: 500 }).toBe('exited');
    const second = startRpc(sandbox, ['--session', sessionFile]);
    const notice = await second.waitFor((event) => event.type === 'message_end' && JSON.stringify(event['message'] ?? {}).includes(`task_id: ${agentId}`), 60_000);
    expect(JSON.stringify(notice['message'])).toContain('status: success');
    expect(JSON.stringify(notice['message'])).toContain('SURVIVED');
    await second.waitFor((event) => event.type === 'agent_settled', 60_000);
    await second.close();
    const third = startRpc(sandbox, ['--session', sessionFile]);
    third.send({ id: 'state2', type: 'get_state' });
    await third.waitFor((event) => event.type === 'response' && event['id'] === 'state2');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(third.events.filter((event) => event.type === 'message_end' && JSON.stringify(event['message'] ?? {}).includes(`task_id: ${agentId}`))).toEqual([]);
    await third.close();
  });

  test("a cloud agent's own subagent runs on the same machine and never receives the Slack token (G1, G3)", async () => {
    await pushedRepo();
    sandbox.env['SLACK_BOT_TOKEN'] = 'xoxb-parent-only';
    const nested = `go\n@@script ${JSON.stringify([{ tool: 'bash', args: { command: 'hostname; printenv SLACK_BOT_TOKEN || echo token=none' } }])}`;
    const steps = [{ tool: 'Task', args: { description: 'nested', prompt: nested } }];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'parent', prompt: `go\n@@script ${JSON.stringify(steps)}`, environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = (result?.details as { agentId?: string } | undefined)?.agentId ?? '';
    containers.push(`pstack-${agentId}`);
    expect(result?.isError, result?.text).toBe(false);
    expect(result?.text).toContain(`[bash] pstack-${agentId.slice(0, 8)}`);
    expect(result?.text).toContain('token=none');
  });
});
