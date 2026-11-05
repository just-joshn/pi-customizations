import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const raw = join(root, '../../.audit/pstack-source-audit-2026-11-05/source');
class Message {
  constructor(fields) {
    Object.assign(this, fields);
  }
}
const agents = runInNewContext(readFileSync(join(raw, 'desktop-agent-definitions.txt'), 'utf8') + '\n({ build: Jle, find: Wle })', { $: new Proxy({}, { get: () => Message }) });
const disabled = agents.build({ customSubagents: [], includeBestOfNRunnerSubagent: false });
const enabled = agents.build({ customSubagents: [], includeShellSubagent: true, includeBestOfNRunnerSubagent: false });
assert.equal(
  disabled.some((agent) => agent.subagent_type.type.case === 'shell'),
  false,
);
const shell = enabled.find((agent) => agent.subagent_type.type.case === 'shell');
assert.ok(shell);
const toolInputs = ['SHELL', 'READ', 'WRITE', 'TASK', 'AWAIT', 'FETCH_MCP_RESOURCE'].map((toolIdentifier) => ({ toolIdentifier }));
const shellTools = shell.toolsOverride(toolInputs).map((tool) => tool.toolIdentifier);
assert.deepEqual(Array.from(shellTools), ['SHELL']);
assert.equal(shell.preserveTaskTool, false);
const aliases = ['shell', 'SHELL', 'shell_agent', ' shell-subagent-type ', 'shellmode'];
for (const alias of aliases) assert.equal(agents.find(enabled, alias), shell);
assert.equal(agents.find(enabled, 'shellfish'), undefined);

const module = runInNewContext(`({${readFileSync(join(raw, 'cli-custom-commands.txt'), 'utf8')}})`);
const exports = {};
const require = (id) => (id.endsWith('selected_context_pb.js') ? { Ps: Message } : {});
require.d = (target, getters) => {
  for (const [key, get] of Object.entries(getters)) Object.defineProperty(target, key, { get });
};
module['./src/commands/custom-commands.ts']({}, exports, require);
const commandHost = new exports.FD({}, { userHomeDirectory: '/isolated-reference-probe' });
commandHost.commands.set('review', { id: 'review', content: 'Review $1, then $2. All $ARGUMENTS.', fullPath: '/commands/review.md' });
commandHost.commands.set('plain', { id: 'plain', content: 'Plain command.', fullPath: '/commands/plain.md' });
const commandInputs = ['/review "two words" tail', 'please /review a b\nthen /plain extra', '/plain one /review two', '/plain a\n/plain b', '/plain'];
const commands = commandInputs.map((input) => ({ input, commands: commandHost.findCommandReferences(input).map((entry) => ({ ...entry })) }));
assert.equal(commands[0].commands[0].content, 'Review "two, then words". All "two words" tail.');
assert.equal(commands[2].commands.length, 1);
assert.equal(commands[3].commands.length, 1);
assert.equal(commands[4].commands[0].content, 'Plain command.');
const results = {
  method: 'Execute pinned source excerpts with protobuf constructors replaced by plain record constructors. No Cursor process, remote service, model, or agent is used.',
  shell: {
    availableWhenDisabled: false,
    availableWhenEnabled: true,
    tools: Array.from(shellTools),
    preserveTaskTool: shell.preserveTaskTool,
    description: shell.description,
    reminder: shell.systemReminder({}),
    acceptedAliases: aliases,
    unknownType: 'not found',
  },
  commands,
};
writeFileSync(join(root, 'evidence/reference-probes.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
