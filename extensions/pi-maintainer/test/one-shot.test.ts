import { describe, expect, test } from 'vitest';
import type { GitRunner } from '../src/git.ts';
import type { Linter } from '../src/linter.ts';
import { type OneShotDeps, OneShotRunner } from '../src/one-shot.ts';
import type { CmdRunIo } from '../src/test-run.ts';

interface Harness {
  readonly sent: string[];
  readonly appended: unknown[];
  readonly errors: string[];
  readonly warnings: string[];
  readonly output: string[];
  shutdown: () => void;
  readonly answers: boolean[];
  readonly questions: string[];
}

function makeHarness(answers: boolean[]): Harness {
  const harness: Harness = {
    sent: [],
    appended: [],
    errors: [],
    warnings: [],
    output: [],
    shutdown: () => {
      throw new Error('shutdown not expected');
    },
    answers,
    questions: [],
  };
  return harness;
}

function makeDeps(harness: Harness, dirty: readonly string[], lintResults: Map<string, string | undefined>): OneShotDeps {
  const git: GitRunner = {
    exec: async (args) => (args[0] === 'rev-parse' ? { code: 0, stdout: '/repo\n' } : { code: 0, stdout: `${dirty.join('\n')}\n` }),
  };
  const linter = {
    lint: async (fname: string) => lintResults.get(fname) ?? undefined,
  } as unknown as Linter;
  const cmdRunIo: CmdRunIo = {
    output: (message) => harness.output.push(message),
    confirm: async (question) => {
      harness.questions.push(question);
      return harness.answers.shift() ?? false;
    },
    runShell: async (command) => [1, `FAILED from ${command}\n`],
  };
  return {
    pi: {
      sendUserMessage: (content: string | unknown) => {
        harness.sent.push(typeof content === 'string' ? content : JSON.stringify(content));
      },
      sendMessage: (message: { customType: string; content: unknown }) => {
        harness.appended.push(message);
      },
    },
    io: {
      output: (message) => harness.output.push(message),
      warning: (message) => harness.warnings.push(message),
      error: (message) => harness.errors.push(message),
    },
    confirm: async () => harness.answers.shift() ?? false,
    cmdRunIo,
    git,
    linter,
    cwd: '/repo',
    shutdown: () => {
      harness.shutdown();
    },
  };
}

