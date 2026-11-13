import { expect, test } from 'vitest';
import { watcherHasOutput } from './families/pr-babysit-restart.ts';

test.each(['{"kind":"WAITING"}', 'WAITING: frontier=#71; 1 check pending', 'READY: frontier=#71'])('restart observes watcher output in either supported format: %s', (output) => {
  expect(watcherHasOutput(output)).toBe(true);
});

test.each(['', '   ', 'Worker w: running', 'unrelated output'])('an absent watcher verdict cannot trigger the restart: %s', (output) => {
  expect(watcherHasOutput(output)).toBe(false);
});
