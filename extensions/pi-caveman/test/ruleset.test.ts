import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadRuleset, reinforcement, rulesetSection, thesisLine } from '../src/ruleset.ts';

let empty = '';
beforeEach(() => {
  empty = mkdtempSync(join(tmpdir(), 'caveman-skills-'));
});
afterEach(() => {
  rmSync(empty, { recursive: true, force: true });
});

describe('shipped skills', () => {
  test.for([
    { mode: 'caveman', expected: 'Respond terse like smart caveman. All technical substance stay. Only fluff die.' },
    // biome-ignore lint/security/noSecrets: Classical Chinese thesis line, not a credential
    { mode: 'megacave', expected: '以文言答。技術之實皆存，唯贅言去之。' },
  ] as const)('$mode thesis comes from its SKILL.md', ({ mode, expected }) => {
    expect(thesisLine(mode)).toBe(expected);
  });

  test('the ruleset has no frontmatter', () => {
    expect(loadRuleset('ultracave')?.startsWith('# ultracave')).toBe(true);
  });

  test('the section ends with the switch line', () => {
    expect(rulesetSection('caveman').split('\n').at(-1)).toBe('Switch: /caveman, /ultracave, /megacave. Off: "stop caveman" or "normal mode".');
  });
});

describe('missing skills directory', () => {
  test('loadRuleset returns null', () => {
    expect(loadRuleset('caveman', empty)).toBe(null);
  });

  test('the thesis falls back to the built-in line', () => {
    expect(thesisLine('ultracave', empty)).toBe('Respond terse like smart caveman. All technical substance stay. Only fluff die. Then cut again.');
  });

  test('the section still carries the banner', () => {
    expect(rulesetSection('megacave', empty).split('\n')[0]).toBe('CAVEMAN MODE ACTIVE — mode: megacave');
  });

  test('the reminder names the mode', () => {
    expect(reinforcement('caveman', empty).startsWith('CAVEMAN MODE ACTIVE (caveman). Respond terse')).toBe(true);
  });
});

test('the section carries the upstream auto-clarity and exactness rules', () => {
  const section = rulesetSection('caveman');

  const rules = [
    'Never drop not/never/no/only/except. Numbers and units exact.',
    'Code blocks unchanged. Commands, paths, API names exact. Errors quoted exact, shortest decisive line only.',
    '1. Security warning.',
    '2. Irreversible action. Confirm in full sentences first.',
    '4. User confused or repeats the question.',
  ];
  expect(rules.map((rule) => section.includes(rule))).toStrictEqual([true, true, true, true, true]);
});
