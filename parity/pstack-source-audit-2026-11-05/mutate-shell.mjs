import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(root, '../../extensions/pi-pstack');
const file = join(pkg, 'src/task/agents.ts');
const original = readFileSync(file, 'utf8');
const before = createHash('sha256').update(original).digest('hex');
const needle = "  onlyTools: ['bash', 'bash_background'],";
assert.equal(original.split(needle).length, 2, 'Mutation must match exactly one shell restriction');
let outcome;
try {
  writeFileSync(file, original.replace(needle, "  tools: ['bash', 'bash_background'],"));
  outcome = spawnSync('bun', ['run', 'test', 'test/e2e/shell-agent.e2e.test.ts', '--testNamePattern', 'shell exposes|shell executes'], { cwd: pkg, env: process.env, encoding: 'utf8', timeout: 60_000 });
} finally {
  writeFileSync(file, original);
}
const after = createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(before, after, 'Restore must preserve every source byte');
assert.ok(outcome);
const text = `${outcome.stdout}\n${outcome.stderr}`;
writeFileSync(join(root, 'evidence/shell-mutation.txt'), `mutation: replace exact shell restriction with additive tools\nsource_sha256_before: ${before}\nsource_sha256_after: ${after}\nexit_code: ${outcome.status}\n${text}`);
assert.equal(outcome.status, 1, 'Mutated tests must fail normally, not time out or crash');
assert.match(text, /2 failed/, 'Both tool-list and actual file-editing assertions must reject the mutation');
assert.match(text, /AssertionError/, 'The failure must be an assertion, not a loader failure');
console.log('Mutation rejected by both behavioral checks. Original source restored byte for byte.');
