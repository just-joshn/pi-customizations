// Contract: Cursor CLI `findSkillReferences` attaches every `/name` that starts a message or follows whitespace, each
// once, in order (parity notes SKILL-REF-001..004). pi-pstack attaches those pstack skills through Pi's own
// `/skill:<name> args` expansion, so the unit result is read the way Pi reads it: first command, then arguments.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { skillBlock } from '../../src/skill-block.ts';
import { registerSkillRouting, skillReferences } from '../../src/skill-routing.ts';
import { STYLE_ENTRY } from '../../src/style.ts';
import { fakePi, packageCommands } from '../integration/fake-pi.ts';

const block = (name: string) => skillBlock(name, join(PACKAGE_ROOT, 'generated', 'skills', name, 'SKILL.md')) ?? '';
const names = new Set(['how', 'why', 'deslop']);

function route(text: string, options: { source?: string; commands?: ReturnType<typeof packageCommands> } = {}) {
  const host = fakePi({ cwd: PACKAGE_ROOT, ...(options.commands === undefined ? {} : { commands: options.commands }) });
  registerSkillRouting(host.pi);
  return host.fire('input', { text, source: options.source ?? 'interactive' }).then((results) => results[0] as { action: string; text?: string; images?: unknown });
}

test.for([
  { text: 'run /how on this', found: ['how'] },
  { text: '/why x\t/how, y /why z /nope', found: ['why', 'how'] },
  { text: 'design it.\n/how first', found: ['how'] },
  { text: 'see /usr/bin/env and src/how/x and /how/x and /how.md and /howdy and /How', found: [] },
  { text: 'run `/how` and ```\n/why\n``` and `a /deslop b`', found: [] },
  { text: 'unterminated ```\n/how', found: [] },
])('skillReferences($text)', ({ text, found }) => {
  expect(skillReferences(text, names)).toEqual(found);
});

const sourceInfo = { path: '/elsewhere/how', source: 'local', scope: 'user' as const, origin: 'top-level' as const };
const image = { type: 'image' as const, data: 'aGk=', mimeType: 'image/png' };
const text = (result: { text?: string }) => result.text;

test('a skill named after other words is attached as a /skill: command carrying the whole message', async () => {
  expect(await route('run /how on this')).toEqual({ action: 'transform', text: '/skill:how run /how on this' });
});

test('several skills attach once each: the first as the command, the rest as blocks ahead of the message', async () => {
  const message = 'compare /why and /how, then /why again';
  expect(await route(message)).toEqual({ action: 'transform', text: `/skill:why ${block('how')}\n\n${message}` });
});

test('a leading /name keeps its own skill and later names attach after it, in order', async () => {
  const message = '/how check /deslop and /why /deslop';
  expect(text(await route(message))).toBe(`/skill:how ${block('deslop')}\n\n${block('why')}\n\ncheck /deslop and /why /deslop`);
  expect(text(await route('/skill:how check /why'))).toBe(`/skill:how ${block('why')}\n\ncheck /why`);
  expect(text(await route('/skill:how\u0020/why'))).toBe(`/skill:how ${block('why')}\n\n/why`);
});

test('a message that names no further skill is left to Pi: the prompt template and /skill: expand on their own', async () => {
  for (const message of ['/how trace this', '/how', '/skill:how trace this', '/how again /how', '/skill:how and /how', 'no skills here', '']) {
    expect(await route(message)).toEqual({ action: 'continue' });
  }
});

test('paths, other words, code, and an attached block name nothing', async () => {
  for (const message of ['read /usr/bin/env and /how/x and /how.md', 'a/why and /howdy', 'run `/how` here', 'run\n```\n/why\n```', `${block('how')}\n\nthen /how`]) {
    expect(await route(message)).toEqual({ action: 'continue' });
  }
});

test('a message led by another command or template is not touched', async () => {
  const owner = [...packageCommands().filter((command) => command.source === 'skill'), { name: 'how', source: 'prompt' as const, sourceInfo }, { name: 'mine', source: 'prompt' as const, sourceInfo }];
  expect(await route('/model then /how')).toEqual({ action: 'continue' });
  expect(await route('/mine then /why', { commands: owner })).toEqual({ action: 'continue' });
  expect(await route('/how then /why', { commands: owner })).toEqual({ action: 'continue' });
});

