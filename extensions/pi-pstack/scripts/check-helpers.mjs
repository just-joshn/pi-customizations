import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const statechart = 'generated/skills/statechart/scripts';
const suites = [
  ['bun', ['test', 'watch-pr', 'check-plan.test.ts'], 'generated/skills/poteto-mode/scripts'],
  [process.execPath, ['--disable-warning=ExperimentalWarning', '--test', ...readdirSync(new URL(`../${statechart}/test/`, import.meta.url)).filter((name) => name.endsWith('.test.ts')).map((name) => `test/${name}`)], statechart],
];
console.log('Required runtimes: Bun for watch-pr and check-plan; Node 22.18 to 22.x or Node 23.6 and later with TypeScript support for statechart. Java and TLA2TOOLS enable optional live TLC tests.');
console.log('Preinstall package dev dependencies, including commander, fast-check, pele, mermaid and jsdom. This check never installs dependencies.');
for (const [runtime, args, directory] of suites) {
  console.log(`Running ${runtime} ${args.join(' ')} in ${directory}`);
  const result = spawnSync(runtime, args, { cwd: `${root}/${directory}`, env: { ...process.env, TMPDIR: realpathSync(tmpdir()) }, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exitCode = 1;
}
