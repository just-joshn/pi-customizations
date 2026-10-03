import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { type ClonePorts, inChatFiles, type LintSessionPorts, type RepairDeps, runLintCommand, runTestCommand } from '../src/commands.ts';
import type { Linter } from '../src/linter.ts';
import type { CmdRunIo } from '../src/test-run.ts';

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistantEntry(toolCalls: ReadonlyArray<{ name: string; path: string }>): SessionEntry {
  return {
    type: 'message',
    id: 'e1',
    parentId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'test-model',
      usage: USAGE,
      stopReason: 'stop',
      timestamp: 0,
      content: toolCalls.map((call, index) => ({
        type: 'toolCall' as const,
        id: `call-${index}`,
        name: call.name,
        arguments: { path: call.path },
      })),
    },
  };
}

function entryWithType(entryType: string): SessionEntry {
  return { type: entryType, id: 'e2', parentId: null, timestamp: '2026-01-01T00:00:00.000Z' } as unknown as SessionEntry;
}

describe('inChatFiles', () => {
  test('collects edited and written paths in first-seen order', () => {
    const branch = [
      entryWithType('custom'),
      assistantEntry([
        { name: 'read', path: '/repo/ignored.py' },
        { name: 'edit', path: '/repo/src/a.py' },
        { name: 'write', path: '/repo/b.py' },
      ]),
      assistantEntry([{ name: 'edit', path: '/repo/src/a.py' }]),
    ];
    expect(inChatFiles('/repo', branch)).toEqual(['/repo/src/a.py', '/repo/b.py']);
  });

  test('resolves relative tool paths against the working directory', () => {
    const branch = [assistantEntry([{ name: 'edit', path: 'src/rel.py' }])];
    expect(inChatFiles('/repo', branch)).toEqual(['/repo/src/rel.py']);
  });

  test('ignores tool calls without a string path', () => {
    const branch = [
      {
        type: 'message',
        id: 'e3',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'test-model',
          usage: USAGE,
          stopReason: 'stop',
          timestamp: 0,
          content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }],
        },
      } as unknown as SessionEntry,
    ];
    expect(inChatFiles('/repo', branch).length).toBe(0);
  });
});

describe('runLintCommand', () => {
  interface LintFlow {
    readonly deps: RepairDeps;
    readonly session: LintSessionPorts;
    readonly order: string[];
  }

  function makeLintDeps(order: string[], answers: boolean[], dirty: readonly string[]): RepairDeps {
    return {
      pi: {
        sendUserMessage: async (content) => {
          order.push(`send ${String(content)}`);
        },
      },
      linter: {
        lint: async (fname: string) => {
          order.push(`lint ${fname}`);
          return `errors ${fname}`;
        },
      } as unknown as Linter,
      io: {
        output: (message) => order.push(`output ${message}`),
        warning: (message) => order.push(`warning ${message}`),
        error: (message) => order.push(`error ${message}`),
      },
      confirm: async (question) => {
        order.push(`confirm ${question}`);
        return answers.shift() ?? false;
      },
      cmdRunIo: { output: () => undefined, confirm: async () => false, runShell: async () => [1, ''] },
      git: {
        exec: async (args) => (args[0] === 'rev-parse' ? { code: 0, stdout: '/repo\n' } : { code: 0, stdout: `${dirty.join('\n')}\n` }),
      },
      appendOutputEntry: () => undefined,
      testCmd: undefined,
    };
  }

  function makeLintSession(order: string[], insideAnswers: boolean[]): LintSessionPorts {
    return {
      cwd: '/repo',
      branch: [],
      waitForIdle: async () => undefined,
      originalSessionFile: undefined,
      newSession: async (run) => {
        const clone: ClonePorts = {
          sendUserMessage: async (content) => {
            order.push(`send ${content}`);
          },
          waitForIdle: async () => undefined,
          switchSession: async () => undefined,
          confirm: async (question) => {
            order.push(`session confirm ${question}`);
            return insideAnswers.shift() ?? false;
          },
        };
        await run(clone);
      },
    };
  }

  function makeLintFlow(answers: boolean[], insideAnswers: boolean[], dirty: readonly string[]): LintFlow {
    const order: string[] = [];
    return { deps: makeLintDeps(order, answers, dirty), session: makeLintSession(order, insideAnswers), order };
  }

  test('lints and confirms each file and repairs only the accepted one', async () => {
    const flow = makeLintFlow([false, true], [], ['a.py', 'b.py']);
    await runLintCommand(flow.deps, flow.session);
    expect(flow.order).toEqual(['lint /repo/a.py', 'output errors /repo/a.py', 'confirm Fix lint errors in /repo/a.py?', 'lint /repo/b.py', 'output errors /repo/b.py', 'confirm Fix lint errors in /repo/b.py?', 'send errors /repo/b.py']);
  });

  test('keeps the confirmed files on their own session and confirms later files there', async () => {
    const flow = makeLintFlow([true], [true], ['a.py', 'b.py']);
    await runLintCommand(flow.deps, flow.session);
    expect(flow.order).toEqual([
      'lint /repo/a.py',
      'output errors /repo/a.py',
      'confirm Fix lint errors in /repo/a.py?',
      'send errors /repo/a.py',
      'lint /repo/b.py',
      'output errors /repo/b.py',
      'session confirm Fix lint errors in /repo/b.py?',
      'send errors /repo/b.py',
    ]);
  });

  test('reports a missing repository and lints nothing', async () => {
    const flow = makeLintFlow([], [], []);
    const failingGit: RepairDeps = { ...flow.deps, git: { exec: async () => ({ code: 128, stdout: '' }) } };
    await runLintCommand(failingGit, flow.session);
    expect(flow.order).toEqual(['error No git repository found.']);
  });
});

