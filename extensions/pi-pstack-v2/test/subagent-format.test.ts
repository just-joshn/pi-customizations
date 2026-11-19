import { homedir } from 'node:os';

import { describe, expect, test } from 'vitest';
import { formatTokens, formatUsageStats } from '../src/subagent/format.ts';
import { formatToolCall, type ThemeFg } from '../src/subagent/format-tool-call.ts';

const fg: ThemeFg = (color, value) => `<${color}:${value}>`;
const ETC_FILE = '/etc/x';
const FILE = '/f';
const SRC = '/src';
const BASH_LIMIT = 60;
const DEFAULT_LIMIT = 50;
const LONG_REPEAT = 100;
const READ_OFFSET = 5;
const READ_LIMIT = 10;
const TOKENS_SMALL = 999;
const TOKENS_KILO = 1500;
const TOKENS_TEN_KILO = 12_500;
const TOKENS_MEGA = 2_500_000;
const COST = 0.12345;

describe('formatTokens', () => {
  test.each([
    [0, '0'],
    [TOKENS_SMALL, '999'],
    [TOKENS_KILO, '1.5k'],
    [TOKENS_TEN_KILO, '13k'],
    [TOKENS_MEGA, '2.5M'],
  ])('formats %d as %s', (count, expected) => {
    expect(formatTokens(count)).toBe(expected);
  });
});

describe('formatUsageStats', () => {
  const full = { input: TOKENS_KILO, output: TOKENS_SMALL, cacheRead: TOKENS_TEN_KILO, cacheWrite: TOKENS_MEGA, cost: COST, contextTokens: TOKENS_KILO, turns: 2 };

  test('renders every populated field in order, then the model', () => {
    expect(formatUsageStats(full, 'gpt')).toBe('2 turns ↑1.5k ↓999 R13k W2.5M $0.1235 ctx:1.5k gpt');
  });

  test('uses the singular for one turn', () => {
    expect(formatUsageStats({ ...full, turns: 1 })).toContain('1 turn ↑');
  });

  test('omits zero fields and returns empty string when nothing is set', () => {
    const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    expect(formatUsageStats(empty)).toBe('');
    expect(formatUsageStats({ ...empty, contextTokens: 0, turns: 0 }, 'm')).toBe('m');
  });
});

describe('formatToolCall', () => {
  test('bash shows the command and truncates long ones', () => {
    expect(formatToolCall('bash', { command: 'ls' }, fg)).toBe('<muted:$ ><toolOutput:ls>');
    expect(formatToolCall('bash', {}, fg)).toBe('<muted:$ ><toolOutput:...>');
    const long = 'x'.repeat(LONG_REPEAT);
    expect(formatToolCall('bash', { command: long }, fg)).toContain(`${'x'.repeat(BASH_LIMIT)}...`);
  });

  test('read shortens home paths and shows the line range', () => {
    const out = formatToolCall('read', { path: `${homedir()}/a.ts`, offset: READ_OFFSET, limit: READ_LIMIT }, fg);
    expect(out).toContain('<accent:~/a.ts>');
    expect(out).toContain('<warning::5-14>');
  });

  test('read prefers file_path, falls back to ..., and omits an absent range', () => {
    expect(formatToolCall('read', { file_path: ETC_FILE }, fg)).toBe('<muted:read ><accent:/etc/x>');
    expect(formatToolCall('read', { file_path: '' }, fg)).toBe('<muted:read ><accent:...>');
    expect(formatToolCall('read', { file_path: 3 }, fg)).toBe('<muted:read ><accent:...>');
  });

  test('write reports line count only for multi-line content', () => {
    expect(formatToolCall('write', { path: FILE, content: 'a\nb\nc' }, fg)).toBe(`<muted:write ><accent:${FILE}><dim: (3 lines)>`);
    expect(formatToolCall('write', { path: FILE, content: 'a' }, fg)).toBe(`<muted:write ><accent:${FILE}>`);
    expect(formatToolCall('write', {}, fg)).toBe('<muted:write ><accent:...>');
  });

  test('edit, ls, find and grep render their arguments with defaults', () => {
    expect(formatToolCall('edit', { path: FILE }, fg)).toBe(`<muted:edit ><accent:${FILE}>`);
    expect(formatToolCall('ls', {}, fg)).toBe('<muted:ls ><accent:.>');
    expect(formatToolCall('find', {}, fg)).toBe('<muted:find ><accent:*><dim: in .>');
    expect(formatToolCall('find', { pattern: '*.ts', path: SRC }, fg)).toBe(`<muted:find ><accent:*.ts><dim: in ${SRC}>`);
    expect(formatToolCall('grep', {}, fg)).toBe('<muted:grep ><accent://><dim: in .>');
    expect(formatToolCall('grep', { pattern: 'foo', path: SRC }, fg)).toBe(`<muted:grep ><accent:/foo/><dim: in ${SRC}>`);
  });

  test('unknown tools show a JSON preview, truncated when long', () => {
    expect(formatToolCall('custom', { a: 1 }, fg)).toBe('<accent:custom><dim: {"a":1}>');
    const out = formatToolCall('custom', { v: 'y'.repeat(LONG_REPEAT) }, fg);
    expect(out).toBe(`<accent:custom><dim: ${JSON.stringify({ v: 'y'.repeat(LONG_REPEAT) }).slice(0, DEFAULT_LIMIT)}...>`);
  });
});
