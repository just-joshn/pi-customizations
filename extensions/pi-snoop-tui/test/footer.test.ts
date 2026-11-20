import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { createSession, createTui, footerData, loadSnoop, loadTheme, mountFooter, plain, ROOT_PATH, THEME_NAMES } from './harness.ts';

const WIDE = 120;
const GUTTER_WIDTH = 100;
const SWEEP_WIDTH = 160;
const MIN_GUTTER_WIDTH = 3;
const ONE_COLUMN = 1;
const ROOM_FOR_WORKSPACE = 6;
const LONG_STATUS_WIDTH = 50;
const LONG_STATUS = 'a very long status message that cannot fit';
const DEFAULT_USAGE = 18;
const NEXT_USAGE = 20;
const LATER_USAGE = 50;
const LAST_USAGE = 60;
const WARNING_PERCENT = 71;
const ERROR_PERCENT = 91;
const SEGMENTS = [
  ['thinking', 'medium'],
  ['branch', 'main'],
  ['statuses', 'status 漢字🙂'],
  ['model', 'claude-test'],
  ['ctx', 'ctx 18%'],
  ['workspace', 'workspace'],
] as const;
const theme = loadTheme('snoop-dark');

function populated(host = loadSnoop()) {
  const session = createSession(theme);
  const mounted = mountFooter(host, session);
  mounted.data.setStatus('task', 'status 漢字🙂');
  return { host, session, ...mounted };
}
const line = (footer: { render(width: number): string[] }, width = WIDE) => plain(footer.render(width)[0] ?? '');

describe('footer content', () => {
  test.for(THEME_NAMES)('shows workspace and branch on the left, then status, model, thinking and context on the right in %s', (name) => {
    const session = createSession(loadTheme(name));
    const { footer, data } = mountFooter(loadSnoop(), session);
    data.setStatus('task', 'busy');
    expect(line(footer)).toMatch(/^ workspace · main {2,}busy · claude-test · medium {3}ctx 18%$/);
  });

  test('is a single line at every width and never wider than the terminal', () => {
    const { footer } = populated();
    for (let width = 0; width < SWEEP_WIDTH; width++) {
      const lines = footer.render(width);
      expect(lines).toHaveLength(1);
      expect(visibleWidth(lines[0] ?? '')).toBeLessThanOrEqual(width);
    }
  });

  test('drops segments in priority order as the terminal narrows: thinking, branch, status, model, context, then workspace', () => {
    const { footer } = populated();
    const narrowestShown = Object.fromEntries(SEGMENTS.map(([id, text]) => [id, Array.from({ length: WIDE }, (_, i) => i).find((width) => line(footer, width).includes(text)) ?? -1]));
    const order = SEGMENTS.map(([id]) => narrowestShown[id] ?? -1);
    expect(order).toEqual(order.toSorted((a, b) => b - a));
    expect(new Set(order).size).toBe(SEGMENTS.length);
    expect(narrowestShown['workspace']).toBeGreaterThan(0);
  });

  test('keeps the workspace name, shortened with an ellipsis, down to one column', () => {
    const { footer } = populated();
    expect(line(footer, ONE_COLUMN)).toBe('…');
    expect(line(footer, 0)).toBe('');
    expect(line(footer, ROOM_FOR_WORKSPACE)).toBe(' wor…');
  });

  test('shortens a long status with an ellipsis before dropping the model', () => {
    const { footer, data } = populated();
    data.setStatus('task', LONG_STATUS);
    expect(line(footer, LONG_STATUS_WIDTH)).toMatch(/…/);
  });

  test('reads the git branch and extension statuses live, sorted and on one line', () => {
    const { footer, data } = populated();
    data.setBranch('feature/cache');
    expect(line(footer)).toContain('feature/cache');
    data.clearStatuses();
    data.setStatus('z', 'last\nline');
    data.setStatus('a', '\x1b[31mtext');
    data.setStatus('b', '  ');
    expect(line(footer)).toContain('text · last line');
    data.setBranch(null);
    expect(line(footer)).not.toContain('main');
  });
});

describe('footer for sparse sessions', () => {
  test('leaves out the model name and thinking level a session lacks, and shows an unknown context as a question mark', () => {
    const session = createSession(theme, { model: undefined, usagePercent: undefined });
    const { footer, data } = mountFooter(loadSnoop(), session);
    data.setBranch(null);
    expect(line(footer)).toMatch(/^ workspace {2,}ctx \?$/);
  });

  test('omits the thinking level for a model that does not reason', () => {
    const session = createSession(theme, { model: { id: 'plain-model', reasoning: false } });
    const { footer } = mountFooter(loadSnoop(), session);
    expect(line(footer)).toContain('plain-model');
    expect(line(footer)).not.toContain('medium');
  });

  test('names a session in the filesystem root by its path', () => {
    const { footer } = mountFooter(loadSnoop(), createSession(theme, { cwd: ROOT_PATH }));
    expect(line(footer)).toMatch(/^ \/ /);
  });
});

