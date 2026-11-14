import { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { workingIndicator } from '../../extensions/adapters/working.ts';
import reference from '../../themes/claude-default-dark.json' with { type: 'json' };

const theme = (name: string) => new Theme(reference.colors, reference.colors, 'truecolor', { name, appearance: 'dark' });

function setup() {
  const calls: string[] = [];
  const ctx = {
    mode: 'tui' as const,
    ui: {
      theme: theme('claude-default-dark'),
      setWorkingIndicator: (options?: { frames: string[] }) => calls.push(options ? 'indicator' : 'indicator-reset'),
      setWorkingMessage: (message?: string) => calls.push(message ? 'message' : 'message-reset'),
    },
  };
  return { calls, ctx, update: workingIndicator() };
}

describe('working indicator', () => {
  test('a new turn does not restart an indicator that is already applied', () => {
    const { calls, ctx, update } = setup();
    update('start', ctx);
    update('turn', ctx);
    update('turn', ctx);
    expect(calls).toEqual(['indicator', 'message']);
  });

  test('a turn after switching themes resets the indicator once', () => {
    const { calls, ctx, update } = setup();
    update('start', ctx);
    ctx.ui.theme = theme('dark');
    update('turn', ctx);
    update('turn', ctx);
    expect(calls).toEqual(['indicator', 'message', 'indicator-reset', 'message-reset']);
  });

  test('a start event reapplies, since Pi may have reset extension UI', () => {
    const { calls, ctx, update } = setup();
    update('start', ctx);
    update('start', ctx);
    expect(calls).toEqual(['indicator', 'message', 'indicator', 'message']);
  });

  test('stays inert outside the TUI and under other themes', () => {
    const { calls, ctx, update } = setup();
    update('start', { ...ctx, mode: 'print' });
    ctx.ui.theme = theme('dark');
    update('start', ctx);
    update('turn', ctx);
    expect(calls).toEqual([]);
  });
});
