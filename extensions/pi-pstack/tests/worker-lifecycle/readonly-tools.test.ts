// A readonly worker never gains a write-class tool, and reaches MCP only through what the operator authorized.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { readonlyMcpTools, readonlyTools, trackerMcpTools } from '../../src/workers.ts';

const WRITE_CLASS = ['write', 'edit', 'bash', 'powershell'];
const READ_ONLY = ['read', 'grep', 'find', 'ls', 'bash_readonly', 'pstack_evidence'];
const worker = { mcp: 'inherit' } as const;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function agentDir(file: string | undefined): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-ro-mcp-'));
  dirs.push(dir);
  if (file !== undefined) {
    mkdirSync(join(dir, 'pstack'));
    writeFileSync(join(dir, 'pstack', 'readonly-mcp.json'), file);
  }
  return { PI_CODING_AGENT_DIR: dir };
}

test.each([
  [{ mcp: 'inherit' }, ['mcp__notes__read_note']],
  [{ mcp: 'inherit' }, []],
  [{ mcp: 'none' }, []],
] as const)('%j: the allowlist holds no write-class tool and only bash_readonly for shell', (capabilities, authorized) => {
  const { tools } = readonlyTools(capabilities, authorized);
  expect(tools.filter((name) => WRITE_CLASS.includes(name))).toEqual([]);
  expect(tools).toContain('bash_readonly');
});

test('mcp none leaves the MCP route out, beside the --no-mcp the host adds', () => {
  expect(readonlyTools({ mcp: 'none' }, ['mcp__notes__read_note'])).toEqual({ tools: READ_ONLY, excludeTools: [] });
});

test('an authorized tool is named in --tools, which makes Pi filter every other MCP tool for codemode and tool_search', () => {
  expect(readonlyTools(worker, ['mcp__notes__read_note'])).toEqual({ tools: [...READ_ONLY, 'codemode', 'tool_search', 'mcp__notes__read_note'], excludeTools: [] });
});

test('with nothing authorized every MCP tool is excluded', () => {
  expect(readonlyTools(worker, [])).toEqual({ tools: [...READ_ONLY, 'codemode', 'tool_search'], excludeTools: ['mcp__*'] });
});

test('a tracker worker names its read and write tools exactly, and never gets the unfiltered MCP route', () => {
  expect(readonlyTools(worker, ['mcp__notes__read_note', 'mcp__notes__write_note'])).toEqual({ tools: [...READ_ONLY, 'codemode', 'tool_search', 'mcp__notes__read_note', 'mcp__notes__write_note'], excludeTools: [] });
});

test('the operator file authorizes exactly the tools it names, and a missing file authorizes none', () => {
  expect(readonlyMcpTools(agentDir(undefined))).toEqual([]);
  expect(readonlyMcpTools(agentDir(JSON.stringify({ tools: ['mcp__notes__read_note', 'mcp__docs__search'] })))).toEqual(['mcp__notes__read_note', 'mcp__docs__search']);
});

test.each([['{"tools":["mcp__notes__*"]}'], ['{"tools":["read_note"]}'], ['{"tools":"mcp__notes__read_note"}'], ['{"tools":["mcp__notes__read_note",1]}'], ['not json']])('a malformed operator file %s fails the spawn instead of authorizing less or more', (file) => {
  expect(() => readonlyMcpTools(agentDir(file))).toThrow(/readonly-mcp\.json/);
});

function trackerDir(file: string | undefined): Record<string, string> {
  const dir = agentDir(undefined);
  if (file !== undefined) {
    const root = dir['PI_CODING_AGENT_DIR'] as string;
    mkdirSync(join(root, 'pstack'));
    writeFileSync(join(root, 'pstack', 'tracker-mcp.json'), file);
  }
  return dir;
}

test('the tracker file authorizes exactly the write tools it names', () => {
  expect(trackerMcpTools(trackerDir(JSON.stringify({ tools: ['mcp__notes__write_note'] })))).toEqual(['mcp__notes__write_note']);
});

test.each([
  ['missing', undefined, /tracker-mcp\.json is missing/],
  ['empty', '{"tools":[]}', /lists no tools/],
  ['a wildcard', '{"tools":["mcp__notes__*"]}', /exact tool names and no patterns/],
  ['a whole namespace', '{"tools":["mcp__*"]}', /exact tool names and no patterns/],
  ['a server without a tool', '{"tools":["mcp__notes"]}', /exact tool names and no patterns/],
  ['a bare tool name', '{"tools":["write_note"]}', /exact tool names and no patterns/],
  ['not an array', '{"tools":"mcp__notes__write_note"}', /exact tool names and no patterns/],
  ['not JSON', 'nope', /not valid JSON/],
] as const)('a tracker file that is %s is a setup error, never a fallback', (_name, file, message) => {
  expect(() => trackerMcpTools(trackerDir(file))).toThrow(message);
});
