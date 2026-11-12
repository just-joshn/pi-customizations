// A readonly worker keeps Pi's route to MCP unless capabilities.mcp is none, and never gains a write-class tool.
import { expect, test } from 'vitest';
import { readonlyTools } from '../../src/workers.ts';

const WRITE_CLASS = ['write', 'edit', 'bash', 'powershell'];

test.each(['inherit', 'none'] as const)('mcp %s: the allowlist holds no write-class tool and only bash_readonly for shell', (mcp) => {
  const tools = readonlyTools(mcp);
  expect(tools.filter((name) => WRITE_CLASS.includes(name))).toEqual([]);
  expect(tools).toContain('bash_readonly');
});

test('mcp inherit adds codemode and tool_search, the tools Pi reaches MCP through', () => {
  expect(readonlyTools('inherit')).toEqual(expect.arrayContaining(['codemode', 'tool_search']));
});

test('mcp none leaves both out, beside the --no-mcp the host adds', () => {
  expect(readonlyTools('none')).toEqual(['read', 'grep', 'find', 'ls', 'bash_readonly', 'pstack_evidence']);
});