describe('footer colors and gutter', () => {
  test.for([
    [WARNING_PERCENT, 'warning'],
    [ERROR_PERCENT, 'error'],
    [DEFAULT_USAGE, 'accent'],
  ] as const)('colors context usage %i%% with the %s color', ([percent, color]) => {
    const session = createSession(theme, { usagePercent: percent });
    const { footer } = mountFooter(loadSnoop(), session);
    expect(footer.render(WIDE)[0]).toContain(theme.fg(color, `ctx ${percent}%`));
  });

  test('colors an unknown context usage dim', () => {
    const { footer } = mountFooter(loadSnoop(), createSession(theme, { usagePercent: undefined }));
    expect(footer.render(WIDE)[0]).toContain(theme.fg('dim', 'ctx ?'));
  });

  test('keeps the same gutter on both sides and honours the outputPad setting', () => {
    for (const outputPad of [0, 1, 2]) {
      const { footer } = mountFooter(loadSnoop({ outputPad }), createSession(theme));
      const text = line(footer, GUTTER_WIDTH);
      expect(text.startsWith(`${' '.repeat(outputPad)}workspace`)).toBe(true);
      expect(text.endsWith('ctx 18%')).toBe(true);
      expect(visibleWidth(text)).toBe(GUTTER_WIDTH - outputPad);
    }
    const { footer } = mountFooter(loadSnoop({ outputPad: 1 }), createSession(theme));
    for (let width = MIN_GUTTER_WIDTH; width < WIDE; width++) {
      const fitted = line(footer, width);
      expect(fitted.startsWith(' ')).toBe(true);
      expect(visibleWidth(fitted)).toBeLessThanOrEqual(width - 1);
    }
  });

  test('uses a one-column gutter when no outputPad setting exists', () => {
    const { footer } = mountFooter(loadSnoop({}), createSession(theme));
    expect(line(footer, GUTTER_WIDTH).startsWith(' workspace')).toBe(true);
  });

  test('repaints identically after Pi invalidates it', () => {
    const { footer } = populated();
    const first = footer.render(WIDE);
    expect(footer.render(WIDE)).toEqual(first);
    footer.invalidate();
    expect(footer.render(WIDE)).toEqual(first);
  });
});

describe('footer lifecycle', () => {
  test('installs nothing and reads nothing when Pi has no UI', () => {
    const host = loadSnoop();
    const session = createSession(theme, { hasUI: false });
    host.fire('session_start', session.ctx);
    host.fire('turn_end', session.ctx);
    expect(session.ui.setFooter).not.toHaveBeenCalled();
  });

  test('asks Pi to repaint only when something the footer shows changed', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    const { tui, footer } = mountFooter(host, session);
    for (const event of ['model_select', 'thinking_level_select', 'turn_end', 'agent_end', 'session_compact', 'session_tree']) host.fire(event, session.ctx);
    expect(tui.requestRender).not.toHaveBeenCalled();
    session.setUsage(NEXT_USAGE);
    host.fire('turn_end', session.ctx);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
    expect(line(footer)).toContain(`ctx ${NEXT_USAGE}%`);
    host.setThinking('high');
    host.fire('thinking_level_select', session.ctx);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);
    expect(line(footer)).toContain('high');
    session.setModel({ id: 'other-model', reasoning: true });
    host.fire('model_select', session.ctx);
    expect(line(footer)).toContain('other-model');
    session.setUsage(undefined);
    host.fire('agent_end', session.ctx);
    expect(line(footer)).toContain('ctx ?');
  });
});

describe('footer repaint requests', () => {
  test('does not refresh from events in a session without UI', () => {
    const host = loadSnoop();
    const ui = createSession(theme);
    const { tui } = mountFooter(host, ui);
    const headless = createSession(theme, { hasUI: false, usagePercent: 99 });
    host.fire('turn_end', headless.ctx);
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  test('stops asking Pi to repaint once the footer is disposed', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    const { tui, footer } = mountFooter(host, session);
    footer.dispose?.();
    session.setUsage(LATER_USAGE);
    host.fire('agent_end', session.ctx);
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  test('a replaced footer being disposed late does not silence its successor', () => {
    const host = loadSnoop();
    const session = createSession(theme);
    const first = mountFooter(host, session, createTui());
    const second = mountFooter(host, session, createTui(), footerData());
    first.footer.dispose?.();
    session.setUsage(LAST_USAGE);
    host.fire('turn_end', session.ctx);
    expect(second.tui.requestRender).toHaveBeenCalledTimes(1);
    expect(first.tui.requestRender).not.toHaveBeenCalled();
  });
});
