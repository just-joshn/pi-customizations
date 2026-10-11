import { expect, test } from 'vitest';
import { type ContextMessage, providerSystemSections, stripSkillBlocks, stripSkillsFromMessages } from '../../src/core/context.ts';

test('stripSkillBlocks keeps trailing user args after a Pi skill delivery wrapper', () => {
  const text = `<skill name="poteto-mode" location="/pkg/skills/poteto-mode/SKILL.md">
References are relative to /pkg/skills/poteto-mode.

# Poteto mode
Use bash tools.
</skill>

do a complete and comprehensive depth manual test`;
  expect(stripSkillBlocks(text)).toBe('do a complete and comprehensive depth manual test');
});

test('stripSkillBlocks leaves ordinary user text unchanged', () => {
  expect(stripSkillBlocks('hello')).toBe('hello');
  expect(stripSkillBlocks('mention <skill> as prose without a close')).toBe('mention <skill> as prose without a close');
});

test('stripSkillBlocks removes every closed skill wrapper', () => {
  const text = `<skill name="how" location="/a">body</skill>\n\nfirst\n\n<skill name="why" location="/b">more</skill>\n\nsecond`;
  expect(stripSkillBlocks(text)).toBe('first\n\nsecond');
});

test('providerSystemSections keeps cwd and Aider preamble only', () => {
  expect(providerSystemSections({ sections: { cwd: '<cwd>/repo</cwd>', foreign: 'FOREIGN', pstack_poteto_playbook_todos: 'TodoWrite' } }, 'AIDER MAIN', true)).toEqual({ cwd: '<cwd>/repo</cwd>', preamble: 'AIDER MAIN' });
  expect(providerSystemSections({ sections: { foreign: 'FOREIGN' } }, 'AIDER MAIN', true)).toEqual({ preamble: 'AIDER MAIN' });
  expect(providerSystemSections({ sections: { cwd: '<cwd>/repo</cwd>' } }, 'AIDER MAIN', false)).toEqual({ cwd: '<cwd>/repo</cwd>' });
});

test('stripSkillsFromMessages rewrites string and text-block user content', () => {
  const skill = `<skill name="poteto-mode" location="/x">body</skill>\n\nCURRENT`;
  const messages: ContextMessage[] = [
    { role: 'user', content: skill, timestamp: 1 },
    { role: 'user', content: [{ type: 'text', text: skill }], timestamp: 2 },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      provider: 'p',
      model: 'm',
      api: 'request-only-acknowledgment',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 3,
    },
  ];
  const stripped = stripSkillsFromMessages(messages);
  expect(stripped[0]).toMatchObject({ role: 'user', content: 'CURRENT' });
  expect(stripped[1]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'CURRENT' }] });
  expect(stripped[2]).toBe(messages[2]);
});
