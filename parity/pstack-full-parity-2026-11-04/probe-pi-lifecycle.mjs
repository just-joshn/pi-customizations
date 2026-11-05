import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { makeSandbox } from '../../extensions/pi-pstack/test/e2e/harness.ts';

const [piArg, destinationArg] = process.argv.slice(2);
if (!piArg || !destinationArg) throw new Error('Usage: node probe-pi-lifecycle.mjs <installed-pi-executable> <output-directory>');
const destination = resolve(destinationArg);
mkdirSync(destination, { recursive: true });
const sandbox = makeSandbox({ packages: [] });
const probe = join(sandbox.root, 'lifecycle-probe.ts');
writeFileSync(
  probe,
  `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function probe(pi: ExtensionAPI) {
  for (const phase of ['agent_end', 'agent_before_settle', 'agent_settled'] as const) {
    pi.on(phase, (_event, ctx) => {
      process.stderr.write(JSON.stringify({ probe: 'lifecycle', phase, signalDefined: ctx.signal !== undefined, aborted: ctx.signal?.aborted ?? null }) + '\\n');
    });
  }
}
`,
);
try {
  const args = [
    '--mode',
    'json',
    '--offline',
    '--model',
    'scripted/echo',
    '--no-session',
    '--no-extensions',
    '-e',
    probe,
    '-e',
    resolve('extensions/pi-pstack/src/index.ts'),
    '-e',
    resolve('extensions/pi-pstack/test/fixtures/scripted-model.ts'),
    'deterministic lifecycle probe',
  ];
  const run = spawnSync(resolve(piArg), args, { cwd: sandbox.workDir, env: sandbox.env, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(destination, 'stdout.jsonl'), run.stdout ?? '');
  writeFileSync(join(destination, 'stderr.txt'), run.stderr ?? '');
  assert.equal(run.status, 0, run.stderr);
  const observations = run.stderr
    .split('\n')
    .filter((line) => line.startsWith('{"probe":"lifecycle"'))
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    observations.map((event) => event.phase),
    ['agent_end', 'agent_before_settle', 'agent_settled'],
  );
  const result = { scope: 'Actual installed Pi lifecycle signal availability. Does not reproduce or fix a cancellation hang.', pi: resolve(piArg), observations };
  writeFileSync(join(destination, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  sandbox.dispose();
}
