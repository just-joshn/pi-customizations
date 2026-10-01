import { expect, test } from 'vitest';
import { appendedSubagentPrompt } from '../src/subagents/system-prompt.ts';

test.for(['1', 'true', 'yes', ' ON '])('[G2-08] enabled append gate %s preserves prompt text', (value) => {
  expect(appendedSubagentPrompt('APPEND_SENTINEL', { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: value })).toBe('\nAPPEND_SENTINEL');
});

test.for([undefined, '', '0', 'false', 'unknown'])('[G2-08] disabled append gate %s emits nothing', (value) => {
  expect(appendedSubagentPrompt('APPEND_SENTINEL', { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: value })).toBe('');
});

test('[G2-08] enabled append gate without an option emits nothing', () => {
  expect(appendedSubagentPrompt(undefined, { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: '1' })).toBe('');
});
