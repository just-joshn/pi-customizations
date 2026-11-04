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
const modeSkillOf = (prompt: string) => /<pstack_mode_skill>\n([\s\S]*?)\n<\/pstack_mode_skill>/.exec(prompt)?.[1];
const statuses = (rpc: RpcSession) => rpc.events.filter((event) => event.type === 'extension_ui_request' && event['method'] === 'setStatus' && event['statusKey'] === 'pstack-mode').map((event) => event['statusText']);

test("/mode keeps the skill in context on every turn until /mode off, with Cursor's notices and a status badge (MODE-001, MODE-002, MODE-005)", async () => {
  const rpc = startRpc(sandbox, ['--no-session']);
  const skillPath = join(PACKAGE_ROOT, 'skills/poteto-mode/SKILL.md');
  try {
    const mark = rpc.events.length;
    rpc.send({ type: 'prompt', message: '/mode poteto-mode first task\n@@sys' });
    await rpc.waitFor((event) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
    const firstUser = rpc.events.find((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user');
    if (firstUser === undefined) throw new Error('no user message');
    expect(contentText((firstUser['message'] as { content: string }).content)).toBe('first task\n@@sys');
    const firstReply = rpc.events.find((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant');
    if (firstReply === undefined) throw new Error('no assistant reply');
    const first = contentText((firstReply['message'] as { content: { type: string; text?: string }[] }).content);
    expect(modeSectionOf(first)).toBe(`The user has entered poteto-mode custom mode. Follow the skill instructions in "${skillPath}" until the user exits or switches modes. Do not drift back to default agent behavior.`);
    expect(modeSkillOf(first)?.split('\n')[0]).toBe(`<skill name="poteto-mode" location="${skillPath}">`);
    expect(statuses(rpc).some((text) => typeof text === 'string' && text.replace(/\x1b\[[0-9;]*m/g, '') === '♛ mode: poteto-mode')).toBe(true);

    // Cursor keeps the mode's skill in context for the whole session and adds a reminder to every later turn.
    for (const turn of ['second turn', 'third turn']) {
      const prompt = await ask(rpc, `${turn}\n@@sys`);
      expect(modeSectionOf(prompt)).toBe(
        `Reminder: you are still in poteto-mode mode. Follow that mode's skill on this turn. Do not drop it because the request looks small or you already have context. Do not drift back to default agent behavior. If you cannot state the mode's hard rules, read ${JSON.stringify(skillPath)} before acting.`,
      );
      expect(modeSkillOf(prompt)).toContain('## Playbooks\n\nOpen a todolist whose first items are the matched playbook');
    }

    await command(rpc, '/mode off');
    const afterExit = await ask(rpc, 'fourth turn\n@@sys');
    expect(modeSectionOf(afterExit)).toBe("The user has exited poteto-mode custom mode. Stop following that mode's skill. Continue without those constraints.");
    expect(modeSkillOf(afterExit)).toBeUndefined();
    const later = await ask(rpc, 'fifth turn\n@@sys');
    expect([modeSectionOf(later), modeSkillOf(later)]).toEqual([undefined, undefined]);
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
    const prompt = await ask(second, 'after the move\n@@sys');
    expect(modeSectionOf(prompt)).toBe(
      `Reminder: you are still in tdd mode. Follow that mode's skill on this turn. Do not drop it because the request looks small or you already have context. Do not drift back to default agent behavior. If you cannot state the mode's hard rules, read ${JSON.stringify(join(PACKAGE_ROOT, 'skills/tdd/SKILL.md'))} before acting.`,
    );
    expect(modeSkillOf(prompt)?.split('\n')[0]).toBe(`<skill name="tdd" location="${join(PACKAGE_ROOT, 'skills/tdd/SKILL.md')}">`);
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
    const prompt = await ask(second, 'after\n@@sys');
    expect(modeSectionOf(prompt)).toBe('Mode gone-skill is on, but no loaded skill has that name. Tell the user to run /mode off or /mode <skill>.');
    expect(prompt).not.toContain('SECRET-CONTENT');
  } finally {
    await second.close();
  }
});

test('the mode survives a restart of the same session and keeps its skill in context (MODE-003)', async () => {
  const sessions = join(sandbox.root, 'sessions');
  const skillPath = join(PACKAGE_ROOT, 'skills/tdd/SKILL.md');
  const first = startRpc(sandbox, ['--session-dir', sessions]);
  let sessionFile = '';
  try {
    await command(first, '/mode tdd');
    expect(modeSectionOf(await ask(first, 'check\n@@sys'))).toBe(`The user has entered tdd custom mode. Follow the skill instructions in "${skillPath}" until the user exits or switches modes. Do not drift back to default agent behavior.`);
    first.send({ id: 'state', type: 'get_state' });
    sessionFile = String(((await first.waitFor((event) => event['id'] === 'state'))['data'] as { sessionFile: string }).sessionFile);
  } finally {
    await first.close();
  }
  const second = startRpc(sandbox, ['--session-dir', sessions, '--session', sessionFile]);
  try {
    // The branch shows a reply already carried the mode, so the restarted session reminds instead of re-entering,
    // and the skill itself is still in the request.
    const prompt = await ask(second, 'after restart\n@@sys');
    expect(modeSectionOf(prompt)?.startsWith('Reminder: you are still in tdd mode.')).toBe(true);
    expect(modeSkillOf(prompt)?.split('\n')[0]).toBe(`<skill name="tdd" location="${skillPath}">`);
  } finally {
    await second.close();
  }
});
