// Spec 16.2 "Native package": the real Pi binary loads this package's extension, skills, and prompts, and exposes
// exactly the native surface: the skills and their /name prompts, /pstack, and the two pstack tools.
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { skillBlock } from '../../src/skill-block.ts';
import { generatedSkillNames } from '../../src/skill-routing.ts';

const PI = process.env['PSTACK_E2E_PI'] || '/Users/josh-desktop/.pi/agent/bin/pi';
const PKG = resolve(import.meta.dirname, '../..');
const SCRIPTED_MODEL = join(PKG, 'test/fixtures/scripted-model.ts');
const SKILLS = generatedSkillNames();
const OLD_TOOLS = ['Task', 'TodoWrite', 'AskQuestion', 'SwitchMode', 'CreatePlan', 'plan_bash', 'Loop', 'agent_status', 'stop_agent', 'bash_background', 'AwaitShell', 'subscribe_timer', 'visualize'];

type Event = { type: string } & Record<string, unknown>;

interface Rpc {
  events: Event[];
  request: (command: Record<string, unknown>) => Promise<Event>;
  waitFor: (predicate: (event: Event) => boolean, timeoutMs?: number) => Promise<Event>;
  close: () => Promise<void>;
}

const sandboxes: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((done) => child.once('close', done));
    }
  }
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}, 30_000);

function sandbox(options: { env?: Record<string, string> }): { root: string; work: string; env: Record<string, string> } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-load-')));
  sandboxes.push(root);
  const agentDir = join(root, 'agent');
  const work = join(root, 'work');
  mkdirSync(agentDir);
  mkdirSync(work);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ quietStartup: true }));
  execFileSync('git', ['init', '-q'], { cwd: work });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', ...options.env };
  for (const name of ['PI_CODING_AGENT_SESSION_DIR', 'PSTACK_WORKER', 'PSTACK_SPAWN', 'PSTACK_DEPTH', 'PSTACK_READONLY'].filter((key) => options.env?.[key] === undefined)) delete env[name];
  return { root, work, env };
}

