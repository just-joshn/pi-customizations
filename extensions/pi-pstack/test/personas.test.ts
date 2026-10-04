import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { isReferencePersona, readPersona } from '../src/personas.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('general purpose has no extra instructions or default model', async () => {
  expect(await readPersona('generalPurpose')).toEqual({ instructions: '', defaultModel: undefined });
});

test('Poteto and both Comment Sicko names preserve complete existing prompts', async () => {
  const agent = await readFile(join(root, 'upstream/agents/poteto-agent.md'), 'utf8');
  const mode = await readFile(join(root, 'skills/poteto-mode/SKILL.md'), 'utf8');
  const { instructions } = await readPersona('poteto-agent');
  expect(instructions).toBe(`${agent}\n${mode}`);
  expect(instructions).toContain('Spawn a fresh `poteto-agent` for each new task');
  expect(instructions).not.toContain('Resume rule.');
  const comment = await readFile(join(root, 'upstream/agents/comment-sicko.md'), 'utf8');
  for (const name of ['comment-sicko', 'Comment Sicko']) {
    expect(await readPersona(name)).toEqual({ instructions: comment, defaultModel: undefined });
  }
});

test('CI watcher preserves its full prompt and inherits the parent model like a Reference plugin agent', async () => {
  const profile = await readPersona('ci-watcher');
  expect(profile.defaultModel).toBeUndefined();
  expect(profile.instructions).toBe(await readFile(join(root, 'upstream-team-kit/agents/ci-watcher.md'), 'utf8'));
});

test('thermo reviewer receives its complete persona and complete rubric', async () => {
  const profile = await readPersona('thermo-nuclear-code-quality-review');
  expect(profile.defaultModel).toBeUndefined();
  expect(profile.instructions).toContain(await readFile(join(root, 'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md'), 'utf8'));
  expect(profile.instructions).toContain(await readFile(join(root, 'skills/thermo-nuclear-code-quality-review/SKILL.md'), 'utf8'));
});

test('shell and explore personas are supplied natively', async () => {
  expect((await readPersona('shell')).instructions).toMatch(/shell agent/);
  expect((await readPersona('explore')).instructions).toMatch(/read-only codebase explorer/);
});

test('unknown roles do not silently become general purpose', async () => {
  for (const name of ['', 'other', '../poteto-agent']) {
    await expect(readPersona(name)).rejects.toThrow(/Unsupported agent .*Available:/);
  }
});

test('reference persona names are recognized case-sensitively by their exact keys', () => {
  expect([isReferencePersona('poteto-agent'), isReferencePersona('ci-watcher'), isReferencePersona('Comment Sicko'), isReferencePersona('comment sicko'), isReferencePersona('nobody')]).toEqual([true, true, true, false, false]);
});
