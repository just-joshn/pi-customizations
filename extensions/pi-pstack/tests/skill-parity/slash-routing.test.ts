import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { aliasInput, GENERATED_PROMPTS, generatedSkillNames, PI_BUILTIN_COMMANDS, registerSkillRouting, slashConflicts } from '../../src/skill-routing.ts';
import { fakePi, packageCommands } from '../integration/fake-pi.ts';

const names = generatedSkillNames();
const image = { type: 'image' as const, data: 'aGk=', mimeType: 'image/png' };
const other = (name: string, source: 'extension' | 'prompt'): SlashCommandInfo => ({ name, source, sourceInfo: { path: `/elsewhere/${name}`, source: 'local', scope: 'user', origin: 'top-level' } });

/** How `/name` reaches the skill: through its own prompt template, or through `/pstack:name`, or not at all. */
function route(name: string, commands: SlashCommandInfo[]): string {
  const conflicts = new Set(slashConflicts(commands, names).map((conflict) => conflict.name));
  const loaded = new Set(commands.filter((command) => command.source === 'skill').map((command) => command.name.slice('skill:'.length)));
  if (!conflicts.has(name)) {
    const prompt = commands.find((command) => command.source === 'prompt' && command.name === name);
    return prompt?.sourceInfo.path === join(GENERATED_PROMPTS, `${name}.md`) ? `/${name}` : 'unreachable';
  }
  const result = aliasInput({ text: `/pstack:${name} the task`, images: [image] }, conflicts, loaded);
  return result.action === 'transform' && result.text === `/skill:${name} the task` && result.images?.[0] === image ? `/pstack:${name}` : 'unreachable';
}

test('the package ships 62 generated skills, each with a prompt that loads it and passes the arguments', () => {
  expect(names).toHaveLength(62);
  for (const name of names) {
    const prompt = readFileSync(join(GENERATED_PROMPTS, `${name}.md`), 'utf8');
    expect(prompt).toContain(`generated/skills/${name}/SKILL.md`);
    expect(prompt).toMatch(/\$@/);
  }
});

test('no generated skill name collides with a Pi built-in command', () => {
  expect(names.filter((name) => PI_BUILTIN_COMMANDS.includes(name))).toEqual([]);
});

test('every generated skill is reachable by /name when nothing else owns the name', () => {
  const commands = packageCommands();
  expect(slashConflicts(commands, names)).toEqual([]);
  expect(names.map((name) => route(name, commands))).toEqual(names.map((name) => `/${name}`));
});

test('every generated skill is reachable by /pstack:<name> when another command owns /name', () => {
  const commands = [...packageCommands().filter((command) => command.source === 'skill'), ...names.map((name, index) => other(name, index % 2 === 0 ? 'extension' : 'prompt'))];
  const conflicts = slashConflicts(commands, names);
  expect(conflicts).toHaveLength(62);
  expect(conflicts[0]).toEqual({ name: names[0], owner: `extension command /${names[0]} (/elsewhere/${names[0]})` });
  expect(conflicts[1]).toEqual({ name: names[1], owner: `prompt template /${names[1]} (/elsewhere/${names[1]})` });
  expect(names.map((name) => route(name, commands))).toEqual(names.map((name) => `/pstack:${name}`));
});

test('the alias is only for conflicting names whose skill is loaded, and keeps the text after the name exactly', () => {
  const loaded = new Set(['how']);
  expect(aliasInput({ text: '/pstack:how  "two words"\nsecond line' }, new Set(['how']), loaded)).toEqual({ action: 'transform', text: '/skill:how  "two words"\nsecond line' });
  expect(aliasInput({ text: '/pstack:how' }, new Set(['how']), loaded)).toEqual({ action: 'transform', text: '/skill:how' });
  expect(aliasInput({ text: '/pstack:how x' }, new Set(), loaded)).toEqual({ action: 'continue' });
  expect(aliasInput({ text: '/pstack:why x' }, new Set(['why']), loaded)).toEqual({ action: 'continue' });
  expect(aliasInput({ text: '/pstack:howl x' }, new Set(['how']), loaded)).toEqual({ action: 'continue' });
});

test('the input handler rewrites an aliased name and passes everything else through', async () => {
  const fake = fakePi({ cwd: '/', commands: [...packageCommands().filter((command) => command.name !== 'how'), other('how', 'extension')] });
  const routing = registerSkillRouting(fake.pi);
  expect(routing.conflicts()).toEqual([{ name: 'how', owner: 'extension command /how (/elsewhere/how)' }]);
  expect(await fake.fire('input', { text: '/pstack:how trace the cache', images: [image], source: 'rpc' })).toEqual([{ action: 'transform', text: '/skill:how trace the cache', images: [image] }]);
  expect(await fake.fire('input', { text: '/pstack:why x', source: 'rpc' })).toEqual([{ action: 'continue' }]);
  expect(await fake.fire('input', { text: 'plain text', source: 'rpc' })).toEqual([{ action: 'continue' }]);
});
