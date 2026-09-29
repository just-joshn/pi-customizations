import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent';
import { VERSION } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { installCommands } from '../src/commands/register.ts';
import { type CommandEntry, findCommand, helpLines, porcelainFiles, TUI_COMMANDS, totalUsage } from '../src/commands/registry.ts';
import { createSession, type TuiSession } from '../src/state.ts';
import { makeTheme } from './theme.ts';

const ESC = '\x1b';
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

interface RegisteredCommand {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface Notified {
  message: string;
  type: string;
}

interface FakeCtx {
  ctx: ExtensionCommandContext;
  notified: Notified[];
  shutdowns: number[];
}

function fakeCtx(opts: { entries?: unknown[]; sessionFile?: string; theme?: Theme; cwd?: string } = {}): FakeCtx {
  const notified: Notified[] = [];
  const shutdowns: number[] = [];
  const ctx = {
    cwd: opts.cwd ?? '/tmp/repo',
    ui: {
      notify: (message: string, type = 'info') => notified.push({ message, type }),
      theme: opts.theme,
    },
    model: { name: 'claude-opus-5-5-max', provider: 'anthropic' },
    sessionManager: {
      getBranch: () => opts.entries ?? [],
      getSessionFile: () => opts.sessionFile,
    },
    shutdown: () => shutdowns.push(1),
  } as unknown as ExtensionCommandContext;
  return { ctx, notified, shutdowns };
}

function captureCommands(session: TuiSession): Map<string, RegisteredCommand> {
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    registerCommand: (name: string, options: RegisteredCommand) => commands.set(name, options),
  } as unknown as ExtensionAPI;
  installCommands(pi, session);
  return commands;
}

function entry(id: string): CommandEntry {
  const found = TUI_COMMANDS.find((c) => c.id === id);
  expect(found).toBeDefined();
  if (!found) throw new Error(`command ${id} not found`);
  return found;
}

describe('command registry', () => {
  it('keeps the reference CLI ids and aliases', () => {
    expect(findCommand('model')?.status).toBe('mapped');
    expect(findCommand('resume')?.aliases).toEqual(['continue', 'recent', 'history']);
    expect(findCommand('fork')?.aliases).toEqual(['duplicate', 'clone', 'branch']);
    expect(findCommand('copy')?.aliases).toEqual(['clipboard', 'paste']);
    expect(findCommand('compact')?.id).toBe('summarize');
    expect(findCommand('name')?.id).toBe('rename');
    expect(findCommand('new')?.id).toBe('clear');
    expect(findCommand('auto-run')?.id).toBe('run-everything');
    expect(findCommand('smart-auto')?.id).toBe('auto-review');
    expect(findCommand('zen')?.id).toBe('zen-mode');
    expect(findCommand('thoughts')?.id).toBe('show-thinking');
    expect(findCommand('MODEL')?.id).toBe('model');
    expect(findCommand('nope')).toBeUndefined();
  });

  it('maps pi-owned ids to pi builtins', () => {
    const mapped = ['model', 'resume', 'fork', 'quit', 'rewind', 'debug', 'summarize', 'clear', 'rename', 'config', 'logout'];
    for (const id of mapped) {
      expect(entry(id).status).toBe('mapped');
      expect(entry(id).reason).toBeDefined();
      expect(entry(id).handler).toBeUndefined();
    }
  });

  it('implements the the reference CLI-parity commands', () => {
    const implemented = ['run-everything', 'auto-review', 'plan', 'ask', 'zen-mode', 'vim', 'show-thinking', 'about', 'help', 'changes', 'exit', 'jobs', 'usage', 'copy-conversation-id'];
    for (const id of implemented) {
      expect(entry(id).status).toBe('implemented');
      expect(typeof entry(id).handler).toBe('function');
    }
  });

  it('marks backend-only commands unmet with a reason', () => {
    const unmet = ['goal', 'detach', 'update', 'max-mode', 'fast', 'feedback', 'open', 'team', 'mcp', 'plugin', 'sandbox', 'bedrock', 'btw'];
    for (const id of unmet) {
      expect(entry(id).status).toBe('unmet');
      const r = entry(id).reason;
      expect(Boolean(r && r.length > 0)).toBe(true);
      expect(entry(id).handler).toBeUndefined();
    }
  });

  it('matches the reference CLI descriptions verbatim', () => {
    expect(entry('model').description).toBe('Select model (Tab to edit)');
    expect(entry('run-everything').description).toBe('Toggle Run Everything (currently …)');
    expect(entry('ask').description).toBe('Toggle ask mode (Q&A, read-only; no edits or command execution)');
    expect(entry('bedrock').description).toBe('Configure Bedrock in-chat (configure/[use-team-role/]status/disable/clear)');
    expect(entry('summarize').description).toBe('Summarize the conversation to reduce context');
    expect(entry('changes').description).toBe('Review changes — Conversation, Unstaged, Staged (when present), and Committed');
  });
});

