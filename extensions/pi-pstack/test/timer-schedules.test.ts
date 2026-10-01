import { expect, test } from 'vitest';
import { nextOccurrence, parseTimer } from '../src/timer-schedules.ts';

test.for([
  null,
  undefined,
  {},
  { name: '', prompt: 'x', delaySeconds: 1 },
  { name: 'x', prompt: '', delaySeconds: 1 },
  { name: 'x', prompt: 'x', delaySeconds: 0 },
  { name: 'x', prompt: 'x', delaySeconds: 0.5 },
  { name: 'x', prompt: 'x', delaySeconds: -1 },
  { name: 'x', prompt: 'x', delaySeconds: '1' },
  { name: 'x', prompt: 'x', delaySeconds: 1, cron: '* * * * *' },
])('rejects invalid timer input %j', (input) => {
  expect(() => parseTimer(input)).toThrow();
});

test('interval schedules advance from the supplied instant', () => {
  expect(nextOccurrence(parseTimer({ name: 'audit', prompt: 'check', delaySeconds: 30 }), 1000)).toBe(31000);
});

test('cron supports lists ranges and steps in an explicit timezone', () => {
  const timer = parseTimer({ name: 'audit', prompt: 'check', cron: '*/15 9-17 * * 1,2,3,4,5', timezone: 'America/Los_Angeles' });
  expect(new Date(nextOccurrence(timer, Date.parse('2026-10-01T15:59:00Z'))).toISOString()).toBe('2026-10-01T16:00:00.000Z');
});

test('restricted day-of-month and weekday match either field', () => {
  const timer = parseTimer({ name: 'audit', prompt: 'check', cron: '0 0 15 * 1', timezone: 'UTC' });
  expect(new Date(nextOccurrence(timer, Date.parse('2026-10-01T00:00:00Z'))).toISOString()).toBe('2026-10-05T00:00:00.000Z');
});

test.for(['* * * *', '60 * * * *', '*/0 * * * *', '1-0 * * * *', '* * * 13 *', '* * * * 8'])('rejects malformed cron %s', (cron) => {
  expect(() => parseTimer({ name: 'audit', prompt: 'check', cron })).toThrow();
});

test('rejects unknown timezones', () => {
  expect(() => parseTimer({ name: 'audit', prompt: 'check', cron: '* * * * *', timezone: 'Mars/Olympus' })).toThrow();
});
