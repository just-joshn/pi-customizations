import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { contentText, makeSandbox, type PiEvent, type RpcSession, type Sandbox, startRpc } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

async function ask(rpc: RpcSession, message: string): Promise<string> {
  const mark = rpc.events.length;
  rpc.send({ type: 'prompt', message });
  await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
  const reply = rpc.events
    .slice(mark)
    .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
    .at(-1);
  if (reply === undefined) throw new Error('the run produced no assistant message');
  return contentText((reply['message'] as { content: { type: string; text?: string }[] }).content);
}

async function command(rpc: RpcSession, message: string): Promise<PiEvent> {
  const id = `cmd-${rpc.events.length}`;
  rpc.send({ id, type: 'prompt', message });
  return rpc.waitFor((event) => event['id'] === id);
}

const modeSectionOf = (prompt: string) => /<pstack_mode>\n([\s\S]*?)\n<\/pstack_mode>/.exec(prompt)?.[1];
const statuses = (rpc: RpcSession) => rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-mode').map((event) => event['statusText']);

test('/mode keeps the skill on every turn until /mode off, with a status badge (MODE-001, MODE-002, MODE-005)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    const mark = rpc.events.length;
    rpc.send({ type: 'prompt', message: '/mode poteto-mode first task\n@@sys' });
    await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
    const firstUser = rpc.events.find((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user');
    if (firstUser === undefined) throw new Error('no user message');
    expect(contentText((firstUser['message'] as { content: string }).content)).toBe('first task\n@@sys');
    const firstReply = rpc.events.find((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant');
    if (firstReply === undefined) throw new Error('no assistant reply');
    expect(modeSectionOf(contentText((firstReply['message'] as { content: { type: string; text?: string }[] }).content))?.split('\n')[0]).toBe('Mode poteto-mode is on for every turn until the user runs /mode off.');
    expect(statuses(rpc).some((text) => typeof text === 'string' && text.replace(/\x1b\[[0-9;]*m/g, '') === '♛ mode: poteto-mode')).toBe(true);

    const second = modeSectionOf(await ask(rpc, 'second turn\n@@sys'));
    expect(second?.startsWith('Mode poteto-mode is on for every turn until the user runs /mode off.\n<skill name="poteto-mode"')).toBe(true);
    expect(second).not.toContain('New task?');
    expect(second).toContain('# Poteto mode\n\nBundled skills live at `../<name>/SKILL.md` from this file');
    // The absolute path that 0.15.21's poteto-mode tells the parent to hand each poteto-agent (RES-010).
    expect(second).toContain(`<skill name="poteto-mode" location="${join(PACKAGE_ROOT, 'skills/poteto-mode/SKILL.md')}">`);

    await command(rpc, '/mode off');
    expect(modeSectionOf(await ask(rpc, 'third turn\n@@sys'))).toBeUndefined();
    expect(statuses(rpc).at(-1)).toBeUndefined();
  } finally {
    await rpc.close();
  }
});

test('the /mode task goes through normal skill expansion (MODE-001)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    const mark = rpc.events.length;
    rpc.send({ type: 'prompt', message: '/mode tdd /ketchup since lunch\n@@say OK' });
    await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
    const user = rpc.events.find((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user');
    if (user === undefined) throw new Error('no user message');
    const text = contentText((user['message'] as { content: string }).content);
    expect([text.startsWith('<skill name="ketchup"'), text.endsWith('since lunch\n@@say OK')]).toEqual([true, true]);
  } finally {
    await rpc.close();
  }
});

test('/mode rejects an unknown skill and lists the choices (MODE-002)', async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    await command(rpc, '/mode no-such-skill');
    const notice = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify');
    expect(notice['notifyType']).toBe('error');
    expect(String(notice['message'])).toMatch(/^No skill named "no-such-skill"\. Skills that can back a mode: architect, arena, /);
  } finally {
    await rpc.close();
  }
});

test('a mode whose stored skill path went stale is found again by name (recheck 4)', async () => {
  const sessions = join(sandbox.root, 'sessions');
  const first = startRpc(sandbox, ['--session-dir', sessions]);
  let sessionFile = '';
  try {
    await command(first, '/mode tdd');
    first.send({ id: 'state', type: 'get_state' });
    sessionFile = String(((await first.waitFor((event) => event['id'] === 'state'))['data'] as { sessionFile: string }).sessionFile);
    await ask(first, 'persist\n@@say OK');
  } finally {
    await first.close();
  }
  const moved = readFileSync(sessionFile, 'utf8').replaceAll(join(PACKAGE_ROOT, 'skills/tdd/SKILL.md'), '/old/install/skills/tdd/SKILL.md');
  expect(moved).toContain('/old/install/skills/tdd/SKILL.md');
  writeFileSync(sessionFile, moved);
  const second = startRpc(sandbox, ['--session-dir', sessions, '--session', sessionFile]);
  try {
    const section = modeSectionOf(await ask(second, 'after the move\n@@sys'));
    expect(section?.split('\n').slice(0, 2)).toEqual(['Mode tdd is on for every turn until the user runs /mode off.', `<skill name="tdd" location="${join(PACKAGE_ROOT, 'skills/tdd/SKILL.md')}">`]);
  } finally {
    await second.close();
  }
});

test('a stored mode whose skill no longer loads never inlines the stored path (review r2: security 3)', async () => {
  const sessions = join(sandbox.root, 'sessions');
  const secret = join(sandbox.root, 'secret.txt');
  writeFileSync(secret, '---\nname: x\n---\nSECRET-CONTENT\n');
  const first = startRpc(sandbox, ['--session-dir', sessions]);
  let sessionFile = '';
  try {
    await command(first, '/mode tdd');
    first.send({ id: 'state', type: 'get_state' });
    sessionFile = String(((await first.waitFor((event) => event['id'] === 'state'))['data'] as { sessionFile: string }).sessionFile);
    await ask(first, 'persist\n@@say OK');
  } finally {
    await first.close();
  }
  // A crafted or pre-0.15.20 entry that names a path, as an untrusted session file could.
  const crafted = readFileSync(sessionFile, 'utf8').replace(/"data":\{"skill":"tdd"[^}]*\}/, `"data":${JSON.stringify({ skill: 'gone-skill', path: secret })}`);
  expect(crafted).toContain(`"path":${JSON.stringify(secret)}`);
  writeFileSync(sessionFile, crafted);
  const second = startRpc(sandbox, ['--session-dir', sessions, '--session', sessionFile]);
  try {
    const section = modeSectionOf(await ask(second, 'after\n@@sys'));
    expect(section).toBe('Mode gone-skill is on, but no loaded skill has that name. Tell the user to run /mode off or /mode <skill>.');
  } finally {
    await second.close();
  }
});

test('the mode survives a restart of the same session (MODE-003)', async () => {
  const sessions = join(sandbox.root, 'sessions');
  const first = startRpc(sandbox, ['--session-dir', sessions]);
  let sessionFile = '';
  try {
    await command(first, '/mode tdd');
    expect(modeSectionOf(await ask(first, 'check\n@@sys'))?.split('\n')[0]).toBe('Mode tdd is on for every turn until the user runs /mode off.');
    first.send({ id: 'state', type: 'get_state' });
    sessionFile = String(((await first.waitFor((event) => event['id'] === 'state'))['data'] as { sessionFile: string }).sessionFile);
  } finally {
    await first.close();
  }
  const second = startRpc(sandbox, ['--session-dir', sessions, '--session', sessionFile]);
  try {
    expect(modeSectionOf(await ask(second, 'after restart\n@@sys'))?.split('\n')[0]).toBe('Mode tdd is on for every turn until the user runs /mode off.');
  } finally {
    await second.close();
  }
});
