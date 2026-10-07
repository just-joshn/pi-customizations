import { describe, expect, test } from 'vitest';
import type { DefaultMode } from '../src/modes.ts';
import { parseModeChange } from '../src/parse.ts';
import { applyPrompt, initialState, MODE_ENTRY, type ModeState, OFF, stateFromEntries, transitionsFromEntries } from '../src/state.ts';

function run(prompts: readonly string[], start: ModeState = OFF, defaultMode: DefaultMode = 'caveman'): ModeState {
  return prompts.reduce((state, prompt) => {
    const outcome = applyPrompt(state, parseModeChange(prompt, { getDefaultMode: () => defaultMode }));
    return outcome.kind === 'applied' ? outcome.next : state;
  }, start);
}

const entry = (data: unknown, timestamp: string) => ({ type: 'custom', customType: MODE_ENTRY, data, timestamp });

describe('one-shot modes', () => {
  test('commit returns to the displaced prose mode on the next prompt', () => {
    expect(run(['/ultracave', '/caveman-commit', 'thanks'])).toStrictEqual({ mode: 'ultracave', returnTo: null });
  });

  test('commit stays active for the turn it was invoked', () => {
    expect(run(['/caveman', '/caveman-commit'])).toStrictEqual({ mode: 'commit', returnTo: 'caveman' });
  });

  test('chained one-shots keep the original return target', () => {
    expect(run(['/megacave', '/caveman-commit', '/caveman-review', 'ok'])).toStrictEqual({ mode: 'megacave', returnTo: null });
  });

  test('a one-shot started while off returns to off', () => {
    expect(run(['stop caveman', '/caveman-review', 'next'])).toStrictEqual(OFF);
  });

  test('an unresolved argument still consumes the pending restore', () => {
    expect(run(['/caveman', '/caveman-commit', '/caveman bogus'])).toStrictEqual({ mode: 'caveman', returnTo: null });
  });
});

describe('applyPrompt', () => {
  test('status reports without changing state', () => {
    expect(applyPrompt({ mode: 'commit', returnTo: 'caveman' }, { action: 'status' })).toStrictEqual({ kind: 'status', report: 'Caveman mode: commit' });
  });

  test('status reports off when inactive', () => {
    expect(applyPrompt(OFF, { action: 'status' })).toStrictEqual({ kind: 'status', report: 'Caveman mode: off' });
  });

  test('independent mode via /caveman names its own command', () => {
    expect(applyPrompt(OFF, { action: 'unresolved', independentMode: 'review' })).toStrictEqual({
      kind: 'applied',
      next: OFF,
      notice: 'Tell the user review mode is set with its own command, /caveman-review, not /caveman review. The mode is unchanged.',
    });
  });

  test('explicit off survives an ordinary prompt', () => {
    expect(run(['/caveman', 'stop caveman', 'refactor this'])).toStrictEqual(OFF);
  });
});

describe('initialState', () => {
  test.for([
    { mode: 'caveman', expected: { mode: 'caveman', returnTo: null } },
    { mode: 'ultracave', expected: { mode: 'ultracave', returnTo: null } },
    { mode: 'manual', expected: OFF },
    { mode: 'off', expected: OFF },
  ] as const)('$mode', ({ mode, expected }) => {
    expect(initialState(mode)).toStrictEqual(expected);
  });
});

describe('session entries', () => {
  test('the last valid entry on the branch wins', () => {
    const entries = [entry({ mode: 'caveman', returnTo: null }, '2026-01-01T00:00:00Z'), entry({ mode: 'ultra' }, '2026-01-01T00:01:00Z'), entry({ mode: 'bogus' }, '2026-01-01T00:02:00Z')];
    expect(stateFromEntries(entries)).toStrictEqual({ mode: 'ultracave', returnTo: null });
  });

  test('a branch without caveman entries has no stored state', () => {
    expect(stateFromEntries([{ type: 'message', timestamp: '2026-01-01T00:00:00Z' }])).toBe(null);
  });

  test('transitions skip repeated modes', () => {
    const entries = [
      entry({ mode: 'caveman' }, '2026-01-01T00:00:00Z'),
      entry({ mode: 'commit', returnTo: 'caveman' }, '2026-01-01T00:01:00Z'),
      entry({ mode: 'caveman' }, '2026-01-01T00:02:00Z'),
      entry({ mode: 'caveman' }, '2026-01-01T00:03:00Z'),
      entry({ mode: 'off' }, '2026-01-01T00:04:00Z'),
    ];
    expect(transitionsFromEntries(entries)).toStrictEqual([
      { ts: Date.parse('2026-01-01T00:00:00Z'), mode: 'caveman', prev: null },
      { ts: Date.parse('2026-01-01T00:01:00Z'), mode: 'commit', prev: 'caveman' },
      { ts: Date.parse('2026-01-01T00:02:00Z'), mode: 'caveman', prev: 'commit' },
      { ts: Date.parse('2026-01-01T00:04:00Z'), mode: null, prev: 'caveman' },
    ]);
  });
});