describe('OneShotRunner lint flow', () => {
  test('sends the first accepted repair and continues with the rest on settle', async () => {
    const harness = makeHarness([true, true]);
    const deps = makeDeps(
      harness,
      ['a.py', 'b.py'],
      new Map([
        ['/repo/a.py', 'errors a'],
        ['/repo/b.py', 'errors b'],
      ]),
    );
    const runner = new OneShotRunner(deps, true, false, undefined);
    await runner.start();
    expect(harness.sent).toEqual(['errors a']);
    expect(harness.errors).toHaveLength(0);
    harness.shutdown = () => {
      harness.sent.push('shutdown');
    };
    await runner.onSettled();
    expect(harness.sent).toEqual(['errors a', 'errors b']);
    await runner.onSettled();
    expect(harness.sent).toEqual(['errors a', 'errors b', 'shutdown']);
  });

  test('asks per file and declines leave the queue empty', async () => {
    const harness = makeHarness([false]);
    const deps = makeDeps(harness, ['a.py'], new Map([['/repo/a.py', 'errors a']]));
    let shutdowns = 0;
    const runner = new OneShotRunner(
      {
        ...deps,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      true,
      false,
      undefined,
    );
    await runner.start();
    expect(harness.sent).toHaveLength(0);
    expect(shutdowns).toBe(1);
  });

  test('reports a missing repository and moves on to shutdown', async () => {
    const harness = makeHarness([]);
    const deps = makeDeps(harness, [], new Map());
    const failingGit: GitRunner = { exec: async () => ({ code: 128, stdout: '' }) };
    let shutdowns = 0;
    const runner = new OneShotRunner(
      {
        ...deps,
        git: failingGit,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      true,
      false,
      undefined,
    );
    await runner.start();
    expect(harness.errors).toEqual(['No git repository found.']);
    expect(shutdowns).toBe(1);
  });

  test('warns when there are no dirty files', async () => {
    const harness = makeHarness([]);
    const deps = makeDeps(harness, [], new Map());
    let shutdowns = 0;
    const runner = new OneShotRunner(
      {
        ...deps,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      true,
      false,
      undefined,
    );
    await runner.start();
    expect(harness.warnings).toEqual(['No dirty files to lint.']);
    expect(shutdowns).toBe(1);
  });
});

describe('OneShotRunner lint interleaving', () => {
  interface OrderedRunner {
    readonly runner: OneShotRunner;
    readonly order: string[];
    readonly shutdowns: () => number;
  }

  function makeOrderedRunner(answers: boolean[]): OrderedRunner {
    const order: string[] = [];
    let shutdownCount = 0;
    const deps: OneShotDeps = {
      pi: {
        sendUserMessage: (content: string | unknown) => {
          order.push(`send ${String(content)}`);
        },
        sendMessage: (message: { customType: string; content: unknown }) => {
          order.push(`append ${message.customType}`);
        },
      },
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
        exec: async (args) => (args[0] === 'rev-parse' ? { code: 0, stdout: '/repo\n' } : { code: 0, stdout: 'a.py\nb.py\n' }),
      },
      linter: {
        lint: async (fname: string) => {
          order.push(`lint ${fname}`);
          return `errors ${fname}`;
        },
      } as unknown as Linter,
      cwd: '/repo',
      shutdown: () => {
        order.push('shutdown');
        shutdownCount += 1;
      },
    };
    return { runner: new OneShotRunner(deps, true, false, undefined), order, shutdowns: () => shutdownCount };
  }

  test('lints and confirms per file, repairing only the second file', async () => {
    const { runner, order } = makeOrderedRunner([false, true]);
    await runner.start();
    expect(order).toEqual(['lint /repo/a.py', 'output errors /repo/a.py', 'confirm Fix lint errors in /repo/a.py?', 'lint /repo/b.py', 'output errors /repo/b.py', 'confirm Fix lint errors in /repo/b.py?', 'send errors /repo/b.py']);
  });

  test('advances to the next file after each repair settles', async () => {
    const { runner, order, shutdowns } = makeOrderedRunner([true, true]);
    await runner.start();
    expect(order).toEqual(['lint /repo/a.py', 'output errors /repo/a.py', 'confirm Fix lint errors in /repo/a.py?', 'send errors /repo/a.py']);
    await runner.onSettled();
    expect(order).toEqual([
      'lint /repo/a.py',
      'output errors /repo/a.py',
      'confirm Fix lint errors in /repo/a.py?',
      'send errors /repo/a.py',
      'lint /repo/b.py',
      'output errors /repo/b.py',
      'confirm Fix lint errors in /repo/b.py?',
      'send errors /repo/b.py',
    ]);
    await runner.onSettled();
    expect(order.at(-1)).toBe('shutdown');
    expect(shutdowns()).toBe(1);
  });
});

describe('OneShotRunner test flow', () => {
  test('reports the missing command, sets exit code 1, and shuts down', async () => {
    const harness = makeHarness([]);
    const deps = makeDeps(harness, [], new Map());
    let shutdowns = 0;
    const before = process.exitCode;
    const runner = new OneShotRunner(
      {
        ...deps,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      false,
      true,
      undefined,
    );
    await runner.start();
    expect(harness.errors).toEqual(['No --test-cmd provided.']);
    expect(shutdowns).toBe(1);
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });

  test('adds the failing output to the conversation and exits zero without a model call', async () => {
    const harness = makeHarness([]);
    const deps = makeDeps(harness, [], new Map());
    let shutdowns = 0;
    const runner = new OneShotRunner(
      {
        ...deps,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      false,
      true,
      "echo 'FAILED'; exit 1",
    );
    await runner.start();
    expect(harness.appended).toHaveLength(1);
    const draft = harness.appended[0] as { customType: string; content: string };
    expect(draft.customType).toBe('maintainer-command-output');
    expect(draft.content).toContain("I ran this command:\n\necho 'FAILED'; exit 1\n\nAnd got this output:\n\nFAILED from echo 'FAILED'; exit 1\n");
    expect(harness.sent).toHaveLength(0);
    expect(harness.output).toEqual(['Added 1 line of output to the chat.']);
    expect(shutdowns).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });

  test('adds nothing and exits when the test command passes', async () => {
    const harness = makeHarness([]);
    const deps = makeDeps(harness, [], new Map());
    let shutdowns = 0;
    const cmdRunIo: CmdRunIo = {
      output: (message) => harness.output.push(message),
      confirm: async () => true,
      runShell: async () => [0, 'green\n'],
    };
    const runner = new OneShotRunner(
      {
        ...deps,
        cmdRunIo,
        shutdown: () => {
          shutdowns += 1;
        },
      },
      false,
      true,
      'pytest',
    );
    await runner.start();
    expect(harness.appended).toHaveLength(0);
    expect(shutdowns).toBe(1);
  });

  test('lint repairs settle before the test flow runs', async () => {
    const harness = makeHarness([true]);
    const deps = makeDeps(harness, ['a.py'], new Map([['/repo/a.py', 'errors a']]));
    const order: string[] = [];
    let stage = 'start';
    const runner = new OneShotRunner(
      {
        ...deps,
        shutdown: () => {
          order.push(`shutdown after ${stage}`);
        },
      },
      true,
      true,
      'pytest',
    );
    await runner.start();
    expect(harness.sent).toEqual(['errors a']);
    stage = 'repair';
    await runner.onSettled();
    expect(order).toEqual(['shutdown after repair']);
    expect(harness.appended).toHaveLength(1);
  });
});
