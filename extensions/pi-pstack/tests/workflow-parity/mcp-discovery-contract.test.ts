import { expect, test } from 'vitest';
import { mcpFamilies } from './families/mcp.ts';
import type { RunView } from './lib/view.ts';

const check = mcpFamilies[0]?.checks.find((entry) => entry.id === 'why-mcp.parent-discovers-mcp');
const result = (text: string) => check?.run({ parent: { toolCalls: [], messages: [{ role: 'assistant', text, order: 1 }] } } as unknown as RunView);
test('the parent can identify the server from the supplied tools map', () => {
  expect(result('Available MCP servers: mcp__decisions, for long-form decision records.')).toMatchObject({ ok: true });
});
test('claiming that no MCP exists is still a discovery failure when the server is available', () => {
  expect(result('No MCP servers are visible, so I skipped searching.')).toMatchObject({ ok: false });
});