describe('runTestCommand', () => {
  function makeDeps(overrides?: Partial<RepairDeps>): { deps: RepairDeps; sent: string[]; appended: string[] } {
    const sent: string[] = [];
    const appended: string[] = [];
    const cmdRunIo: CmdRunIo = {
      output: () => undefined,
      confirm: async () => true,
      runShell: async (command) => [1, `failed by ${command}\n`],
    };
    const deps: RepairDeps = {
      pi: { sendUserMessage: (content) => sent.push(String(content)) },
      linter: {} as RepairDeps['linter'],
      io: { output: () => undefined, warning: () => undefined, error: () => undefined },
      confirm: async () => true,
      cmdRunIo,
      git: { exec: async () => ({ code: 0, stdout: '' }) },
      appendOutputEntry: (draft) => appended.push(draft.content),
      testCmd: 'cfg-tests',
      ...overrides,
    };
    return { deps, sent, appended };
  }

  test('falls back to the configured command when no argument is given', async () => {
    const { deps, sent, appended } = makeDeps();
    await runTestCommand(deps, '');
    expect(appended).toEqual(['I ran this command:\n\ncfg-tests\n\nAnd got this output:\n\nfailed by cfg-tests\n\n']);
    expect(sent).toEqual([appended[0]]);
  });

  test('runs the argument instead of the configured command', async () => {
    const { deps, sent, appended } = makeDeps();
    await runTestCommand(deps, 'pytest -q');
    expect(appended[0]).toContain('pytest -q');
    expect(sent).toEqual([appended[0]]);
  });

  test('sends nothing when the command passes', async () => {
    const { deps, sent, appended } = makeDeps();
    const passingIo: CmdRunIo = { ...deps.cmdRunIo, runShell: async () => [0, 'green\n'] };
    await runTestCommand({ ...deps, cmdRunIo: passingIo }, 'pytest');
    expect(sent.length).toBe(0);
    expect(appended.length).toBe(0);
  });

  test('sends nothing when no command is available at all', async () => {
    const { deps, sent, appended } = makeDeps({ testCmd: undefined });
    await runTestCommand(deps, '');
    expect(sent.length).toBe(0);
    expect(appended.length).toBe(0);
  });
});
