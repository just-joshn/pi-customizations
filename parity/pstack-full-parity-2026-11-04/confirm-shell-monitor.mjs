import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ShellOutputWatch } from '../../extensions/pi-pstack/src/shell-output-watch.ts';

const [evidenceArg, destinationArg] = process.argv.slice(2);
if (!evidenceArg || !destinationArg) throw new Error('Usage: node confirm-shell-monitor.mjs <reference-evidence-directory> <output-directory>');
const destination = resolve(destinationArg);
mkdirSync(destination, { recursive: true });
const seed = 0x5053544b;
let state = seed;
const next = (maximum) => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % maximum;
};
const patterns = ['HIT', '(?i)hit', '^READY', 'END$', 'é|€', '[A-Z]+', '.', '(?s).', '$'];
const pieces = ['HIT', 'x', '\n', 'READY', '€', 'é', ' ', 'abc', '9', 'END', '\r\n', '🚀'];
const cases = Array.from({ length: 256 }, (_, index) => {
  const text = Array.from({ length: next(100) + 1 }, () => pieces[next(pieces.length)]).join('');
  const steps = [];
  let offset = 0;
  while (offset < text.length) {
    const end = offset + 1 + next(16);
    steps.push({ write: text.slice(offset, end) });
    offset = end;
  }
  steps.push({ finish: true });
  return { id: `CONFIRM-SHELL-${String(index + 1).padStart(3, '0')}`, name: `seed ${seed} case ${index + 1}`, pattern: patterns[next(patterns.length)], reason: 'differential match', steps };
});
const inputs = join(destination, 'inputs.json');
const expected = join(destination, 'original-results.json');
writeFileSync(inputs, `${JSON.stringify(cases)}\n`);
const original = spawnSync(process.execPath, [resolve('parity/pstack-full-parity-2026-11-04/reference-shell-monitor.mjs'), resolve(evidenceArg), expected, inputs], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60_000 });
assert.equal(original.status, 0, original.stderr);
const reference = JSON.parse(readFileSync(expected, 'utf8'));
let checkpoints = 0;
for (const scenario of reference.cases) {
  const notices = [];
  const watch = new ShellOutputWatch(scenario, (notice) => notices.push(notice));
  try {
    for (const [index, step] of scenario.steps.entries()) {
      if ('write' in step) watch.observe(step.write);
      else watch.finish();
      assert.deepEqual(notices, scenario.checkpoints[index], `${scenario.id} step ${index + 1}`);
      checkpoints += 1;
    }
  } finally {
    watch.finish(false);
  }
}
const result = {
  verdict: 'VERIFIED',
  scope: 'Only deterministic streamed-text monitor cases. This is not a full plugin or live Cursor workflow verdict.',
  seed,
  cases: reference.cases.length,
  checkpoints,
  comparison: 'Original shipped observer compared with the native monitor. Expected results generated without importing pi-pstack.',
};
writeFileSync(join(destination, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
