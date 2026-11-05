import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(root, '../../extensions/pi-pstack');
const hash = (text) => createHash('sha256').update(text).digest('hex');

// Each mutation reintroduces a plausible defect. The named tests must fail on an assertion, and the file must come back byte for byte.
const mutations = {
  'plugin-background': {
    file: 'src/task/tool.ts',
    find: 'const background = params.run_in_background === true;',
    replace: "const background = params.run_in_background ?? ['poteto-agent', 'ci-watcher'].includes(plan.agent.type);",
    tests: ['test/e2e/task.e2e.test.ts', '-t', 'plugin agent runs in the foreground'],
  },
  'custom-framing': {
    file: 'src/task/agents.ts',
    find: '    reminder: `${framing}\\n\\n${prompt}`,',
    replace: '    reminder: prompt,',
    tests: ['test/task-agents.test.ts', 'test/e2e/task.e2e.test.ts', '-t', 'Cursor'],
  },
  'fast-alias': {
    file: 'src/task/models.ts',
    find: "    if (requested.toLowerCase() === 'fast') return fallback;",
    replace: "    if (requested.toLowerCase() === 'fast') return fastVariant(available, parent);",
    tests: ['test/task-model.test.ts'],
  },
  'resume-type': {
    file: 'src/task/tool.ts',
    find: '  if (params.subagent_type !== undefined && normalizedType(params.subagent_type) !== normalizedType(record.type))',
    replace: '  if (false)',
    tests: ['test/e2e/task.e2e.test.ts', '-t', 'names another subagent_type'],
  },
  'running-text': {
    file: 'src/task/tool.ts',
    find: "const SUBAGENT_RUNNING = 'Sub-agent is currently running. You may send the follow-up message when it has completed.';",
    replace: "const SUBAGENT_RUNNING = 'Agent is busy. Try again later.';",
    tests: ['test/e2e/task.e2e.test.ts', '-t', 'running agent|one writer|another Pi process'],
  },
  'lock-mapping': {
    file: 'src/task/tool.ts',
    find: '    if (!fresh && error instanceof AgentRunningError) throw new Error(SUBAGENT_RUNNING);\n',
    replace: '',
    tests: ['test/e2e/task.e2e.test.ts', '-t', 'another Pi process'],
  },
  'task-description': {
    file: 'src/task/tool.ts',
    find: '  "- The subagent\'s outputs should generally be trusted",',
    replace: '  "- Trust the agent output in general.",',
    tests: ['test/e2e/host.e2e.test.ts', '-t', 'delegation rules'],
  },
  'resume-param': {
    file: 'src/task/tool.ts',
    find: 'Requests to a currently running asynchronous agent fail; wait for completion before resuming.',
    replace: 'A running agent receives the prompt as a steer.',
    tests: ['test/task-text.test.ts'],
  },
  'todo-text': {
    file: 'src/todo.ts',
    find: "  'When in doubt, use this tool. Proactive task management demonstrates attentiveness and ensures complete requirements.',",
    replace: '',
    tests: ['test/e2e/tool-text.e2e.test.ts'],
  },
  'switch-text': {
    file: 'src/plan.ts',
    find: "  '- **User approval required**: Mode switches require user consent',",
    replace: "  '- **User approval required**: The user must approve every switch.',",
    tests: ['test/e2e/tool-text.e2e.test.ts'],
  },
  'await-re2': {
    file: 'src/background-shell.ts',
    find: '    return firstMatcher(pattern);',
    replace: "    const regex = new RegExp(pattern, 'm');\n    return (text: string) => regex.exec(text)?.[0];",
    tests: ['test/background-shell.test.ts', '-t', 'RE2'],
  },
  'await-subagent': {
    file: 'src/background-shell.ts',
    find: "      if (params.waiting_for_subagent === true) throw new Error('You should NOT wait for subagents to complete. End your turn instead; completions are queued, or do parallel work.');\n",
    replace: '',
    tests: ['test/e2e/background-shell.e2e.test.ts', '-t', 'refuses to wait for subagents'],
  },
  'ask-text': {
    file: 'src/ask.ts',
    find: '      \'- Users will always be able to select "Other" to provide custom text input\',',
    replace: '      \'- The user can always pick "Other" and type an answer.\',',
    tests: ['test/e2e/host.e2e.test.ts', '-t', 'AskQuestion'],
  },
  'ask-option-description': {
    file: 'src/ask.ts',
    find: "          label: Type.String({ description: 'Display text for this option' }),\n",
    replace: "          label: Type.String({ description: 'Display text for this option' }),\n          description: Type.Optional(Type.String({ description: 'Detail shown after the label' })),\n",
    tests: ['test/ask.test.ts', 'test/e2e/tool-text.e2e.test.ts'],
  },
  'empty-prompt': {
    file: 'src/task/tool.ts',
    find: "  if (params.prompt.trim() === '') throw new Error('prompt is required');\n",
    replace: '',
    tests: ['test/e2e/task.e2e.test.ts', '-t', 'empty prompt'],
  },
};

const wanted = process.argv.slice(2);
assert.ok(wanted.length > 0 && wanted.every((name) => name in mutations), `name mutations from: ${Object.keys(mutations).join(', ')}`);
const results = [];
for (const name of wanted) {
  const mutation = mutations[name];
  const file = join(pkg, mutation.file);
  const original = readFileSync(file, 'utf8');
  assert.equal(original.split(mutation.find).length, 2, `${name}: the mutation must match exactly once`);
  let run;
  try {
    writeFileSync(file, original.replace(mutation.find, mutation.replace));
    run = spawnSync('bun', ['run', 'test', ...mutation.tests], { cwd: pkg, env: process.env, encoding: 'utf8', timeout: 240_000 });
  } finally {
    writeFileSync(file, original);
  }
  const restored = hash(readFileSync(file, 'utf8')) === hash(original);
  const output = `${run.stdout}\n${run.stderr}`;
  const failed = /(\d+) failed/.exec(output.match(/Tests\s+.*$/m)?.[0] ?? '')?.[1];
  results.push({ name, file: mutation.file, exitCode: run.status, failedTests: failed === undefined ? 0 : Number(failed), assertionFailure: /AssertionError/.test(output), restored });
  writeFileSync(join(root, `evidence/mutation-${name}.txt`), `mutation ${name}: ${mutation.file}\n- ${mutation.find}\n+ ${mutation.replace}\nexit_code: ${run.status}\nrestored: ${restored}\n${output}`);
}
console.log(JSON.stringify(results, null, 2));
for (const result of results) {
  assert.equal(result.restored, true, `${result.name}: source restored`);
  assert.equal(result.exitCode, 1, `${result.name}: the tests must fail`);
  assert.ok(result.failedTests > 0 && result.assertionFailure, `${result.name}: the failure must be an assertion`);
}
