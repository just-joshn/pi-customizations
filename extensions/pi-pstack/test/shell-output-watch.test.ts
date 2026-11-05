import { readFileSync } from 'node:fs';

import { expect, test, vi } from 'vitest';
import { type OutputMatchNotice, type OutputWatchRequest, ShellOutputWatch } from '../src/shell-output-watch.ts';

type Step = { write: string } | { repeat: { text: string; count: number; suffix: string } } | { advance: number } | { finish: boolean };
interface ReferenceCase extends OutputWatchRequest {
  id: string;
  name: string;
  steps: Step[];
  checkpoints?: OutputMatchNotice[][];
  error?: string;
}

const reference = JSON.parse(readFileSync(new URL('./fixtures/cursor-shell-monitor.json', import.meta.url), 'utf8')) as { cases: ReferenceCase[] };

test.for(reference.cases)('$id $name matches the pinned Cursor observer', (scenario, { onTestFinished }) => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const notices: OutputMatchNotice[] = [];
  if (scenario.error !== undefined) {
    expect(() => new ShellOutputWatch(scenario, (notice) => notices.push(notice))).toThrow(scenario.error);
    return;
  }
  const watch = new ShellOutputWatch(scenario, (notice) => notices.push(notice));
  onTestFinished(() => watch.finish(false));
  expect.hasAssertions();
  for (const [index, step] of scenario.steps.entries()) {
    if ('write' in step) watch.observe(step.write);
    else if ('repeat' in step) watch.observe(step.repeat.text.repeat(step.repeat.count) + step.repeat.suffix);
    else if ('advance' in step) vi.advanceTimersByTime(step.advance);
    else watch.finish();
    expect(notices).toEqual(scenario.checkpoints?.[index]);
  }
});

test('shutdown discards pending notifications and ignores later output', ({ onTestFinished }) => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const notices: OutputMatchNotice[] = [];
  const watch = new ShellOutputWatch({ pattern: 'HIT', reason: 'hits' }, (notice) => notices.push(notice));
  onTestFinished(() => watch.finish(false));
  watch.observe('HIT HIT');
  watch.finish(false);
  watch.observe('HIT');
  vi.advanceTimersByTime(30_000);
  expect(notices).toEqual([{ sequence: 1, title: 'hits', detail: 'Shell output has pattern /HIT/. This is occurrence number 1. Matched text: HIT. The title message is being displayed to the user.' }]);
});
