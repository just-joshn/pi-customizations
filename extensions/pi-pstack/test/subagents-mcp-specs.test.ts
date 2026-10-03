import { expect, test } from 'vitest';
import { parseMcpServers } from '../src/subagents/mcp-specs.ts';

function parse(value: unknown) {
  const warnings: string[] = [];
  const specs = parseMcpServers(value, 'mine', (message) => warnings.push(message));
  return { specs, warnings };
}

test('undefined means the agent declared no MCP servers', () => {
  expect(parse(undefined)).toEqual({ specs: undefined, warnings: [] });
});

test('a non-list value is ignored with one warning', () => {
  expect(parse({ github: { command: 'gh' } })).toEqual({
    specs: undefined,
    warnings: ['[Agent: mine] Ignoring mcpServers: expected a list of server names or single-key server configurations'],
  });
});

test('string entries become references and blank strings are dropped', () => {
  expect(parse(['github', '  local ', '', '   ', 7])).toEqual({
    specs: [
      { kind: 'ref', name: 'github' },
      { kind: 'ref', name: 'local' },
    ],
    warnings: ['[Agent: mine] Invalid MCP server spec: expected a server name or a single-key configuration'],
  });
});

test('a single-key inline configuration keeps its name and config', () => {
  const config = { command: 'node', args: ['server.js'] };
  expect(parse([{ probe: config }])).toEqual({ specs: [{ kind: 'inline', name: 'probe', config }], warnings: [] });
});

test.for([
  { name: 'a stdio command', config: { type: 'stdio', command: 'node' } },
  { name: 'an http url', config: { type: 'http', url: 'https://example.test/mcp' } },
  { name: 'a streamable-http url', config: { type: 'streamable-http', url: 'https://example.test/mcp' } },
  { name: 'an untyped url', config: { url: 'https://example.test/mcp' } },
])('an inline configuration accepts $name', ({ config }) => {
  expect(parse([{ probe: config }]).specs).toEqual([{ kind: 'inline', name: 'probe', config }]);
});

test('an inline configuration must have exactly one key', () => {
  expect(parse([{ a: { command: 'node' }, b: { command: 'node' } }])).toEqual({
    specs: [],
    warnings: ['[Agent: mine] Invalid MCP server spec: expected exactly one key'],
  });
});

test('server names allow only letters, digits, underscore and dash', () => {
  expect(parse([{ 'bad name': { command: 'node' } }])).toEqual({
    specs: [],
    warnings: ["[Agent: mine] Skipping MCP server 'bad name' in frontmatter: names may only contain letters, digits, '_' and '-'"],
  });
});

test.for([
  { name: 'a string', config: 'npx probe' },
  { name: 'an array', config: ['node', 'server.js'] },
  { name: 'null', config: null },
])('an inline configuration that is $name is refused', ({ config }) => {
  expect(parse([{ probe: config }])).toEqual({
    specs: [],
    warnings: ["[Agent: mine] Skipping MCP server 'probe' in frontmatter: the configuration must be an object"],
  });
});

test('an unknown or non-string transport is refused by name', () => {
  expect(parse([{ probe: { type: 'websocket', command: 'node' } }])).toEqual({
    specs: [],
    warnings: ["[Agent: mine] Skipping host-only MCP transport 'websocket' for 'probe' in frontmatter"],
  });
  expect(parse([{ probe: { type: 42, command: 'node' } }]).warnings).toEqual(["[Agent: mine] Skipping host-only MCP transport '42' for 'probe' in frontmatter"]);
});

test('an inline configuration needs a command or a url', () => {
  expect(parse([{ probe: { args: ['x'] } }])).toEqual({
    specs: [],
    warnings: ["[Agent: mine] Skipping MCP server 'probe' in frontmatter: it needs a 'command' or a 'url'"],
  });
});

test('valid and invalid entries are parsed independently and in order', () => {
  const parsed = parse(['good', 7, { ok: { command: 'node' } }, { 'bad name': { command: 'node' } }]);
  expect(parsed.specs).toEqual([
    { kind: 'ref', name: 'good' },
    { kind: 'inline', name: 'ok', config: { command: 'node' } },
  ]);
  expect(parsed.warnings).toEqual([
    '[Agent: mine] Invalid MCP server spec: expected a server name or a single-key configuration',
    "[Agent: mine] Skipping MCP server 'bad name' in frontmatter: names may only contain letters, digits, '_' and '-'",
  ]);
});
