import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function seedGreetingCli(cwd) {
  writeFileSync(
    join(cwd, 'greet'),
    `#!/usr/bin/env python3
import sys
args = sys.argv[1:]
if args == ['--help']:
    print('Usage: greet hello NAME')
    sys.exit(0)
if args == ['--version']:
    print('greet 1.0.0')
    sys.exit(0)
if len(args) == 2 and args[0] == 'hello':
    print('Hello ' + args[1])
    sys.exit(0)
print('Usage: greet hello NAME', file=sys.stderr)
sys.exit(2)
`,
    { mode: 0o755 },
  );
  writeFileSync(join(cwd, 'README.md'), '# Greeting command\nRun `./greet hello Ada`. Help is `./greet --help`. No dependencies or network.\n');
  return join(cwd, 'greet');
}

export function seedLibrary(cwd) {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'greeting-kit', version: '1.0.0', type: 'module', exports: './greet.mjs' }));
  writeFileSync(join(cwd, 'greet.mjs'), `export function greet(name) { return \`Hello \${name}\`; }\n`);
  writeFileSync(join(cwd, 'README.md'), '# Greeting kit\nA library package. Import `greet` from package `greeting-kit` and call it with Ada. No dependencies.\n');
}

export function seedSimplify(cwd) {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'greeting-kit', type: 'module', scripts: { test: 'node --test greeting.test.mjs' } }));
  writeFileSync(join(cwd, 'greeting.mjs'), `export const greet = (name) => \`Hello \${name}\`;\n`);
  writeFileSync(
    join(cwd, 'greeting.test.mjs'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from './greeting.mjs';\ntest('greeting contract', () => { assert.equal(greet('Ada'), 'Hello Ada'); assert.equal(greet(''), 'Hello '); });\n",
  );
  const git = (args) => execFileSync('git', args, { cwd, env: { ...process.env, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe' });
  git(['init', '--quiet']);
  git(['add', 'greeting.mjs', 'greeting.test.mjs', 'package.json']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial greeting']);
  writeFileSync(join(cwd, 'greeting.mjs'), "export function greet(name) {\n  if (name.length === 0) { return 'Hello ' + name; }\n  else { return 'Hello ' + name; }\n}\n");
}
