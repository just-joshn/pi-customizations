import { describe, expect, test } from 'vitest';
import { LintRepairQueue } from '../src/lint-queue.ts';
import type { Linter } from '../src/linter.ts';
import type { LinterIo } from '../src/types.ts';

interface QueueSpans {
  readonly lints: string[];
  readonly output: string[];
  readonly questions: string[];
  readonly files: readonly string[];
}

function makeQueue(errors: ReadonlyMap<string, string | undefined>, answers: boolean[]) {
  const spans: QueueSpans = { lints: [], output: [], questions: [], files: [...errors.keys()] };
  const linter = {
    lint: async (fname: string) => {
      spans.lints.push(fname);
      return errors.get(fname);
    },
  } as unknown as Pick<Linter, 'lint'>;
  const io: Pick<LinterIo, 'output'> = {
    output: (message: string) => spans.output.push(message),
  };
  const confirm = async (question: string): Promise<boolean> => {
    spans.questions.push(question);
    return answers.shift() ?? false;
  };
  return { queue: new LintRepairQueue({ linter, io, files: spans.files }), spans, confirm };
}

describe('LintRepairQueue', () => {
  test('lints, prints and confirms each file until one is accepted', async () => {
    const errors = new Map<string, string | undefined>([
      ['/repo/a.py', 'errors a'],
      ['/repo/b.py', 'errors b'],
    ]);
    const { queue, spans, confirm } = makeQueue(errors, [false, true]);
    expect(await queue.next(confirm)).toBe('errors b');
    expect(spans.lints).toEqual(['/repo/a.py', '/repo/b.py']);
    expect(spans.output).toEqual(['errors a', 'errors b']);
    expect(spans.questions).toEqual(['Fix lint errors in /repo/a.py?', 'Fix lint errors in /repo/b.py?']);
    expect(await queue.next(confirm)).toBeUndefined();
  });

  test('skips files without lint errors without asking about them', async () => {
    const errors = new Map<string, string | undefined>([
      ['/repo/clean.py', undefined],
      ['/repo/b.py', 'errors b'],
    ]);
    const { queue, spans, confirm } = makeQueue(errors, [true]);
    expect(await queue.next(confirm)).toBe('errors b');
    expect(spans.lints).toEqual(['/repo/clean.py', '/repo/b.py']);
    expect(spans.questions).toEqual(['Fix lint errors in /repo/b.py?']);
  });

  test('reports exhaustion when every file is declined', async () => {
    const errors = new Map<string, string | undefined>([['/repo/a.py', 'errors a']]);
    const { queue, spans, confirm } = makeQueue(errors, [false]);
    expect(await queue.next(confirm)).toBeUndefined();
    expect(spans.questions).toEqual(['Fix lint errors in /repo/a.py?']);
    expect(await queue.next(confirm)).toBeUndefined();
    expect(spans.lints).toEqual(['/repo/a.py']);
  });
});
