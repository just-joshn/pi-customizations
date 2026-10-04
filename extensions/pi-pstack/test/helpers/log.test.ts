import './leak-preload.ts';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { expectDefined } from '../support/expect-defined.ts';

const script = new URL('../../skills/show-me-your-work/scripts/log.sh', import.meta.url).pathname;
const header = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'].join('\t');
const directories: string[] = [];

async function logPath(name = 'decisions.tsv'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'log-sh-'));
  directories.push(directory);
  return join(directory, name);
}

function append(file: string, cells: string[]) {
  return spawnSync('bash', [script, file, ...cells], { encoding: 'utf8' });
}

async function rows(file: string): Promise<string[][]> {
  return (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('log.sh rows', () => {
  test('writes the header once and a six-cell row with an ISO timestamp', async () => {
    const file = await logPath();
    expect(append(file, ['p1', 'chose A', 'faster', 'run.log', 'ok']).status).toBe(0);
    expect(append(file, ['p2', 'chose B', 'simpler', 'run2.log', 'ok']).status).toBe(0);
    const table = await rows(file);
    expect(table.map((row) => row.length)).toEqual([6, 6, 6]);
    expect(table[0]?.join('\t')).toBe(header);
    expect(table[1]?.[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(table.slice(1).map((row) => row.slice(1))).toEqual([
      ['p1', 'chose A', 'faster', 'run.log', 'ok'],
      ['p2', 'chose B', 'simpler', 'run2.log', 'ok'],
    ]);
  });

  test('creates a missing log directory', async () => {
    const file = join(await logPath(), '..', 'nested', 'deeper', 'log.tsv');
    expect(append(file, ['p', 'd', 'w', 'e', 'r']).status).toBe(0);
    expect((await rows(file)).length).toBe(2);
  });

  test('rejects a wrong argument count with usage and exit 1', async () => {
    const file = await logPath();
    const result = append(file, ['only', 'four', 'cells', 'here']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>');
  });

  test('turns tabs and newlines into spaces so a row stays on one line', async () => {
    const file = await logPath();
    append(file, ['a\tb', 'c\nd', 'e\rf', 'g', 'h']);
    const table = await rows(file);
    expect(table).toHaveLength(2);
    expect(table[1]?.slice(1)).toEqual(['a b', 'c d', 'e f', 'g', 'h']);
  });
});

function parseQualifiedTsv(text: string): string[][] {
  const parsed = spawnSync('python3', [new URL('./parse-tsv.py', import.meta.url).pathname], { input: text, encoding: 'utf8' });
  expect({ status: parsed.status, stderr: parsed.stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(parsed.stdout);
}

test('spreadsheet text qualifiers cannot expose a formula initiator in attacker-controlled evidence', async () => {
  const input = '"=2+5"';
  expect(parseQualifiedTsv(`${input}\n`)).toEqual([['=2+5']]);
  const file = await logPath();
  expect(append(file, ['p', 'd', 'w', input, 'r']).status).toBe(0);
  const emitted = await readFile(file, 'utf8');
  const neutralized = `'${input}`;
  const parsed = parseQualifiedTsv(emitted);
  expect(parsed[1]?.[4]).toBe(neutralized);
  expect(expectDefined(emitted.split('\n')[1]).split('\t')[4]).toBe(neutralized);
});

describe('log.sh formula guard', () => {
  test.each([
    { name: 'equals', cell: '=1+1', stored: "'=1+1" },
    { name: 'plus', cell: '+SUM(A1)', stored: "'+SUM(A1)" },
    { name: 'minus', cell: '-2', stored: "'-2" },
    { name: 'at sign', cell: '@cmd', stored: "'@cmd" },
    { name: 'leading space then equals', cell: ' =1', stored: ' =1' },
    { name: 'leading tab then equals', cell: '\t=1', stored: ' =1' },
    { name: 'several leading spaces then at sign', cell: '   @x', stored: '   @x' },
    { name: 'plain text', cell: 'plain =1', stored: 'plain =1' },
    { name: 'blank cell', cell: '  ', stored: '  ' },
  ])('prefixes or keeps the $name cell as expected', async ({ cell, stored }) => {
    const file = await logPath();
    append(file, ['p', cell, 'w', 'e', 'r']);
    expect((await rows(file))[1]?.[2]).toBe(stored);
  });
});
