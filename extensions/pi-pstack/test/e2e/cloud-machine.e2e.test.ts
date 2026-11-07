import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SKILLS_DIR, workspaceSlug } from '../../src/paths.ts';
import { makeSandbox, type PiEvent, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

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
    await vi.waitFor(() => execFileSync('git', ['ls-remote', url], { stdio: 'ignore', timeout: 5_000 }), { timeout: 10_000, interval: 100 });
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

  test('cloud reads can follow the advertised skill and playbook paths', async () => {
    await pushedRepo();
    const steps = [
      { tool: 'read', args: { path: join(SKILLS_DIR, 'poteto-mode/SKILL.md'), limit: 4 } },
      { tool: 'read', args: { path: join(SKILLS_DIR, 'poteto-mode/playbooks/feature.md'), limit: 3 } },
      { tool: 'read', args: { path: join(SKILLS_DIR, 'poteto-mode/scripts/check-plan.mjs'), limit: 2 } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'resource probe', prompt: script(steps), environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = AGENT_ID.exec(result?.text ?? '')?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    expect(result?.isError, result?.text).toBe(false);
    expect(result?.text).toContain('name: poteto-mode');
    expect(result?.text).toContain('# Feature');
    expect(result?.text).toContain('#!/usr/bin/env node');
    expect(result?.text).not.toContain('ENOENT');
  });

  test('a fresh readonly cloud task can read but cannot write container-local persistent files', async () => {
    await pushedRepo();
    const command = 'cat a.txt; if printf CHANGED > /tmp/pstack-readonly-probe.txt; then printf "\\nWRITE-SUCCEEDED"; else printf "\\nWRITE-DENIED"; fi';
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'fresh readonly probe', readonly: true, environment: 'cloud', prompt: script([{ tool: 'bash', args: { command } }]) } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = AGENT_ID.exec(result?.text ?? '')?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    expect(result?.isError, result?.text).toBe(false);
    expect(result?.text).toContain('[bash] PUSHED');
    expect(result?.text).toContain('WRITE-DENIED');
  });

  test.for(['resume', 'fork'] as const)('a readonly %s cannot reuse writable cloud mounts', async (operation) => {
    await pushedRepo();
    const first = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'writable source', prompt: 'go\n@@say READY', environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [started] = toolEnds(first.events, 'Task');
    const agentId = AGENT_ID.exec(started?.text ?? '')?.[1] ?? '';
    containers.push(`pstack-${agentId}`);
    expect(started?.isError, started?.text).toBe(false);
    const machine = (started?.details as { machine?: { path: string } } | undefined)?.machine;
    if (machine === undefined) throw new Error('the Task result names no machine');
    const clone = machine.path;
    const shared = join(sandbox.agentDir, 'pstack/workspaces', workspaceSlug(sandbox.workDir), 'projects/readonly-bypass');
    const second = await runJson(
      sandbox,
      script([
        { tool: 'Task', args: { description: 'restricted continuation', [operation]: agentId, readonly: true, prompt: script([{ tool: 'bash', args: { command: `printf BYPASS > a.txt; printf BYPASS > '${shared}'; printf FINISHED` } }]) } },
      ]),
      ['--no-session'],
      180_000,
    );
    const [continued] = toolEnds(second.events, 'Task');
    const nextId = AGENT_ID.exec(continued?.text ?? '')?.[1];
    if (nextId !== undefined && nextId !== agentId) containers.push(`pstack-${nextId}`);
    expect(readFileSync(join(clone, 'a.txt'), 'utf8')).toBe('PUSHED');
    expect(existsSync(shared)).toBe(false);
    if (continued?.isError === true) expect(continued.text).toMatch(/read.?only|writable/i);
    else expect(continued?.text).toMatch(/denied|read.only file system/i);
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
    // What the agent writes on the machine stays the user's to edit and delete on the host.
    expect([statSync(projectNotes).uid, statSync(join(machine.path, 'a.txt')).uid]).toEqual([process.getuid?.(), process.getuid?.()]);
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
    // A redelivery would arrive at session start, ahead of this prompt's turn.
    third.send({ type: 'prompt', message: 'go\n@@say NOTHING-PENDING' });
    await third.waitFor((event) => event.type === 'agent_settled', 60_000);
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

  const nestedIdsOf = (text: string, agentId: string) => [...new Set([...text.matchAll(/Agent ID: ([0-9a-f-]{36})/g)].map((match) => match[1] ?? ''))].filter((id) => id !== agentId);

  test('a cloud agent resumes and forks the subagent it started, on its own machine, and a readonly resume writes nowhere', async () => {
    await pushedRepo();
    const probe = 'if (printf BYPASS > a.txt) 2>/dev/null; then echo WROTE; else echo DENIED; fi';
    const steps = [
      { tool: 'Task', args: { description: 'nested', prompt: script([{ tool: 'bash', args: { command: 'echo KEPT > /tmp/nested-state.txt; echo STARTED' } }]) } },
      { tool: 'Task', args: { description: 'resumed', resume: '@@agent-id', prompt: script([{ tool: 'bash', args: { command: 'cat /tmp/nested-state.txt; hostname' } }]) } },
      { tool: 'Task', args: { description: 'forked', fork: '@@agent-id', prompt: script([{ tool: 'bash', args: { command: 'cat /tmp/nested-state.txt; hostname' } }]) } },
      { tool: 'Task', args: { description: 'readonly resume', resume: '@@agent-id', readonly: true, prompt: script([{ tool: 'bash', args: { command: probe } }]) } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'writable parent', prompt: script(steps), environment: 'cloud' } }]), ['--no-session'], 240_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = (result?.details as { agentId?: string } | undefined)?.agentId ?? '';
    const text = result?.text ?? '';
    const nestedIds = nestedIdsOf(text, agentId);
    containers.push(`pstack-${agentId}`, ...nestedIds.map((id) => `pstack-${id}`));
    expect(result?.isError, text).toBe(false);
    expect(text).not.toContain('[Task error]');
    expect(text.split(`[bash] KEPT\npstack-${agentId.slice(0, 8)}`)).toHaveLength(3);
    expect(text).toContain('[bash] DENIED');
    expect(nestedIds).toHaveLength(2);
    const machine = (result?.details as { machine?: { path: string } } | undefined)?.machine;
    if (machine === undefined) throw new Error('the Task result names no machine');
    expect(readFileSync(join(machine.path, 'a.txt'), 'utf8')).toBe('PUSHED');
  });

  /** A cloud agent whose subagent left /tmp/nested-state.txt on the machine, once the machine has stopped. */
  async function stoppedOwnerWithSubagent(): Promise<{ ownerId: string; nestedId: string; clone: string }> {
    await pushedRepo();
    const nested = { tool: 'Task', args: { description: 'nested', prompt: script([{ tool: 'bash', args: { command: 'echo KEPT > /tmp/nested-state.txt; echo STARTED' } }]) } };
    const first = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'owner', prompt: script([nested]), environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [owner] = toolEnds(first.events, 'Task');
    const { agentId: ownerId = '', machine } = (owner?.details ?? {}) as { agentId?: string; machine?: { path: string } };
    const [nestedId = ''] = nestedIdsOf(owner?.text ?? '', ownerId);
    containers.push(`pstack-${ownerId}`);
    expect(owner?.isError, owner?.text).toBe(false);
    if (machine === undefined) throw new Error('the Task result names no machine');
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${ownerId}`), { timeout: 20_000 }).toBe('exited');
    return { ownerId, nestedId, clone: machine.path };
  }

  const continueFromMainChat = async (args: Record<string, unknown>, command: string) => {
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'continue', ...args, prompt: script([{ tool: 'bash', args: { command } }]) } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    const nextId = (result?.details as { agentId?: string } | undefined)?.agentId;
    if (nextId !== undefined) containers.push(`pstack-${nextId}`);
    return result;
  };

  test.for(['resume', 'fork'] as const)("the main chat's %s of a cloud agent's subagent boots the stopped machine, runs there, and stops it again", async (operation) => {
    const { ownerId, nestedId } = await stoppedOwnerWithSubagent();
    const continued = await continueFromMainChat({ [operation]: nestedId }, 'cat /tmp/nested-state.txt; hostname');
    expect(continued?.isError, continued?.text).toBe(false);
    expect(continued?.text).toContain(`RESULTS:\n[bash] KEPT\npstack-${ownerId.slice(0, 8)}`);
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${ownerId}`), { timeout: 20_000 }).toBe('exited');
  });

  test('a run that ends first leaves the machine running for another run on it, and the last run to end stops it', async () => {
    await pushedRepo();
    const first = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'owner', prompt: 'go\n@@say READY', environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [owner] = toolEnds(first.events, 'Task');
    const ownerId = (owner?.details as { agentId?: string } | undefined)?.agentId ?? '';
    containers.push(`pstack-${ownerId}`);
    expect(owner?.isError, owner?.text).toBe(false);
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${ownerId}`), { timeout: 20_000 }).toBe('exited');

    const chat = startRpc(sandbox, ['--no-session']);
    try {
      const long = script([
        { tool: 'bash', args: { command: 'sleep 15; echo LONG-FIRST', timeout: 60 } },
        { tool: 'bash', args: { command: 'hostname' } },
      ]);
      chat.send({
        type: 'prompt',
        message: script([
          { tool: 'Task', args: { description: 'long fork', fork: ownerId, run_in_background: true, prompt: long } },
          { tool: 'Task', args: { description: 'short resume', resume: ownerId, prompt: script([{ tool: 'bash', args: { command: 'echo SHORT' } }]) } },
        ]),
      });
      const forked = await chat.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task', 120_000);
      const forkId = AGENT_ID.exec((forked['result'] as { content: { text: string }[] }).content[0]?.text ?? '')?.[1] ?? '';
      const resumed = await chat.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task' && event !== forked, 120_000);
      expect(JSON.stringify(resumed['result'])).toContain('[bash] SHORT');
      const notice = await chat.waitFor((event) => event.type === 'message_end' && JSON.stringify(event['message'] ?? {}).includes(`task_id: ${forkId}`), 120_000);
      expect(JSON.stringify(notice['message'])).toContain(`[bash] LONG-FIRST\\n\\n[bash] pstack-${ownerId.slice(0, 8)}`);
      await expect.poll(() => docker('inspect', '--format', '{{.State.Status}}', `pstack-${ownerId}`), { timeout: 20_000 }).toBe('exited');
    } finally {
      await chat.close();
    }
  }, 300_000);

  test("the main chat's readonly resume of a cloud agent's subagent runs on a read-only sibling of its machine", async () => {
    const { ownerId, nestedId, clone } = await stoppedOwnerWithSubagent();
    const continued = await continueFromMainChat({ resume: nestedId, readonly: true }, 'cat a.txt; echo; grep -q bookworm /etc/os-release && echo DEBIAN; if (printf BYPASS > a.txt) 2>/dev/null; then echo WROTE; else echo DENIED; fi');
    expect(continued?.isError, continued?.text).toBe(false);
    expect(continued?.text).toContain('RESULTS:\n[bash] PUSHED\nDEBIAN\nDENIED');
    expect(readFileSync(join(clone, 'a.txt'), 'utf8')).toBe('PUSHED');
    expect(docker('ps', '--all', '--quiet', '--filter', `name=^pstack-${nestedId}$`)).toBe('');
    expect(docker('inspect', '--format', '{{.State.Status}}', `pstack-${ownerId}`)).toBe('exited');
  });

  test("the main chat's resume of a cloud agent's subagent fails when the machine is gone, without running on the host", async () => {
    const { ownerId, nestedId } = await stoppedOwnerWithSubagent();
    docker('rm', '--force', `pstack-${ownerId}`);
    const continued = await continueFromMainChat({ resume: nestedId }, 'hostname');
    expect(continued?.isError).toBe(true);
    expect(continued?.text).toContain(`The cloud machine pstack-${ownerId} no longer exists.`);
  });

  test("a cloud agent cannot resume or fork another cloud agent's subagent", async () => {
    await pushedRepo();
    const first = await runJson(
      sandbox,
      script([{ tool: 'Task', args: { description: 'owner', prompt: script([{ tool: 'Task', args: { description: 'nested', prompt: 'go\n@@say OWNED' } }]), environment: 'cloud' } }]),
      ['--no-session'],
      180_000,
    );
    const [owner] = toolEnds(first.events, 'Task');
    const { agentId: ownerId = '', machine } = (owner?.details ?? {}) as { agentId?: string; machine?: { path: string } };
    const [nestedId = ''] = nestedIdsOf(owner?.text ?? '', ownerId);
    containers.push(`pstack-${ownerId}`);
    expect(owner?.isError, owner?.text).toBe(false);
    if (machine === undefined) throw new Error('the Task result names no machine');
    const steps = [
      { tool: 'Task', args: { description: 'steal', resume: nestedId, prompt: 'again\n@@say STOLEN' } },
      { tool: 'Task', args: { description: 'copy', fork: nestedId, prompt: 'copy\n@@say STOLEN' } },
    ];
    const second = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'other', prompt: script(steps), environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [other] = toolEnds(second.events, 'Task');
    containers.push(`pstack-${(other?.details as { agentId?: string } | undefined)?.agentId ?? ''}`);
    expect(other?.isError, other?.text).toBe(false);
    const refusal = `Agent ${nestedId} belongs to ${machine.path}, not this workspace. Start a new agent instead.`;
    expect(other?.text).toContain(`[Task error] ${refusal}\n[Task error] ${refusal}`);
  });

  test("a writable cloud agent's readonly subagent reads the clone and the package but writes nowhere", async () => {
    await pushedRepo();
    const shared = join(sandbox.agentDir, 'pstack/workspaces', workspaceSlug(sandbox.workDir), 'projects/nested-readonly.txt');
    const probe = `cat a.txt; echo; for t in a.txt /tmp/nested-probe.txt '${shared}'; do if printf BYPASS > "$t" 2>/dev/null; then echo "WROTE $t"; else echo "DENIED $t"; fi; done`;
    const nested = script([
      { tool: 'read', args: { path: join(SKILLS_DIR, 'poteto-mode/SKILL.md'), limit: 2 } },
      { tool: 'bash', args: { command: probe } },
    ]);
    const steps = [
      { tool: 'Task', args: { description: 'nested readonly', readonly: true, prompt: nested } },
      { tool: 'bash', args: { command: 'cat a.txt; echo; test -e /tmp/nested-probe.txt && echo PARENT-TMP-WRITTEN || echo PARENT-TMP-CLEAN' } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'writable parent', prompt: script(steps), environment: 'cloud' } }]), ['--no-session'], 240_000);
    const [result] = toolEnds(run.events, 'Task');
    const agentId = (result?.details as { agentId?: string } | undefined)?.agentId ?? '';
    const nestedIds = [...(result?.text ?? '').matchAll(/Agent ID: ([0-9a-f-]{36})/g)].map((match) => match[1] ?? '').filter((id) => id !== agentId);
    containers.push(`pstack-${agentId}`, ...nestedIds.map((id) => `pstack-${id}`));
    expect(result?.isError, result?.text).toBe(false);
    const text = result?.text ?? '';
    expect(text).toContain('name: poteto-mode');
    expect(text).toContain('[bash] PUSHED');
    expect(text).toContain('DENIED a.txt');
    expect(text).toContain('DENIED /tmp/nested-probe.txt');
    expect(text).toContain(`DENIED ${shared}`);
    expect(text).not.toContain('WROTE');
    expect(text).toContain('PARENT-TMP-CLEAN');
    const machine = (result?.details as { machine?: { path: string } } | undefined)?.machine;
    if (machine === undefined) throw new Error('the Task result names no machine');
    expect(readFileSync(join(machine.path, 'a.txt'), 'utf8')).toBe('PUSHED');
    expect(existsSync(shared)).toBe(false);
    expect(nestedIds).toHaveLength(1);
    expect(docker('ps', '--all', '--quiet', '--filter', `name=^pstack-${nestedIds[0]}$`)).toBe('');
  });

  test("a readonly sibling whose owning run was killed is removed when the next chat starts, and a live run's sibling stays", async () => {
    await pushedRepo();
    const records = join(sandbox.agentDir, 'pstack/workspaces', workspaceSlug(sandbox.workDir), 'subagents');
    const pids: number[] = [];
    const known = new Set<string>();
    const recordIds = () =>
      existsSync(records)
        ? readdirSync(records)
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -'.json'.length))
        : [];
    const lockPid = (agentId: string) => Number.parseInt(readFileSync(join(records, `${agentId}.lock`), 'utf8'), 10);
    const runPid = (agentId: string) => (JSON.parse(readFileSync(join(records, `${agentId}.json`), 'utf8')) as { run: { pid: number } }).run.pid;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const state = (container: string) => docker('ps', '--all', '--filter', `name=^${container}$`, '--format', '{{.State}}');
    /** Starts a writable cloud agent whose readonly subagent sleeps on its sibling, and waits until the sibling runs. */
    async function cloudAgentWithSleepingReader(): Promise<{ agentId: string; nestedId: string }> {
      const nested = { tool: 'Task', args: { description: 'sleeping reader', readonly: true, prompt: script([{ tool: 'bash', args: { command: 'sleep 600', timeout: 600 } }]) } };
      const launcher = startRpc(sandbox, ['--no-session']);
      let launched: PiEvent;
      try {
        launcher.send({ type: 'prompt', message: script([{ tool: 'Task', args: { description: 'writable owner', prompt: script([nested]), environment: 'cloud', run_in_background: true } }]) });
        launched = await launcher.waitFor((event) => event.type === 'tool_execution_end' && event['toolName'] === 'Task', 120_000);
        await launcher.waitFor((event) => event.type === 'agent_settled', 60_000);
      } finally {
        await launcher.close();
      }
      const agentId = AGENT_ID.exec((launched['result'] as { content: { text: string }[] }).content[0]?.text ?? '')?.[1] ?? '';
      containers.push(`pstack-${agentId}`);
      known.add(agentId);
      const nestedId = await vi.waitUntil(() => recordIds().find((id) => !known.has(id)), { timeout: 180_000, interval: 250 });
      known.add(nestedId);
      containers.push(`pstack-${nestedId}`);
      pids.push(runPid(agentId), lockPid(nestedId));
      await expect.poll(() => state(`pstack-${nestedId}`), { timeout: 30_000 }).toBe('running');
      return { agentId, nestedId };
    }

    let chat: ReturnType<typeof startRpc> | undefined;
    try {
      const killed = await cloudAgentWithSleepingReader();
      const live = await cloudAgentWithSleepingReader();
      const orphanedReader = lockPid(killed.nestedId);
      process.kill(Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(orphanedReader)], { encoding: 'utf8' })), 'SIGKILL');
      await expect.poll(() => alive(orphanedReader), { timeout: 30_000 }).toBe(false);
      expect(state(`pstack-${killed.nestedId}`)).toBe('running');

      chat = startRpc(sandbox, ['--no-session']);
      await expect.poll(() => state(`pstack-${killed.nestedId}`), { timeout: 30_000, interval: 500 }).toBe('');
      expect(state(`pstack-${live.nestedId}`)).toBe('running');
      expect(alive(lockPid(live.nestedId))).toBe(true);
    } finally {
      await chat?.close();
      for (const pid of pids) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {}
      }
    }
  }, 240_000);

  test("the machine's bash keeps the shell's working directory and exported variables between calls, and its background jobs start there", async () => {
    await pushedRepo();
    const steps = [
      { tool: 'bash', args: { command: 'cd /usr && export PSTACK_PROBE=42' } },
      { tool: 'bash', args: { command: 'pwd; echo "probe=$PSTACK_PROBE"' } },
      { tool: 'bash_background', args: { command: 'echo "bg=$(pwd) $PSTACK_PROBE"', block_until_ms: 20_000 } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'cloud shell', prompt: `go\n@@script ${JSON.stringify(steps)}`, environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    containers.push(`pstack-${(result?.details as { agentId?: string } | undefined)?.agentId ?? ''}`);
    expect(result?.isError, result?.text).toBe(false);
    expect(result?.text).toContain('RESULTS:\n[bash] (no output)\n[bash] /usr\nprobe=42\n');
    expect(result?.text).toContain('bg=/usr 42');
  });

  test('a machine bash call whose timeout elapses keeps running on the machine as a background job', async () => {
    await pushedRepo();
    const steps = [
      { tool: 'bash', args: { command: 'echo START; sleep 2; echo LATE', timeout: 1 } },
      { tool: 'AwaitShell', args: { shell_id: '@@shell-id', block_until_ms: 20_000 } },
    ];
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'cloud timeout', prompt: `go\n@@script ${JSON.stringify(steps)}`, environment: 'cloud' } }]), ['--no-session'], 180_000);
    const [result] = toolEnds(run.events, 'Task');
    containers.push(`pstack-${(result?.details as { agentId?: string } | undefined)?.agentId ?? ''}`);
    expect(result?.isError, result?.text).toBe(false);
    expect(result?.text).toMatch(
      /\[bash\] The command did not complete in 1000ms and was sent to the background\.\nShell ID: \d+\nPID: \d+\n[\s\S]*```\nSTART\n\n```\n\[AwaitShell\] Task completed in \d+ms with exit code: 0\.\noutput_file_path: (\S+)\n/,
    );
    const path = /output_file_path: (\S+)/.exec(result?.text ?? '')?.[1] ?? '';
    expect(readFileSync(path, 'utf8')).toMatch(/---\nSTART\nLATE\n\n---\nexit_code: 0\n/);
  });
});
