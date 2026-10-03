import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { builtInAgents } from '../src/subagents/builtin-agents.ts';
import { parseReferenceSettings } from '../src/subagents/settings.ts';
import { applyPreference, parsePreferenceCommand, persistPreference, renderPreferences, usage } from '../src/subagents/subagent-preferences.ts';
import { scratchDir } from './support/scratch.ts';

test.for([
  { args: '', expected: { kind: 'show' } },
  { args: 'model explore gpt-6 required', expected: { kind: 'model', agent: 'explore', model: 'gpt-6', policy: 'required' } },
  { args: 'model explore gpt-6', expected: { kind: 'model', agent: 'explore', model: 'gpt-6', policy: 'preferred' } },
  { args: 'effort task high', expected: { kind: 'effort', agent: 'task', level: 'high' } },
  { args: 'tier research long_context', expected: { kind: 'tier', agent: 'research', tier: 'long_context' } },
  { args: 'disable task', expected: { kind: 'disable', agent: 'task' } },
  { args: 'enable task', expected: { kind: 'enable', agent: 'task' } },
  { args: 'reset task', expected: { kind: 'reset', agent: 'task' } },
  { args: 'rubber-duck off', expected: { kind: 'rubber-duck', enabled: false } },
])('"$args" parses to $expected', ({ args, expected }) => {
  expect(parsePreferenceCommand(args)).toEqual(expected);
});

test.for(['model', 'model explore', 'model explore gpt-6 sometimes', 'effort explore extreme', 'tier explore huge', 'rubber-duck maybe', 'explode explore'])('"%s" is rejected with an explanation', (args) => {
  expect(parsePreferenceCommand(args)).toHaveProperty('error');
});

test('a rejected policy and an unknown action name the allowed choices', () => {
  expect(parsePreferenceCommand('model explore gpt-6 sometimes')).toEqual({ error: 'The model policy must be preferred or required.' });
  expect(parsePreferenceCommand('explode explore')).toEqual({ error: `Usage:\n${usage}` });
});

test('applying a preference edits the nested settings without mutating the input', () => {
  const before = { subagents: { agents: { explore: { effortLevel: 'low' } }, disabledSubagents: ['a'] }, other: 1 };
  const model = applyPreference(before, { kind: 'model', agent: 'explore', model: 'gpt-6', policy: 'required' });
  expect(model).toEqual({ subagents: { agents: { explore: { effortLevel: 'low', model: 'gpt-6', modelPolicy: 'required' } }, disabledSubagents: ['a'] }, other: 1 });
  expect(before.subagents.agents.explore).toEqual({ effortLevel: 'low' });
  expect(applyPreference(model, { kind: 'reset', agent: 'explore' })).toEqual({ subagents: { agents: {}, disabledSubagents: ['a'] }, other: 1 });
  expect(applyPreference(before, { kind: 'disable', agent: 'task' })).toMatchObject({ subagents: { disabledSubagents: ['a', 'task'] } });
  expect(applyPreference(before, { kind: 'enable', agent: 'a' })).toMatchObject({ subagents: { disabledSubagents: [] } });
  expect(applyPreference(before, { kind: 'rubber-duck', enabled: false })).toMatchObject({ builtInAgents: { rubberDuck: false } });
});

test('persisting merges into the existing file and creates a missing one', () => {
  const dir = scratchDir('pstack-preferences-');
  const file = join(dir, 'nested', 'settings.json');
  persistPreference(file, { kind: 'effort', agent: 'task', level: 'low' });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ subagents: { agents: { task: { effortLevel: 'low' } } } });
  const written = persistPreference(file, { kind: 'tier', agent: 'task', tier: 'default' });
  expect(written).toEqual({ subagents: { agents: { task: { effortLevel: 'low', contextTier: 'default' } } } });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(written);
});

test('a settings file that cannot be parsed is left untouched instead of overwritten', () => {
  const file = join(scratchDir('pstack-preferences-'), 'settings.json');
  writeFileSync(file, '{broken');
  expect(() => persistPreference(file, { kind: 'tier', agent: 'task', tier: 'default' })).toThrow();
  expect(readFileSync(file, 'utf8')).toBe('{broken');
});

test('persisting accepts a BOM but refuses JSON that is not an object', () => {
  const dir = scratchDir('pstack-preferences-');
  const file = join(dir, 'settings.json');
  writeFileSync(file, `\uFEFF${JSON.stringify({ subagents: { agents: { task: { model: 'm' } } } })}`);
  expect(persistPreference(file, { kind: 'enable', agent: 'task' })).toMatchObject({ subagents: { agents: { task: { model: 'm' } }, disabledSubagents: [] } });
  for (const text of ['[1,2]', '42', 'null']) {
    writeFileSync(file, text);
    expect(() => persistPreference(file, { kind: 'disable', agent: 'task' })).toThrow('does not hold a JSON object.');
    expect(readFileSync(file, 'utf8')).toBe(text);
  }
});

test('enabling an agent drops disabled entries a hand-edited file left malformed', () => {
  const file = join(scratchDir('pstack-preferences-'), 'settings.json');
  writeFileSync(file, JSON.stringify({ subagents: { disabledSubagents: [1, 'task', null] } }));
  expect(persistPreference(file, { kind: 'enable', agent: 'task' })).toMatchObject({ subagents: { disabledSubagents: [] } });
});

test('a settings path that cannot be read as a file surfaces the read error', () => {
  const file = join(scratchDir('pstack-preferences-'), 'settings.json');
  mkdirSync(file, { recursive: true });
  expect(() => persistPreference(file, { kind: 'effort', agent: 'task', level: 'low' })).toThrow();
  expect(statSync(file).isDirectory()).toBe(true);
});

test('the preference listing marks disabled agents and shows each override', () => {
  const { settings } = parseReferenceSettings({
    subagents: { agents: { explore: { model: 'gpt-6', modelPolicy: 'required', effortLevel: 'medium', contextTier: 'default' } }, disabledSubagents: ['task'] },
    builtInAgents: { rubberDuck: false },
  });
  const text = renderPreferences(settings, builtInAgents.slice(1, 3));
  expect(text).toBe('Subagent preferences\nexplore: model gpt-6 (required), effort medium, tier default\n[disabled] task: model default, effort default, tier inherit\nrubber-duck: off');
});

test('an override without a policy or effort falls back to the preferred policy and the agent default', () => {
  const { settings } = parseReferenceSettings({ subagents: { agents: { task: { model: 'gpt-6' } } } });
  const taskAgent = builtInAgents.find((agent) => agent.name === 'task');
  expect(taskAgent).toBeDefined();
  expect(renderPreferences(settings, taskAgent ? [taskAgent] : [])).toContain('task: model gpt-6 (preferred), effort default, tier inherit');
});
