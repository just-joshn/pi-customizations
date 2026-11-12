import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const helpers = [
  ['generated/skills/poteto-mode/scripts/watch-pr/cli.ts', 'dist/watch-pr.js'],
  ['src/worker-host.ts', 'dist/worker-host.js'],
  ['src/automation/routine-cli.mjs', 'dist/routine-setup.js'],
  ['src/automation/serve-cli.ts', 'dist/automation-serve.js'],
  ['generated/skills/statechart/scripts/statechart.ts', 'dist/statechart.js'],
  ['generated/skills/statechart/scripts/worker.ts', 'dist/worker.js'],
];
const check = process.argv.slice(2).includes('--check');
// The two automation CLI bundles run as plain `node <pkg>/dist/...` from an installed package, where Pi does not
// install its host packages as siblings, so they must not import them. Typebox is bundled directly (small, pure, and
// used by the schemas those bundles keep); the pi packages are redirected to scripts/pi-standalone-shims.mjs, which
// inlines the two small pi-ai functions they execute and stands in for the pi-coding-agent symbols they never call.
const standalone = new Set(['src/automation/routine-cli.mjs', 'src/automation/serve-cli.ts']);
const shimPath = fileURLToPath(new URL('./pi-standalone-shims.mjs', import.meta.url));
// worker-host.ts detects its main entry with `process.argv[1] === fileURLToPath(import.meta.url)`. That holds for
// dist/worker-host.js (its entry), but when worker-host.ts is inlined into another bundle the same check matches the
// bundle's own URL, so running that bundle directly would also run the worker host. The standalone automation bundles
// are never the worker host, so its main guard is stripped to a no-op (Bun then tree-shakes the host body).
const workerHostMainGuard = 'if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {';
const standaloneShims = {
  name: 'pi-standalone-shims',
  setup(build) {
    for (const specifier of ['@earendil-works/pi-ai', '@earendil-works/pi-ai/compat', '@earendil-works/pi-coding-agent']) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({ path: shimPath }));
    }
    build.onLoad({ filter: /worker-host\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes(workerHostMainGuard)) throw new Error(`worker-host.ts no longer carries its main guard; update ${import.meta.url}`);
      return { contents: source.replace(workerHostMainGuard, 'if (false) {'), loader: 'ts' };
    });
  },
};

process.chdir(root);
const receiptPath = join(root, 'dist/helpers.json');
const inputs = createHash('sha256');
for (const directory of ['src', 'generated']) {
  for (const file of readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.split('/').includes('node_modules'))
    .map((entry) => join(entry.parentPath, entry.name)).sort()) {
    inputs.update(file).update('\0').update(readFileSync(file)).update('\0');
  }
}
for (const file of ['package.json', 'scripts/build-helpers.mjs', 'scripts/pi-standalone-shims.mjs']) inputs.update(file).update('\0').update(readFileSync(file)).update('\0');
const inputHash = inputs.digest('hex');
const receipt = { inputs: inputHash, outputs: {} };
if (check) {
  const built = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : undefined;
  for (const [, output] of helpers) {
    const path = join(root, output);
    const hash = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;
    if (built?.inputs !== inputHash || hash === undefined || built?.outputs[output] !== hash) {
      console.error(`Stale helper ${output}. Run bun run build:helpers with Bun 1.4.4.`);
      process.exitCode = 1;
    } else {
      console.log(`Checked ${output}`);
    }
  }
  process.exit(process.exitCode ?? 0);
}
if (Bun.version !== '1.4.4') throw new Error('Helper builds require Bun 1.4.4 to reproduce the committed outputs.');
for (const [entry, output] of helpers) {
  const inlineHostPackages = standalone.has(entry);
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    external: inlineHostPackages ? [] : Object.keys(manifest.peerDependencies),
    plugins: inlineHostPackages ? [standaloneShims] : [],
    write: false,
  });
  if (!result.success) throw new AggregateError(result.logs, `Could not build ${entry}`);
  const generated = await result.outputs[0].text();
  const path = join(root, output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generated);
  receipt.outputs[output] = createHash('sha256').update(generated).digest('hex');
  console.log(`Built ${output}`);
}
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