test('an unknown leading word is plain text and does not hide a skill named later', async () => {
  expect(await route('/usr/bin/env fails, ask /how')).toEqual({ action: 'transform', text: '/skill:how /usr/bin/env fails, ask /how' });
});

test('input an extension sent, and a skill Pi did not load, attach nothing', async () => {
  expect(await route('run /how', { source: 'extension' })).toEqual({ action: 'continue' });
  expect(await route('run /how', { commands: packageCommands().filter((command) => command.name !== 'skill:how') })).toEqual({ action: 'continue' });
});

test('images ride along, and /pstack:<name> still routes to the skill ahead of a later name', async () => {
  const host = fakePi({ cwd: PACKAGE_ROOT, commands: [...packageCommands().filter((command) => command.source === 'skill'), { name: 'how', source: 'extension', sourceInfo }] });
  registerSkillRouting(host.pi);
  const [first] = await host.fire('input', { text: 'see /why', images: [image], source: 'rpc' });
  expect(first).toEqual({ action: 'transform', text: `/skill:why see /why`, images: [image] });
  const [aliased] = await host.fire('input', { text: '/pstack:how and /why', images: [image], source: 'rpc' });
  expect(aliased).toEqual({ action: 'transform', text: `/skill:how ${block('why')}\n\nand /why`, images: [image] });
  const [plain] = await host.fire('input', { text: '/pstack:how alone', source: 'rpc' });
  expect(plain).toEqual({ action: 'transform', text: '/skill:how alone' });
});

test('every attached block is the text Pi builds for /skill:<name>', () => {
  const path = join(PACKAGE_ROOT, 'generated', 'skills', 'how', 'SKILL.md');
  expect(block('how')).toBe(`<skill name="how" location="${path}">\nReferences are relative to ${join(PACKAGE_ROOT, 'generated', 'skills', 'how')}.\n\n${readFileSync(path, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim()}\n</skill>`);
});

const mine = { name: 'skill:mine', source: 'skill' as const, sourceInfo: { path: join(PACKAGE_ROOT, 'package.json'), source: 'local', scope: 'user' as const, origin: 'top-level' as const } };
const mineBlock = () => skillBlock('mine', mine.sourceInfo.path) ?? '';
const withMine = [...packageCommands(), mine];

test('inside a pstack workflow a loaded non-pstack skill attaches too, in first-reference order', async () => {
  expect(text(await route('run /mine then /how', { commands: withMine }))).toBe(`/skill:mine ${block('how')}\n\nrun /mine then /how`);
  expect(text(await route('/how then /mine', { commands: withMine }))).toBe(`/skill:how ${mineBlock()}\n\nthen /mine`);
  expect(text(await route('/skill:how /mine /mine', { commands: withMine }))).toBe(`/skill:how ${mineBlock()}\n\n/mine /mine`);
});

test('with the pstack style on, a non-pstack skill attaches without a pstack name', async () => {
  const host = fakePi({ cwd: PACKAGE_ROOT, commands: withMine });
  registerSkillRouting(host.pi);
  const [off] = await host.fire('input', { text: 'use /mine', source: 'rpc' });
  expect(off).toEqual({ action: 'continue' });
  host.session.appendCustomEntry(STYLE_ENTRY, { on: true });
  const [on] = await host.fire('input', { text: 'use /mine', source: 'rpc' });
  expect(on).toEqual({ action: 'transform', text: '/skill:mine use /mine' });
  const [code] = await host.fire('input', { text: 'use `/mine` and /usr/bin/env', source: 'rpc' });
  expect(code).toEqual({ action: 'continue' });
});

test('outside a pstack workflow a non-pstack skill name leaves the input untouched', async () => {
  for (const message of ['use /mine', 'use /mine and /mine', '/skill:mine go /mine', 'use /mine and /how/x']) {
    expect(await route(message, { commands: withMine })).toEqual({ action: 'continue' });
  }
});
