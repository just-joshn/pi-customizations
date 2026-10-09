import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, 'skills', path), 'utf8');
const prose = (text: string) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

test('generated skill prose has no long dash outside the setup-pstack labels', async () => {
  const names = (await readdir(join(root, 'skills'), { recursive: true })).filter((name) => name.endsWith('.md') && !name.includes('node_modules') && !name.startsWith('setup-pstack/') && !name.startsWith('make-bot-ui/'));
  const offenders: string[] = [];
  for (const name of names) if (prose(await read(name)).includes('—')) offenders.push(name);
  expect(names).toContain('poteto-mode/SKILL.md');
  expect(offenders).toEqual([]);
});

test('setup budget labels retain their source-defined form', async () => {
  for (const label of ['unlimited — max reasoning', 'large — xhigh reasoning', 'medium — high reasoning', 'small — medium reasoning']) expect(await read('setup-pstack/SKILL.md')).toContain(label);
});

test('triage formatting preserves the source ask gate', async () => {
  const text = await read('poteto-mode/references/bugbot-triage.md');
  expect(prose(text)).not.toMatch(/[;—]/);
  expect(text).toContain('When in doubt, ask.');
  expect(text).toContain('### Contract-test drift claims are cheaply verifiable, so run the test first');
  expect(text).not.toContain('Under a full-autonomy grant');
});

test('tdd and principle headings use sentence case', async () => {
  const names = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory() && (entry.name === 'tdd' || entry.name.startsWith('principle-'))).map((entry) => entry.name);
  const offenders: string[] = [];
  for (const name of names)
    for (const heading of (await read(`${name}/SKILL.md`)).match(/^#{1,6} .+$/gm) ?? []) {
      if (
        heading
          .replace(/^#+ /, '')
          .split(' ')
          .slice(1)
          .some((word) => /^[A-Z][a-z]/.test(word) && word !== 'I')
      )
        offenders.push(`${name} ${heading}`);
    }
  expect(offenders).toEqual([]);
  expect(await read('tdd/SKILL.md')).toContain('## If a failing test is impractical');
});

test('typescript patterns retain formatting and schema-based validation', async () => {
  const patterns = await read('typescript-best-practices/references/patterns.md');
  expect(patterns.split('\n').filter((line) => /^ +\S/.test(line) && !/^ \*/.test(line))).toEqual([]);
  expect(patterns).toContain('Match the `readonly __brand: "X"` shape.');
  expect(patterns).toContain('return userSchema.parse(data);');
  expect(patterns).not.toContain('return data as User');
});

test('equivalent skill clarifications remain available', async () => {
  expect(await read('automate-me/SKILL.md')).toContain('This skill orchestrates two skills and an inline pass.');
  expect(await read('principle-experience-first/SKILL.md')).toContain('[Foundational thinking](../principle-foundational-thinking/SKILL.md) governs the *sequence* of work.');
  expect(await read('how/SKILL.md')).toContain('No explorer ran, so the explainer explores for itself.');
  expect(await read('arena/SKILL.md')).toContain('per the **laziness-protocol** principle skill');
});

test('architect preserves two distinct candidates without a port convergence policy', async () => {
  expect(await read('architect/SKILL.md')).toContain('Require at least two structurally distinct candidates before synthesis, even when the first looks sufficient.');
  expect(await read('architect/SKILL.md')).not.toContain('When arena reports');
});

test('reflect preserves workspace-scoped transcript privacy', async () => {
  const reflect = await read('reflect/SKILL.md');
  expect(reflect).not.toMatch(/<session-dir>\/\*\.jsonl/);
  expect(reflect).toContain('Use that exact path.');
  expect(reflect).toContain('Do not glob the Pi session storage directory.');
});

test('teach discloses the native image-tool fallback', async () => {
  expect(await read('teach/SKILL.md')).toContain('otherwise draw it as an SVG or mermaid sketch with a few short labels and say that you substituted it for an image.');
});

test('dependency-only deslop receipt does not become a pstack owner obligation', async () => {
  expect(await read('deslop/SKILL.md')).toContain('end it with a receipt of files touched and edits per focus area');
  for (const name of ['autopilot-full', 'autopilot-stack']) expect(await read(`poteto-mode/playbooks/${name}.md`)).not.toContain("receipt of files touched and edits per focus area goes in the owner's report");
});

test('interrogate preserves its source Core Prompt without creating a synchronization obligation', async () => {
  const copy = await read('interrogate/references/code-quality-review.md');
  const source = await readFile(join(root, 'upstream/skills/interrogate/references/code-quality-review.md'), 'utf8');
  const block = (text: string) => text.match(/## Core Prompt\n[\s\S]*?(?=\n## )/)?.[0];
  expect(block(copy)).toBeDefined();
  expect(block(copy)).toBe(block(source));
  expect(copy).not.toContain('Keep the two in sync.');
});