/** `pi -p <message>` with the package loaded and the scripted model: stdout is the assistant's final text. */
function printPi(message: string, extra: string[] = []): string {
  const { work, env } = sandbox({});
  const args = ['-p', '--offline', '--no-extensions', '--extension', join(PKG, 'src/extension.ts'), '--extension', SCRIPTED_MODEL, '--skill', join(PKG, 'generated/skills'), ...extra, '--prompt-template', join(PKG, 'generated/prompts'), '--model', 'scripted/echo', message];
  const result = spawnSync(PI, args, { cwd: work, env, encoding: 'utf8', timeout: 45_000 });
  if (result.status !== 0) throw new Error(`pi -p exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function startPi(options: { env?: Record<string, string>; extensions?: string[]; install?: boolean } = {}): Rpc {
  const { root, work, env } = sandbox(options);
  let args: string[];
  if (options.install === true) {
    // `pi install ./pi-pstack` (spec 18) from a copy with no node_modules: a local install gets no dependency install.
    const copy = join(root, 'pi-pstack');
    cpSync(PKG, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PKG.length)) });
    execFileSync(PI, ['install', copy], { cwd: work, env, stdio: 'ignore' });
    args = ['--mode', 'rpc', '--offline', '--extension', SCRIPTED_MODEL, '--model', 'scripted/echo'];
  } else {
    args = ['--mode', 'rpc', '--offline', '--no-extensions', '--extension', join(PKG, 'src/extension.ts'), '--extension', SCRIPTED_MODEL, ...(options.extensions ?? []).flatMap((path) => ['--extension', path])];
    args.push('--skill', join(PKG, 'generated/skills'), '--prompt-template', join(PKG, 'generated/prompts'), '--model', 'scripted/echo');
  }
  const child = spawn(PI, args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const events: Event[] = [];
  const waiters: { predicate: (event: Event) => boolean; done: (event: Event) => void }[] = [];
  let stderr = '';
  let buffer = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '') continue;
      const event = JSON.parse(line) as Event;
      events.push(event);
      for (const waiter of waiters.filter((candidate) => candidate.predicate(event))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.done(event);
      }
    }
  });
  const waitFor = (predicate: (event: Event) => boolean, timeoutMs = 30_000) =>
    new Promise<Event>((done, fail) => {
      const seen = events.find(predicate);
      if (seen !== undefined) return done(seen);
      const timer = setTimeout(() => fail(new Error(`timed out waiting for an RPC event; stderr:\n${stderr}`)), timeoutMs);
      waiters.push({
        predicate,
        done: (event) => {
          clearTimeout(timer);
          done(event);
        },
      });
    });
  let next = 0;
  const request = (command: Record<string, unknown>) => {
    next += 1;
    const id = `req-${next}`;
    child.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
    return waitFor((event) => event.type === 'response' && event['id'] === id);
  };
  const close = () =>
    new Promise<void>((done) => {
      if (child.exitCode !== null) return done();
      child.once('close', () => done());
      child.stdin?.end();
    });
  return { events, request, waitFor, close };
}

type Command = { name: string; source: string; sourceInfo: { path: string } };

async function commands(pi: Rpc): Promise<Command[]> {
  const response = await pi.request({ type: 'get_commands' });
  expect(response['success']).toBe(true);
  return (response['data'] as { commands: Command[] }).commands;
}

/** Sends a prompt and returns the assistant text of the run it starts. */
async function ask(pi: Rpc, message: string): Promise<string> {
  const before = pi.events.length;
  expect((await pi.request({ type: 'prompt', message }))['success']).toBe(true);
  await pi.waitFor((event) => event.type === 'agent_settled' && pi.events.indexOf(event) >= before);
  const ends = pi.events.slice(before).filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant');
  const last = ends.at(-1);
  if (last === undefined) throw new Error(`no assistant reply to ${message}`);
  return (last['message'] as { content: { type: string; text?: string }[] }).content.map((part) => part.text ?? '').join('');
}

/** Runs an extension command and returns what it notified. */
async function command(pi: Rpc, message: string): Promise<{ message: string; notifyType?: string }> {
  const before = pi.events.length;
  expect((await pi.request({ type: 'prompt', message }))['success']).toBe(true);
  const notice = await pi.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && pi.events.indexOf(event) >= before);
  return { message: notice['message'] as string, ...(typeof notice['notifyType'] === 'string' ? { notifyType: notice['notifyType'] } : {}) };
}

describe('parent session', () => {
  test('Pi loads all 62 skills with their /name prompts, /pstack, and only the native pstack tools', async () => {
    const pi = startPi();
    const listed = await commands(pi);
    const skills = listed.filter((entry) => entry.source === 'skill').map((entry) => entry.name);
    const prompts = listed.filter((entry) => entry.source === 'prompt').map((entry) => entry.name);
    const extensionCommands = listed.filter((entry) => entry.source === 'extension').map((entry) => entry.name);
    console.log(`get_commands extension: ${extensionCommands.join(', ')}\nget_commands skills (${skills.length}): ${skills.join(', ')}\nget_commands prompts (${prompts.length}): ${prompts.join(', ')}`);
    expect(SKILLS).toHaveLength(62);
    expect(skills.sort()).toEqual(SKILLS.map((name) => `skill:${name}`));
    expect(prompts.sort()).toEqual(SKILLS);
    for (const entry of listed.filter((item) => item.source !== 'extension')) expect(entry.sourceInfo.path.startsWith(join(PKG, 'generated'))).toBe(true);
    expect(extensionCommands.sort()).toEqual(['pstack', 'test-reload', 'test-tree']);

    const tools = (await ask(pi, '@@tools-list')).split(',');
    console.log(`model-facing tools: ${tools.join(', ')}`);
    expect(tools).toEqual(expect.arrayContaining(['pstack_worker', 'pstack_evidence']));
    expect(tools.filter((name) => OLD_TOOLS.includes(name))).toEqual([]);

    const status = await command(pi, '/pstack status');
    expect(status.message).toMatch(new RegExp(`^pstack style: off \\(poteto-mode from ${join(PKG, 'generated/skills/poteto-mode/SKILL.md')}\\)\\.\\nRuns in .+/work: 0, 0 owned by this session\\.`));
    const doctor = await command(pi, '/pstack doctor');
    console.log(doctor.message);
    expect(doctor.notifyType ?? 'info').toBe('info');
    expect(doctor.message).toMatch(/^tmux: tmux \S+$/m);
    expect(doctor.message).toMatch(/^pi: 1\.5\.\d+$/m);
    expect(doctor.message).toMatch(/^container engine: \S/m);
    expect(doctor.message).toContain('models.json: missing at ');
    expect(doctor.message).toMatch(/^role resolution: \d+ of 17 roles resolve as configured$/m);
    expect(doctor.message).toContain('MCP servers: none');
    expect(doctor.message).toContain(`generated skills: 62 (62 loaded from ${join(PKG, 'generated/skills')})`);
    expect(doctor.message).toContain('upstream lock: a5539b15a3d56e04992565aafee2b37051329ce3');
    expect(doctor.message).toMatch(/^hard links: supported at /m);
    expect(doctor.message).toContain('slash names: no conflicts; every skill has its /name');
    await pi.close();
  });

  test('/name expands the skill prompt with its arguments, and /pstack on puts poteto-mode in context once', async () => {
    const pi = startPi();
    const how = await ask(pi, '/how trace the "cache layer"');
    expect(how).toContain('Use the pstack `how` skill for this request.');
    expect(how).toContain('generated/skills/how/SKILL.md');
    expect(how).toContain('Request: trace the cache layer');

    expect((await command(pi, '/pstack on')).message).toMatch(/^pstack style on\./);
    await ask(pi, '@@say first task');
    await ask(pi, '@@say second task');
    const messages = ((await pi.request({ type: 'get_messages' }))['data'] as { messages: { role: string; customType?: string; content: unknown }[] }).messages;
    const style = messages.filter((message) => message.customType === 'pstack-style');
    expect(style).toHaveLength(1);
    expect(String(style[0]?.content)).toMatch(/^<skill name="poteto-mode" location=".+generated\/skills\/poteto-mode\/SKILL\.md">/);
    await pi.close();
  });

  test('a skill named mid-message attaches as Pi expands /skill:<name>, once, in RPC mode', async () => {
    const pi = startPi();
    const block = (name: string) => skillBlock(name, join(PKG, 'generated/skills', name, 'SKILL.md')) ?? '';
    const message = 'run /how on this, then /why and /how again';
    const attached = await ask(pi, message);
    expect(attached).toBe(`ECHO: ${block('how')}\n\n${block('why')}\n\n${message}`);
    expect(await ask(pi, `/skill:how ${block('why')}\n\n${message}`)).toBe(attached);
    const count = (reply: string, name: string) => reply.split(`<skill name="${name}" location=`).length - 1;
    expect([count(attached, 'how'), count(attached, 'why')]).toEqual([1, 1]);

    const led = await ask(pi, '/how look at /why');
    expect(led).toBe(`ECHO: ${block('how')}\n\n${block('why')}\n\nlook at /why`);
    for (const untouched of ['read /usr/bin/env and /how/x', 'type `/how` or\n```\n/why\n```', '/model then /how']) {
      expect(await ask(pi, untouched)).toBe(`ECHO: ${untouched}`);
    }
    expect(await ask(pi, '/how only')).toContain('Use the pstack `how` skill for this request.');
    await pi.close();
  });

  test('a name another extension owns is reported by doctor and reachable as /pstack:<name>', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-conflict-')));
    sandboxes.push(root);
    const owner = join(root, 'owns-how.ts');
    writeFileSync(owner, "export default function (pi) { pi.registerCommand('how', { description: 'not pstack', handler: async (_args, ctx) => ctx.ui.notify('other how', 'info') }); }\n");
    const pi = startPi({ extensions: [owner] });
    const doctor = await command(pi, '/pstack doctor');
    expect(doctor.message).toContain(`slash names: 1 conflict(s), use /pstack:<name>\n  /how is extension command /how (${owner}); use /pstack:how`);
    expect((await command(pi, '/how anything')).message).toBe('other how');
    const aliased = await ask(pi, '/pstack:how trace the cache');
    expect(aliased).toMatch(/^ECHO: <skill name="how" location=".+generated\/skills\/how\/SKILL\.md">/);
    expect(aliased).toContain('trace the cache');
    await pi.close();
  });
});

test('a skill named mid-message attaches the same way in print mode, and a leading prompt template still expands', () => {
  const block = (name: string) => skillBlock(name, join(PKG, 'generated/skills', name, 'SKILL.md')) ?? '';
  expect(printPi('run /how on this').trim()).toBe(`ECHO: ${block('how')}\n\nrun /how on this`);
  expect(printPi('please /deslop it and /why').trim()).toBe(`ECHO: ${block('deslop')}\n\n${block('why')}\n\nplease /deslop it and /why`);
  expect(printPi('/how plain').trim()).toContain('Request: plain');
  expect(printPi('see /usr/bin/env and `/how`').trim()).toBe('ECHO: see /usr/bin/env and `/how`');
}, 120_000);

test('a loaded non-pstack skill attaches mid-message only inside a pstack workflow', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-fixture-')));
  sandboxes.push(root);
  const dir = join(root, 'mine');
  mkdirSync(dir);
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, '---\nname: mine\ndescription: fixture skill\n---\nMINE BODY\n');
  const block = (name: string, path: string) => skillBlock(name, path) ?? '';
  const how = block('how', join(PKG, 'generated/skills/how/SKILL.md'));
  const run = (message: string) => printPi(message, ['--skill', dir]).trim();
  expect(run('use /mine and /how')).toBe(`ECHO: ${block('mine', file)}\n\n${how}\n\nuse /mine and /how`);
  expect(run('use /mine now')).toBe('ECHO: use /mine now');
  expect(run('see `/how` and /mine')).toBe('ECHO: see `/how` and /mine');
}, 120_000);

test('pi install of a copy without node_modules loads the manifest: generated skills, prompts, /pstack, and the pstack tools', async () => {
  const pi = startPi({ install: true });
  const listed = await commands(pi);
  const fromCopy = (entry: Command) => entry.sourceInfo.path.includes('/pi-pstack/generated/');
  expect(listed.filter((entry) => entry.source === 'skill' && fromCopy(entry))).toHaveLength(62);
  expect(listed.filter((entry) => entry.source === 'prompt' && fromCopy(entry))).toHaveLength(62);
  expect(listed.filter((entry) => entry.source === 'extension' && entry.sourceInfo.path.endsWith('/pi-pstack/src/extension.ts')).map((entry) => entry.name)).toEqual(['pstack']);
  const tools = (await ask(pi, '@@tools-list')).split(',');
  expect(tools).toEqual(expect.arrayContaining(['pstack_worker', 'pstack_evidence']));
  expect(tools.filter((name) => OLD_TOOLS.includes(name))).toEqual([]);
  await pi.close();
}, 60_000);

describe('worker session', () => {
  test('PSTACK_WORKER=1 gives the model pstack_evidence only, and no /pstack', async () => {
    const pi = startPi({ env: { PSTACK_WORKER: '1' } });
    const extensionCommands = (await commands(pi)).filter((entry) => entry.source === 'extension').map((entry) => entry.name);
    expect(extensionCommands.sort()).toEqual(['test-reload', 'test-tree']);
    const tools = (await ask(pi, '@@tools-list')).split(',');
    console.log(`worker model-facing tools: ${tools.join(', ')}`);
    expect(tools.filter((name) => name.startsWith('pstack_'))).toEqual(['pstack_evidence']);
    expect(tools.filter((name) => OLD_TOOLS.includes(name))).toEqual([]);
    // bash_readonly for PSTACK_READONLY=1 arrives with U04a6, which has not landed on this branch.
    await pi.close();
  });
});
