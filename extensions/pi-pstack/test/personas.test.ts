import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readPersona, readTeamKitRules } from '../src/personas.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('general purpose has no extra instructions or default model', async () => {
  assert.deepEqual(await readPersona('generalPurpose'), { instructions: '', defaultModel: undefined });
});

test('Poteto and both Comment Sicko names preserve complete existing prompts', async () => {
  const agent = await readFile(join(root, 'upstream/agents/poteto-agent.md'), 'utf8');
  const mode = await readFile(join(root, 'skills/poteto-mode/SKILL.md'), 'utf8');
  assert.deepEqual(await readPersona('poteto-agent'), { instructions: `${agent}\n${mode}`, defaultModel: undefined });
  const comment = await readFile(join(root, 'upstream/agents/comment-sicko.md'), 'utf8');
  for (const name of ['comment-sicko', 'Comment Sicko']) {
    assert.deepEqual(await readPersona(name), { instructions: comment, defaultModel: undefined });
  }
});

test('CI watcher preserves its full prompt and fast model request', async () => {
  const profile = await readPersona('ci-watcher');
  assert.equal(profile.defaultModel, 'fast');
  assert.equal(profile.instructions, await readFile(join(root, 'upstream-team-kit/agents/ci-watcher.md'), 'utf8'));
});

test('thermo reviewer receives its complete persona and complete rubric', async () => {
  const profile = await readPersona('thermo-nuclear-code-quality-review');
  assert.equal(profile.defaultModel, undefined);
  assert.ok(profile.instructions.includes(await readFile(join(root, 'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md'), 'utf8')));
  assert.ok(profile.instructions.includes(await readFile(join(root, 'skills/thermo-nuclear-code-quality-review/SKILL.md'), 'utf8')));
});

test('unknown or unsupported builtin roles do not silently become general purpose', async () => {
  for (const name of ['', 'shell', 'explore', 'other', '../poteto-agent']) {
    await assert.rejects(readPersona(name), /Unsupported agent .*Available:/);
  }
});

test('both always applied kit rules are loaded in full without frontmatter', async () => {
  const rules = await readTeamKitRules();
  const originals = await Promise.all(['no-inline-imports.mdc', 'typescript-exhaustive-switch.mdc'].map(file => readFile(join(root, 'upstream-team-kit/rules', file), 'utf8')));
  assert.equal(rules, originals.map(source => source.replace(/^---\n[\s\S]*?\n---\n/, '').trim()).join('\n\n'));
  assert.match(rules, /# No inline imports/);
  assert.match(rules, /strict circular-dependency reason and it is documented\./);
  assert.match(rules, /typescript-exhaustive-switch: In switch statements/);
  assert.doesNotMatch(rules, /alwaysApply:|description:/);
});
