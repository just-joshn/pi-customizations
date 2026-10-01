import { expect, test } from 'vitest';
import { parseAgentFile } from '../src/subagents/definitions.ts';
import { parseJsonAgents } from '../src/subagents/json-definitions.ts';
import { RuntimeAgents } from '../src/subagents/runtime-agents.ts';

const agent = (name: string, extra = '') => `---\nname: ${name}\ndescription: does ${name}\n${extra}---\nPrompt body\n`;
const parse = (extra: string, source: 'userSettings' | 'projectSettings' = 'userSettings') => parseAgentFile('/p/a.md', agent('guarded', extra), source, '/p');

test('[A41][B26] mcpServers accepts server names and single-key inline configurations', () => {
  const parsed = parse('mcpServers:\n  - docs\n  - local-files:\n      command: npx\n      args: [-y, files]\n');
  expect(parsed.warnings).toEqual([]);
  expect(parsed.agent?.mcpServers).toEqual([
    { kind: 'ref', name: 'docs' },
    { kind: 'inline', name: 'local-files', config: { command: 'npx', args: ['-y', 'files'] } },
  ]);
});

test.for([
  { yaml: 'mcpServers:\n  - a: {command: x}\n    b: {command: y}\n', warning: '[Agent: guarded] Invalid MCP server spec: expected exactly one key' },
  { yaml: 'mcpServers:\n  - ide: {type: sdk, name: ide}\n', warning: "[Agent: guarded] Skipping host-only MCP transport 'sdk' for 'ide' in frontmatter" },
  { yaml: 'mcpServers:\n  - bad: {args: [x]}\n', warning: "[Agent: guarded] Skipping MCP server 'bad' in frontmatter: it needs a 'command' or a 'url'" },
])('[A41] invalid inline MCP spec is skipped with a warning: $warning', ({ yaml, warning }) => {
  const parsed = parse(yaml);
  expect(parsed.warnings).toEqual([warning]);
  expect(parsed.agent).toBeDefined();
  expect(parsed.agent).not.toHaveProperty('mcpServers');
});

test('[A47][C42] hooks in Claude format load with matchers and timeouts', () => {
  const parsed = parse('hooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ./guard.sh\n          timeout: 5\n  SubagentStop:\n    - hooks:\n        - type: command\n          command: ./done.sh\n');
  expect(parsed.agent?.hooks).toEqual({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ command: './guard.sh', timeoutMs: 5000 }] }],
    SubagentStop: [{ hooks: [{ command: './done.sh' }] }],
  });
});

test('[A47] a Stop hook is converted to SubagentStop with a note', () => {
  const parsed = parse('hooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: ./done.sh\n');
  expect(parsed.agent?.hooks).toEqual({ SubagentStop: [{ hooks: [{ command: './done.sh' }] }] });
  expect(parsed.warnings).toEqual(["Agent 'guarded': Converted Stop hook to SubagentStop since it fires when the subagent finishes"]);
});

test.for(['PreToolUse', 'PermissionRequest'])('[A47] top-level %s makes the definition unloadable', (event) => {
  const parsed = parse(`${event}: []\n`);
  expect(parsed.agent).toBeUndefined();
  expect(parsed.error).toBe(`Agent not loaded: Agent 'guarded': ${event} is declared at the frontmatter top level, outside "hooks" — declare guard hooks under "hooks:" with command handlers (/p/a.md)`);
});

test.for([
  { yaml: 'hooks:\n  PreToolUse:\n    - hooks:\n        - type: http\n          url: http://x\n', reason: "hook type 'http' is not supported" },
  { yaml: 'hooks:\n  PermissionRequest:\n    - matcher: 7\n      hooks: []\n', reason: "'matcher' must be a string" },
  { yaml: 'hooks:\n  PreToolUse: nope\n', reason: 'PreToolUse must be a list of hook groups' },
])('[A47] an invalid guard hook makes the definition unloadable: $reason', ({ yaml, reason }) => {
  const parsed = parse(yaml);
  expect(parsed.agent).toBeUndefined();
  expect(parsed.error).toBe(`Agent not loaded: Invalid hooks in agent 'guarded': ${reason} (/p/a.md)`);
});

test('[A47] an invalid non-guard hook is dropped with a note', () => {
  const parsed = parse('hooks:\n  SubagentStart: nope\n');
  expect(parsed.agent).toBeDefined();
  expect(parsed.agent).not.toHaveProperty('hooks');
  expect(parsed.warnings).toEqual(["Agent 'guarded': Ignoring SubagentStart hooks: SubagentStart must be a list of hook groups"]);
});

test('[B26] JSON agent definitions accept mcpServers, permissionMode and requiredMcpServers', () => {
  const [definition] = parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Task', mcpServers: ['docs', { files: { command: 'npx' } }], permissionMode: 'plan', requiredMcpServers: ['docs'] } }), '/tmp');
  expect(definition).toMatchObject({ permissionMode: 'plan', requiredMcpServers: ['docs'], mcpServers: [{ kind: 'ref', name: 'docs' }, { kind: 'inline', name: 'files', config: { command: 'npx' } }] });
});

test('[C44] a runtime-registered plugin agent cannot gain MCP servers or a permission mode', () => {
  const warnings: string[] = [];
  const registry = new RuntimeAgents();
  registry.register({ plugin: 'acme', name: 'scout', spec: { description: 'Scout', prompt: 'Task', mcpServers: [{ files: { command: 'npx' } }], permissionMode: 'bypassPermissions' } });
  const [definition] = registry.definitions((message) => warnings.push(message));
  expect(definition).toMatchObject({ agentType: 'acme:scout', source: 'plugin' });
  expect(definition).not.toHaveProperty('mcpServers');
  expect(definition).not.toHaveProperty('permissionMode');
  expect(warnings).toEqual(['Plugin agent acme:scout sets mcpServers, which is ignored for plugin agents.', 'Plugin agent acme:scout sets permissionMode, which is ignored for plugin agents.']);
});
