import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { assistantTexts, contentText, makeSandbox, messages, runJson, type Sandbox } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const SKILLS = join(PACKAGE_ROOT, 'skills');
const shipped = readdirSync(SKILLS)
  .filter((name) => existsSync(join(SKILLS, name, 'SKILL.md')))
  .toSorted();

test('every shipped skill attaches its own body through /name in one real Pi session (RESOURCE-001)', async () => {
  const run = await runJson(
    sandbox,
    shipped.map((name) => `/${name}\n@@say ${name}`),
    ['--no-session'],
    240_000,
  );
  const users = messages(run.events, 'user').map((message) => contentText(message.content));
  expect(shipped).toHaveLength(78);
  expect(assistantTexts(run.events)).toEqual(shipped);
  const expected = shipped.map((name) => {
    const file = join(SKILLS, name, 'SKILL.md');
    const body = stripFrontmatter(readFileSync(file, 'utf8')).trim();
    return `<skill name="${name}" location="${file}">\nReferences are relative to ${dirname(file)}.\n\n${body}\n</skill>\n\n@@say ${name}`;
  });
  expect(users).toEqual(expected);
});
