import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import type { DefaultMode } from '../src/modes.ts';
import { type ModeChange, parseModeChange } from '../src/parse.ts';

interface CorpusCase {
  readonly id: number;
  readonly prompt: string;
  readonly expected: ModeChange | null;
  readonly current?: ModeChange | null;
  readonly known_failing: boolean;
}

const corpus: CorpusCase[] = JSON.parse(readFileSync(new URL('./upstream/mode-activation-cases.json', import.meta.url), 'utf8'));
const withDefault = (mode: DefaultMode) => ({ getDefaultMode: () => mode });

describe('upstream mode-activation corpus', () => {
  test.for(corpus)('case #$id: $prompt', (tc) => {
    expect(parseModeChange(tc.prompt, withDefault('caveman'))).toStrictEqual(tc.known_failing ? (tc.current ?? null) : tc.expected);
  });
});

describe('slash commands', () => {
  test.for([
    { prompt: '/caveman', expected: { action: 'set', mode: 'caveman' } },
    { prompt: '/caveman ultra', expected: { action: 'set', mode: 'ultracave' } },
    { prompt: '/caveman wenyan-lite', expected: { action: 'set', mode: 'megacave' } },
    { prompt: '/caveman "ultra";', expected: { action: 'set', mode: 'ultracave' } },
    { prompt: '/caveman off', expected: { action: 'clear' } },
    { prompt: '/caveman stop', expected: { action: 'clear' } },
    { prompt: '/caveman status', expected: { action: 'status' } },
    { prompt: '/caveman ?', expected: { action: 'unresolved' } },
    { prompt: '/caveman bogus', expected: { action: 'unresolved' } },
    { prompt: '/caveman commit', expected: { action: 'unresolved', independentMode: 'commit' } },
    { prompt: '/ultracave', expected: { action: 'set', mode: 'ultracave' } },
    { prompt: '/megacave off', expected: { action: 'clear' } },
    { prompt: '/caveman:megacave status', expected: { action: 'status' } },
    { prompt: '/caveman-commit fix the parser', expected: { action: 'set', mode: 'commit' } },
    { prompt: '/caveman:caveman-review', expected: { action: 'set', mode: 'review' } },
    { prompt: '/caveman-compress AGENTS.md', expected: { action: 'set', mode: 'compress' } },
  ] as const)('$prompt', ({ prompt, expected }) => {
    expect(parseModeChange(prompt, withDefault('caveman'))).toStrictEqual(expected);
  });

  test('a foreign slash command never fires natural-language triggers', () => {
    expect(parseModeChange('/review stop caveman', withDefault('caveman'))).toBe(null);
  });
});

describe('configured default', () => {
  test('bare /caveman activates caveman under the manual policy', () => {
    expect(parseModeChange('/caveman', withDefault('manual'))).toStrictEqual({ action: 'set', mode: 'caveman' });
  });

  test('bare /caveman clears when the default is off', () => {
    expect(parseModeChange('/caveman', withDefault('off'))).toStrictEqual({ action: 'clear' });
  });

  test('natural-language activation is a no-op when the default is off', () => {
    expect(parseModeChange('talk like caveman', withDefault('off'))).toBe(null);
  });

  test('natural-language activation uses the configured mode', () => {
    expect(parseModeChange('activate caveman', withDefault('ultracave'))).toStrictEqual({ action: 'set', mode: 'ultracave' });
  });
});

describe('natural language', () => {
  test.for([
    { prompt: 'turn caveman mode off', expected: { action: 'clear' } },
    { prompt: "don't stop caveman", expected: { action: 'clear' } },
    { prompt: "don't use vim, activate caveman", expected: { action: 'set', mode: 'caveman' } },
    { prompt: "don't want you to use caveman", expected: null },
    { prompt: 'how do I exit vim normal mode', expected: null },
    { prompt: 'what is caveman mode?', expected: null },
    { prompt: 'be brief in the summary', expected: null },
    { prompt: 'Please\nbe terse', expected: { action: 'set', mode: 'caveman' } },
    { prompt: 'the card says "stop caveman" here', expected: null },
    { prompt: '', expected: null },
  ] as const)('$prompt', ({ prompt, expected }) => {
    expect(parseModeChange(prompt, withDefault('caveman'))).toStrictEqual(expected);
  });
});
