import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { harness } from './support/harness.ts';

beforeEach(() => {
  vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'caveman');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const started = (reason = 'startup') => {
  const h = harness();
  h.emit('session_start', { reason });
  return h;
};

describe('session lifecycle', () => {
  test('a fresh session records the default mode', () => {
    expect(started().entries).toMatchObject([{ customType: 'caveman-mode', data: { mode: 'caveman', returnTo: null } }]);
  });

  test('a fresh session shows the caveman badge', () => {
    expect(started().statuses.at(-1)).toBe('[CAVEMAN]');
  });

  test('an explicit off survives a reload', () => {
    const h = started();
    h.emit('input', { text: 'stop caveman', source: 'interactive' });
    h.emit('session_start', { reason: 'reload' });
    expect(h.statuses.at(-1)).toBe(undefined);
  });

  test('a reload writes no extra entry', () => {
    const h = started();
    h.emit('input', { text: 'stop caveman', source: 'interactive' });
    h.emit('session_start', { reason: 'reload' });
    expect(h.entries).toHaveLength(2);
  });

  test('tree navigation restores the stored mode', () => {
    const h = started();
    h.emit('input', { text: 'talk like caveman', source: 'interactive' });
    h.emit('session_tree', { newLeafId: null, oldLeafId: null });
    expect(h.statuses.at(-1)).toBe('[CAVEMAN]');
  });

  test('manual default starts with no badge', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    expect(started('new').statuses.at(-1)).toBe(undefined);
  });
});

describe('prompt injection', () => {
  test('the active ruleset becomes a system prompt section', () => {
    expect(started().turn('hi').sections['caveman']?.split('\n')[0]).toBe('CAVEMAN MODE ACTIVE — mode: caveman');
  });

  test('each turn carries a hidden reinforcement message', () => {
    expect(started().turn('hi').result).toMatchObject({ message: { customType: 'caveman-context', display: false } });
  });

  test('a repo default of off gates injection', () => {
    const h = started();
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'off');
    expect(h.turn('hi')).toStrictEqual({ sections: {}, result: undefined });
  });

  test('a scheduled task prompt is left alone', () => {
    const h = started();
    expect(h.emit('input', { text: '<scheduled-task name="x"> stop caveman', source: 'interactive' })).toStrictEqual([{ action: 'continue' }]);
  });
});

describe('one-shot skills', () => {
  test('/caveman-commit is rewritten to its skill', () => {
    expect(started().emit('input', { text: '/caveman-commit fix parser', source: 'interactive' })).toStrictEqual([{ action: 'transform', text: '/skill:caveman-commit fix parser' }]);
  });

  test('a namespaced one-shot is rewritten too', () => {
    expect(started().emit('input', { text: '/caveman:caveman-review', source: 'interactive' })).toStrictEqual([{ action: 'transform', text: '/skill:caveman-review' }]);
  });

  test('commit mode injects no ruleset', () => {
    const h = started();
    h.emit('input', { text: '/caveman-commit', source: 'interactive' });
    expect(h.turn('').sections).toStrictEqual({});
  });

  test('commit mode shows its badge', () => {
    const h = started();
    h.emit('input', { text: '/caveman-commit', source: 'interactive' });
    expect(h.statuses.at(-1)).toBe('[CAVEMAN:COMMIT]');
  });
});

describe('notices', () => {
  test('an unrecognized argument reaches the next turn', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = started();
    h.emit('input', { text: '/caveman commit', source: 'interactive' });
    expect(h.turn('x').result).toStrictEqual({
      message: {
        customType: 'caveman-context',
        content: 'Tell the user commit mode is set with its own command, /caveman-commit, not /caveman commit. The mode is unchanged.',
        display: false,
      },
    });
  });

  test('a queued steer message drops its notice', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = started();
    h.emit('input', { text: '/caveman commit', source: 'interactive', streamingBehavior: 'steer' });
    expect(h.turn('x').result).toBe(undefined);
  });

  test('a session switch drops a pending notice', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = started();
    h.emit('input', { text: '/caveman commit', source: 'interactive' });
    h.emit('session_start', { reason: 'new' });
    expect(h.turn('x').result).toBe(undefined);
  });
});

describe('status typed as text', () => {
  test('asks the model to relay the status without a reminder', () => {
    const h = started();
    h.emit('input', { text: '/caveman:caveman status', source: 'interactive' });
    expect(h.turn('x').result).toStrictEqual({ message: { customType: 'caveman-context', content: 'Report this status verbatim without changing mode: Caveman mode: caveman', display: false } });
  });
});

describe('registration', () => {
  test('every upstream command is registered', () => {
    expect(harness().commandNames()).toStrictEqual(['caveman', 'caveman-help', 'caveman-stats', 'megacave', 'ultracave']);
  });

  test('both tools are registered', () => {
    expect(harness().toolNames()).toStrictEqual(['cavecrew', 'caveman_compress']);
  });
});