describe('commands', () => {
  it('/help prints the Commands header, one line per entry, and the hint', async () => {
    const theme = await makeTheme();
    const state = createSession();
    const fake = fakeCtx({ theme });
    const commands = captureCommands(state);
    await commands.get('help')?.handler('', fake.ctx);
    expect(fake.notified.length).toBe(1);
    const lines = strip(fake.notified[0]?.message).split('\n');
    expect(lines[0]).toBe('Commands:');
    expect(lines.at(-1)).toBe('Hint: /help <command> for details');
    expect(lines.includes('/run-everything - Toggle Run Everything (currently …)')).toBe(true);
    expect(lines.includes('/model - Select model (Tab to edit) (pi builtin)')).toBe(true);
    expect(lines.includes('/goal - Start a durable goal that continues while idle (unavailable in pi)')).toBe(true);
    expect(lines.length).toBe(TUI_COMMANDS.length + 2);
  });

  it('helpLines styles the header and hint through the theme', async () => {
    const theme = await makeTheme();
    const lines = helpLines(theme);
    expect(lines[0]?.includes('Commands:')).toBe(true);
    expect(lines[0]?.includes('\x1b[')).toBe(true);
    expect(strip(lines.at(-1) ?? '').startsWith('Hint: /help')).toBe(true);
  });

  it('/run-everything toggles state.runEverything', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const first = fakeCtx();
    await commands.get('run-everything')?.handler('', first.ctx);
    expect(state.read().runEverything).toBe(true);
    expect(strip(first.notified[0]?.message)).toBe('Run Everything: ON (all commands run without approval)');
    const second = fakeCtx();
    await commands.get('run-everything')?.handler('', second.ctx);
    expect(state.read().runEverything).toBe(false);
    expect(strip(second.notified[0]?.message)).toBe('Run Everything: OFF');
  });

  it('/auto-review toggles state.autoReview', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const fake = fakeCtx();
    await commands.get('auto-review')?.handler('', fake.ctx);
    expect(state.read().autoReview).toBe(true);
    expect(fake.notified[0]?.message).toBe('Auto-review: ON');
    await commands.get('auto-review')?.handler('', fake.ctx);
    expect(state.read().autoReview).toBe(false);
    expect(fake.notified[1]?.message).toBe('Auto-review: OFF');
  });

  it('/plan sets plan mode', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const fake = fakeCtx();
    await commands.get('plan')?.handler('', fake.ctx);
    expect(state.read().mode).toBe('plan');
    expect(fake.notified[0]?.message).toBe('Plan mode enabled');
  });

  it('/ask toggles ask mode', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const fake = fakeCtx();
    await commands.get('ask')?.handler('', fake.ctx);
    expect(state.read().mode).toBe('ask');
    expect(fake.notified[0]?.message).toBe('Ask mode enabled');
    await commands.get('ask')?.handler('', fake.ctx);
    expect(state.read().mode).toBe('default');
    expect(fake.notified[1]?.message).toBe('Ask mode disabled');
  });

  it('/zen-mode and /vim toggle their state', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const fake = fakeCtx();
    await commands.get('zen-mode')?.handler('', fake.ctx);
    expect(state.read().compact).toBe(false);
    expect(fake.notified[0]?.message).toBe('Zen mode: OFF');
    await commands.get('zen-mode')?.handler('', fake.ctx);
    expect(state.read().compact).toBe(true);
    expect(fake.notified[1]?.message).toBe('Zen mode: ON');
    await commands.get('vim')?.handler('', fake.ctx);
    expect(state.read().vim).toBe('normal');
    expect(fake.notified[2]?.message).toBe('Vim keys: ON');
    await commands.get('vim')?.handler('', fake.ctx);
    expect(state.read().vim).toBe('insert');
    expect(fake.notified[3]?.message).toBe('Vim keys: OFF');
  });

  it('/about reports the pi version, model, provider, and session', async () => {
    const commands = captureCommands(createSession());
    const fake = fakeCtx({ sessionFile: '/tmp/.pi/sessions/a.jsonl' });
    await commands.get('about')?.handler('', fake.ctx);
    expect(fake.notified[0]?.message.split('\n')).toEqual([`pi v${VERSION}`, 'Model: claude-opus-5-5-max', 'Provider: anthropic', 'Session: /tmp/.pi/sessions/a.jsonl']);
  });

  it('/jobs reports no active tasks', async () => {
    const theme = await makeTheme();
    const commands = captureCommands(createSession());
    const fake = fakeCtx({ theme });
    await commands.get('jobs')?.handler('', fake.ctx);
    expect(strip(fake.notified[0]?.message)).toBe('No active tasks');
  });

  it('/changes reports a git failure when the cwd is missing', async () => {
    const commands = captureCommands(createSession());
    const fake = fakeCtx({ cwd: join(tmpdir(), `pi-tui-parity-missing-${randomUUID()}`) });
    await commands.get('changes')?.handler('', fake.ctx);
    expect(fake.notified[0]?.type).toBe('error');
    expect(fake.notified[0]?.message).toMatch(/^git status failed: /);
  });

  it('/exit shuts pi down', async () => {
    const commands = captureCommands(createSession());
    const fake = fakeCtx();
    await commands.get('exit')?.handler('', fake.ctx);
    expect(fake.shutdowns.length).toBe(1);
  });

  it('/usage totals assistant usage from the branch', async () => {
    const state = createSession();
    const entries = [
      { type: 'message', message: { role: 'assistant', usage: { input: 10, output: 5, cost: { total: 0.5 } } } },
      { type: 'message', message: { role: 'user' } },
      { type: 'message', message: { role: 'assistant', usage: { input: 1, output: 2, cost: { total: 0.25 } } } },
    ];
    const fake = fakeCtx({ entries });
    await entry('usage')?.handler?.('', fake.ctx, state);
    expect(fake.notified[0]?.message).toBe('Usage: 11 input · 7 output tokens · $0.7500');
  });

  it('/copy-conversation-id prints the session file or No session', async () => {
    const state = createSession();
    const commands = captureCommands(state);
    const withFile = fakeCtx({ sessionFile: '/tmp/.pi/sessions/a.jsonl' });
    await commands.get('copy-conversation-id')?.handler('', withFile.ctx);
    expect(withFile.notified[0]?.message).toBe('/tmp/.pi/sessions/a.jsonl');
    const withoutFile = fakeCtx();
    await commands.get('copy-conversation-id')?.handler('', withoutFile.ctx);
    expect(withoutFile.notified[0]?.message).toBe('No session');
  });

  it('installCommands registers exactly the implemented entries with the reference CLI descriptions', () => {
    const commands = captureCommands(createSession());
    const implemented = TUI_COMMANDS.filter((c) => c.status === 'implemented' && !c.registeredBy);
    expect(commands.size).toBe(implemented.length);
    expect(commands.get('run-everything')?.description).toBe('Toggle Run Everything (currently …)');
    expect(commands.has('model')).toBe(false);
    expect(commands.has('goal')).toBe(false);
    expect(commands.has('commit')).toBe(false);
  });
});

describe('usage and porcelain helpers', () => {
  it('totalUsage sums input, output, and cost', () => {
    const totals = totalUsage([
      { type: 'message', message: { role: 'assistant', usage: { input: 10, output: 5, cost: { total: 0.5 } } } },
      { type: 'message', message: { role: 'user' } },
      { type: 'message', message: { role: 'assistant', usage: { input: 1, output: 2, cost: { total: 0.25 } } } },
      { type: 'model_change' },
    ]);
    expect(totals).toEqual({ input: 11, output: 7, cost: 0.75 });
    expect(totalUsage([])).toEqual({ input: 0, output: 0, cost: 0 });
  });

  it('porcelainFiles trims and drops blank lines', () => {
    expect(porcelainFiles(' M a.ts\n?? b.ts\n\nA  c.ts\n')).toEqual(['M a.ts', '?? b.ts', 'A  c.ts']);
    expect(porcelainFiles('')).toEqual([]);
  });
});
