import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const helpers = [
  ['src/subscriptions/supervisor-main.ts', 'dist/supervisor-main.js'],
  ['src/cloud/release-main.ts', 'dist/release-machine.js'],
  ['skills/statechart/scripts/statechart.ts', 'skills/statechart/scripts/statechart.js'],
  ['skills/statechart/scripts/worker.ts', 'skills/statechart/scripts/worker.js'],
];
const check = process.argv.slice(2).includes('--check');

if (Bun.version !== '1.4.4') throw new Error('Helper builds require Bun 1.4.4 to reproduce the committed outputs.');
process.chdir(root);
for (const [entry, output] of helpers) {
  const result = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', external: Object.keys(manifest.peerDependencies), write: false });
  if (!result.success) throw new AggregateError(result.logs, `Could not build ${entry}`);
  const generated = await result.outputs[0].text();
  const path = join(root, output);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== generated) {
      console.error(`Stale helper ${output}. Run bun run build:helpers with Bun 1.4.4.`);
      process.exitCode = 1;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, generated);
  }
  console.log(`${check ? 'Checked' : 'Built'} ${output}`);
}
