import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import caveman from '../src/index.ts';

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

function harness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const entries: { type: string; customType: string; data: unknown; timestamp: string }[] = [];
  const messages: { customType: string; content: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const notices: string[] = [];
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    registerTool: () => undefined,
    appendEntry: (customType: string, data: unknown) => entries.push({ type: 'custom', customType, data, timestamp: new Date().toISOString() }),
    sendMessage: async (message: { customType: string; content: string }) => {
      messages.push(message);
    },
  };
  const ctx = {
    cwd: process.cwd(),
    ui: { setStatus: (_key: string, text: string | undefined) => statuses.push(text), notify: (text: string) => notices.push(text), theme: { fg: (_c: string, text: string) => text } },
    sessionManager: { getBranch: () => entries, getSessionId: () => 'sid', getSessionFile: () => undefined },
  };
  caveman(pi as unknown as ExtensionAPI);
  const emit = (name: string, event: Record<string, unknown>) => (handlers.get(name) ?? []).map((handler) => handler({ type: name, ...event }, ctx as unknown as ExtensionContext));
  const command = (name: string, args = '') => commands.get(name)?.handler(args, ctx as unknown as ExtensionCommandContext);
  const turn = (prompt: string) => {
    const sections: Record<string, string> = {};
    const [result] = emit('before_agent_start', { prompt, systemPromptOptions: { sections } });
    return { sections, result };
  };
  return { emit, command, turn, entries, messages, statuses, notices, commands };
}

beforeEach(() => {
  vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'caveman');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session lifecycle', () => {
  test('a fresh session starts in the default mode', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    expect([h.entries.map((e) => e.data), h.statuses.at(-1)]).toStrictEqual([[{ mode: 'caveman', returnTo: null }], '[CAVEMAN]']);
  });

  test('an explicit off on the branch survives a reload', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    h.emit('input', { text: 'stop caveman', source: 'interactive' });
    h.emit('session_start', { reason: 'reload' });
    expect([h.entries.length, h.statuses.at(-1)]).toStrictEqual([2, undefined]);
  });

  test('manual default starts with no badge', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = harness();
    h.emit('session_start', { reason: 'new' });
    expect(h.statuses.at(-1)).toBe(undefined);
  });
});

describe('prompt injection', () => {
  test('the active ruleset becomes a system prompt section', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    const { sections } = h.turn('hi');
    expect(sections['caveman']?.split('\n')[0]).toBe('CAVEMAN MODE ACTIVE — mode: caveman');
  });

  test('each turn carries a hidden reinforcement message', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    expect(h.turn('hi').result).toMatchObject({ message: { customType: 'caveman-context', display: false } });
  });

  test('one-shot commit mode injects no ruleset', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    const [transform] = h.emit('input', { text: '/caveman-commit fix parser', source: 'interactive' });
    expect([transform, h.turn('').sections, h.statuses.at(-1)]).toStrictEqual([{ action: 'transform', text: '/skill:caveman-commit fix parser' }, {}, '[CAVEMAN:COMMIT]']);
  });

  test('a repo default of off gates injection', () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'off');
    expect(h.turn('hi')).toStrictEqual({ sections: {}, result: undefined });
  });
});

describe('notices', () => {
  test('an unrecognized argument reaches the next turn', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
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
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    h.emit('input', { text: '/caveman commit', source: 'interactive', streamingBehavior: 'steer' });
    expect(h.turn('x').result).toBe(undefined);
  });

  test('a session switch drops a pending notice', () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'manual');
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    h.emit('input', { text: '/caveman commit', source: 'interactive' });
    h.emit('session_start', { reason: 'new' });
    expect(h.turn('x').result).toBe(undefined);
  });
});

describe('commands', () => {
  test('/ultracave switches mode and badge', async () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    await h.command('ultracave');
    expect([h.notices.at(-1), h.statuses.at(-1), h.turn('x').sections['caveman']?.split('\n')[0]]).toStrictEqual(['Caveman mode: ultracave', '[ULTRACAVE]', 'CAVEMAN MODE ACTIVE — mode: ultracave']);
  });

  test('/caveman status reports without writing an entry', async () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    await h.command('caveman', 'status');
    expect([h.notices.at(-1), h.entries.length]).toStrictEqual(['Caveman mode: caveman', 1]);
  });

  test('/caveman-stats posts a fenced report', async () => {
    const h = harness();
    h.emit('session_start', { reason: 'startup' });
    await h.command('caveman-stats', '--share');
    expect(h.messages.at(-1)).toStrictEqual({ customType: 'caveman-stats', content: '```\n🪨 No turns yet; savings unknown — caveman.sh\n```', display: true });
  });

  test('every upstream command is registered', () => {
    expect([...harness().commands.keys()].sort()).toStrictEqual(['caveman', 'caveman-help', 'caveman-stats', 'megacave', 'ultracave']);
  });
});
