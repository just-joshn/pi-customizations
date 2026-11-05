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
