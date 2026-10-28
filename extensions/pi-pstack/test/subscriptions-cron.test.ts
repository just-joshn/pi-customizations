import { describe, expect, test } from 'vitest';
import { cronMatches, parseCron } from '../src/subscriptions/cron.ts';

// Local-time dates, so these hold in any time zone. 2026-01-05 is a Monday.
const at = (day: number, hour: number, minute: number, month = 0) => new Date(2026, month, day, hour, minute);
const sorted = (set: ReadonlySet<number>) => [...set].toSorted((a, b) => a - b);

describe('parseCron', () => {
  test('expands *, lists, ranges, steps, and start/step', () => {
    const cron = parseCron('*/15 9-17/4 1,15 * 5/1');
    expect(sorted(cron.minutes)).toEqual([0, 15, 30, 45]);
    expect(sorted(cron.hours)).toEqual([9, 13, 17]);
    expect(sorted(cron.days)).toEqual([1, 15]);
    expect(sorted(cron.months)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sorted(cron.weekdays)).toEqual([0, 5, 6]);
  });

  test('reads month and weekday names, and 7 as Sunday', () => {
    const cron = parseCron('0 0 * jan-mar sun,7,MON');
    expect(sorted(cron.months)).toEqual([1, 2, 3]);
    expect(sorted(cron.weekdays)).toEqual([0, 1]);
  });

  test.for([
    ['* * * *', 'needs 5 fields'],
    ['60 * * * *', 'minute value "60" is outside 0-59'],
    ['* 24 * * *', 'hour value "24"'],
    ['* * 0 * *', 'day-of-month value "0"'],
    ['* * * 13 *', 'month value "13"'],
    ['* * * * 8', 'day-of-week value "8"'],
    ['5-1 * * * *', 'runs backwards'],
    ['*/0 * * * *', 'step must be at least 1'],
    ['a * * * *', 'minute value "a"'],
    ['1,,2 * * * *', 'malformed'],
  ])('rejects %j', ([expression, message]) => {
    expect(() => parseCron(expression ?? '')).toThrow(message);
  });
});

describe('cronMatches', () => {
  test('weekday mornings', () => {
    const cron = parseCron('0 9 * * 1-5');
    expect(cronMatches(cron, at(5, 9, 0))).toBe(true);
    expect(cronMatches(cron, at(5, 9, 1))).toBe(false);
    expect(cronMatches(cron, at(4, 9, 0))).toBe(false);
  });

  test('both day fields restricted match on either, as standard cron does', () => {
    const cron = parseCron('0 0 1 * 1');
    expect(cronMatches(cron, at(1, 0, 0))).toBe(true); // the 1st, a Thursday
    expect(cronMatches(cron, at(5, 0, 0))).toBe(true); // a Monday
    expect(cronMatches(cron, at(6, 0, 0))).toBe(false);
  });

  test('one day field restricted requires it', () => {
    const cron = parseCron('30 12 15 2 *');
    expect(cronMatches(cron, at(15, 12, 30, 1))).toBe(true);
    expect(cronMatches(cron, at(15, 12, 30, 0))).toBe(false);
  });
});
