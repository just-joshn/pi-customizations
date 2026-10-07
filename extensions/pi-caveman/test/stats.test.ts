// biome-ignore-all lint/security/noSecrets: test labels, not credentials
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { aggregateHistory, appendHistory, attributeByMode, findCompressedPairs, formatShare, formatStats, parseDuration, sessionUsage } from '../src/stats.ts';

const assistant = (timestamp: number, output: unknown, cacheRead: unknown) => ({
  type: 'message',
  message: { role: 'assistant', model: 'claude-x', timestamp, usage: { output, cacheRead } },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'caveman-stats-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sessionUsage', () => {
  test('sums assistant usage and ignores other entries', () => {
    const usage = sessionUsage([assistant(1, 10, 3), { type: 'message', message: { role: 'user' } }, assistant(2, 5, 0), { type: 'custom' }]);
    expect(usage).toStrictEqual({
      output: { value: 15, availability: 'complete' },
      cacheRead: { value: 3, availability: 'complete' },
      turns: 2,
      model: 'claude-x',
      responses: [
        { ts: 1, outputTokens: 10, cacheReadTokens: 3 },
        { ts: 2, outputTokens: 5, cacheReadTokens: 0 },
      ],
    });
  });

  test('missing usage makes the count partial', () => {
    expect(sessionUsage([assistant(1, 10, 1), assistant(2, 'x', 1)]).output).toStrictEqual({ value: 10, availability: 'partial' });
  });
});

describe('attributeByMode', () => {
  test('splits output at each mode transition', () => {
    const usage = sessionUsage([assistant(100, 10, 0), assistant(300, 20, 0)]);
    const attribution = attributeByMode({ responses: usage.responses, transitions: [{ ts: 200, mode: 'ultracave', prev: 'caveman' }], mode: 'ultracave', output: usage.output });
    expect(attribution).toStrictEqual({ byMode: { caveman: 10, ultracave: 20 }, unknownTokens: 0, basis: 'log' });
  });

  test('without a log, the whole session goes to the current mode', () => {
    const usage = sessionUsage([assistant(100, 10, 0)]);
    expect(attributeByMode({ responses: usage.responses, transitions: [], mode: null, output: usage.output })).toStrictEqual({ byMode: { none: 10 }, unknownTokens: 0, basis: 'whole-session' });
  });
});

describe('formatting', () => {
  test('a mid-session switch lists output per mode', () => {
    const usage = sessionUsage([assistant(100, 1200, 50), assistant(300, 20, 0)]);
    const attribution = attributeByMode({ responses: usage.responses, transitions: [{ ts: 200, mode: null, prev: 'caveman' }], mode: null, output: usage.output });
    expect(formatStats({ usage, mode: null, sessionPath: '/s.jsonl', compressed: null, attribution })).toBe(
      [
        '',
        'Caveman Stats',
        '──────────────────────────────────',
        'Session:  /s.jsonl',
        'Turns:    2',
        '──────────────────────────────────',
        'Output tokens:         1,220',
        'Cache-read tokens:     50',
        '──────────────────────────────────',
        'Mode changed mid-session — output attributed per mode:',
        '  caveman: 1,200 tokens',
        '  caveman off: 20 tokens',
        'Savings: unknown — no measured comparison for this session.',
        '',
      ].join('\n'),
    );
  });

  test('share line counts turns and output tokens', () => {
    expect(formatShare(sessionUsage([assistant(1, 42, 0)]))).toBe('🪨 1 turn, 42 output tokens this session; savings unknown — caveman.sh');
  });

  test('an empty session says so', () => {
    expect(formatShare(sessionUsage([]))).toBe('🪨 No turns yet; savings unknown — caveman.sh');
  });
});

describe('history', () => {
  test('keeps the latest row per session inside the window', () => {
    const path = join(dir, 'nested', 'history.jsonl');
    appendHistory(path, { ts: 1000, session_id: 'a', output_tokens: 5, output_tokens_availability: 'complete' });
    appendHistory(path, { ts: 2000, session_id: 'a', output_tokens: 9, output_tokens_availability: 'complete' });
    appendHistory(path, { ts: 2500, session_id: 'b', output_tokens: 1, output_tokens_availability: 'complete' });
    appendHistory(path, { ts: 10, session_id: 'old', output_tokens: 100, output_tokens_availability: 'complete' });
    expect(aggregateHistory({ path, sinceMs: 2000, now: 3000 })).toStrictEqual({ sessions: 2, output: { value: 10, availability: 'complete' } });
  });

  test.for([
    { spec: '7d', expected: 604_800_000 },
    { spec: '24h', expected: 86_400_000 },
    { spec: '3w', expected: null },
  ])('parseDuration($spec)', ({ spec, expected }) => {
    expect(parseDuration(spec)).toBe(expected);
  });
});

describe('findCompressedPairs', () => {
  test('counts only pairs where the original is larger', () => {
    writeFileSync(join(dir, 'AGENTS.original.md'), 'x'.repeat(100));
    writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(40));
    writeFileSync(join(dir, 'grew.original.md'), 'x');
    writeFileSync(join(dir, 'grew.md'), 'xx');
    expect(findCompressedPairs([dir, dir])).toStrictEqual({ count: 1, totalOriginal: 100, totalCompressed: 40, bytesReduced: 60 });
  });
});
