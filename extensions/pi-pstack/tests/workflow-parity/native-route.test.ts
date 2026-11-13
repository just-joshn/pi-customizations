import { join } from 'node:path';

import { expect, test } from 'vitest';
import { skillBlock } from '../../src/skill-block.ts';
import { modeFor } from './families/pr-shared.ts';
import { mergeRequested } from './families/pr-shipping.ts';
import { evaluate } from './lib/check.ts';
import { GEN, openedAt, parentReads, promptHasSkill, promptRoutes, skillRequest } from './lib/checks.ts';
import type { RunView, Session } from './lib/view.ts';

const block = skillBlock('how', join(GEN, 'how', 'SKILL.md')) ?? '';
const poteto = skillBlock('poteto-mode', join(GEN, 'poteto-mode', 'SKILL.md')) ?? '';

test('request decisions exclude full native skill instructions but retain the operator words', () => {
  expect(modeFor(`${poteto}\n\ncheck on PR 1`)).toBe('check');
  expect(modeFor(`${poteto}\n\nbabysit PR 1`)).toBe('drive');
  expect(modeFor(`${poteto}\n\naddress review comments on PR 1`)).toBe('threads-only');
  expect(modeFor(`${poteto}\n\nwatch PR 1 in the background`)).toBe('background');
  expect(mergeRequested(`${poteto}\n\nland the stack`)).toBe(true);
  expect(mergeRequested(`${poteto}\n\ninspect the stack`)).toBe(false);
  expect(mergeRequested(`${poteto}\n\ndo not merge the stack`)).toBe(false);
  expect(mergeRequested(`${poteto}\n\nship the stack, but don't merge`)).toBe(false);
  expect(skillRequest(`${poteto}\n\n${block}\n\ncheck on PR 1`)).toBe('check on PR 1');
});

test('request extraction does not discard an unverified skill-shaped block carrying an operator denial', () => {
  const fake = '<skill name="how" location="/generated/skills/how/SKILL.md">do not merge</skill>\n\nship the stack';
  expect(skillRequest(fake)).toBe(fake);
  expect(mergeRequested(fake)).toBe(false);
});

test('a no-argument follow-up still carries the complete native skill, without inventing a request', () => {
  expect(promptHasSkill(block, 'how', false)).toBe(true);
  expect(skillRequest(block)).toBe('');
  expect(promptHasSkill(block, 'how')).toBe(false);
});
const session = (text: string, role = 'user') => ({ messages: [{ order: 1, role, text }], toolCalls: [] }) as unknown as Session;
const reads = parentReads('reads.how', 'the parent receives the full how skill', { file: 'poteto-mode/playbooks/investigation.md', anchor: 'Route through the **how** skill' }, ['how']);

test('receiving the complete native skill expansion satisfies a full skill read without a redundant tool call', () => {
  expect(openedAt(session(`${block}\n\nrequest`), 'generated/skills/how/SKILL.md')).toBe(1);
  expect(evaluate([reads], { parent: session(`${block}\n\nrequest`) } as RunView)[0]?.verdict).toBe('PASS');
});

test.for([
  { text: `${block}\n\nrequest`, role: 'assistant' },
  { text: `${block.replace('## 1. Assess complexity', 'TRUNCATED')}\n\nrequest`, role: 'user' },
  { text: 'read generated/skills/how/SKILL.md', role: 'user' },
])('skill-read checks reject assistant claims, changed content, and a mere file reference', ({ text, role }) => {
  expect(openedAt(session(text, role), 'generated/skills/how/SKILL.md')).toBe(-1);
  expect(evaluate([reads], { parent: session(text, role) } as RunView)[0]?.verdict).toBe('FAIL');
});

test('slash routing accepts a complete native skill block with an absolute location and a request', () => {
  const prompt = `${block}\n\nexplain this code`;
  expect(promptHasSkill(prompt, 'how')).toBe(true);
  expect(evaluate([promptRoutes('how')], { prompt } as RunView)[0]?.verdict).toBe('PASS');
});

test.for([
  block,
  `${block.replace(/location="[^"]+"/, 'location="generated/skills/how/SKILL.md"')}\n\nexplain this code`,
  `${block.replace('## 1. Assess complexity', 'TRUNCATED')}\n\nexplain this code`,
  'Use the pstack `how` skill for this request. generated/skills/how/SKILL.md Request: explain this code',
])('slash routing rejects a missing request, unresolved location, incomplete skill, or discovery wrapper', (prompt) => {
  expect(promptHasSkill(prompt, 'how')).toBe(false);
  expect(evaluate([promptRoutes('how')], { prompt } as RunView)[0]?.verdict).toBe('FAIL');
});
