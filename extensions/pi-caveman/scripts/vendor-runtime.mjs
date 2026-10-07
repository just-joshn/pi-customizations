#!/usr/bin/env node
// Copies upstream's native Pi runtime (@caveman-ai/pi: proxy routing, caveman_retrieve,
// lifecycle bridge, tool-output shrinking) and its runtime tests into vendor/caveman,
// keeping upstream's directory layout so its relative imports resolve unchanged.
// Each file gains one banner line and is otherwise byte-identical to the pinned commit.
// Usage: node scripts/vendor-runtime.mjs <caveman checkout>   (write)
//        node scripts/vendor-runtime.mjs --check              (verify against UPSTREAM.json pin)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'vendor', 'caveman');
const pin = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8')).commit;
const ROOTS = ['packages/pi-extension/src', 'packages/pi-extension/tests', 'packages/cli/src/provider-routing.ts', 'packages/cli/src/portable-command.ts', 'packages/cli/tests/harness/stub-agent.mjs'];
const EXTRA = ['packages/pi-extension/NOTICE', 'packages/pi-extension/LICENSE', 'packages/pi-extension/README.md'];

function banner(path) {
  return `// Vendored from JuliusBrussee/caveman ${pin} ${path} (Apache-2.0) by scripts/vendor-runtime.mjs. Do not edit.\n`;
}

function stamp(path, text) {
  if (!/\.(?:ts|mjs)$/.test(path)) return text;
  if (!text.startsWith('#!')) return banner(path) + text;
  const end = text.indexOf('\n') + 1;
  return text.slice(0, end) + banner(path) + text.slice(end);
}

function upstreamFile(checkout, path) {
  return readFileSync(join(checkout, path), 'utf8');
}

function listFiles(base, path) {
  const full = join(base, path);
  if (!existsSync(full)) throw new Error(`upstream path missing: ${path}`);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => listFiles(base, `${path}/${entry.name}`));
}

function expected(checkout) {
  const files = [...ROOTS.flatMap((path) => listFiles(checkout, path)), ...EXTRA].sort();
  return new Map(files.map((path) => [path, stamp(path, upstreamFile(checkout, path))]));
}

function vendoredFiles() {
  if (!existsSync(target)) return [];
  return readdirSync(target, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(target, join(entry.parentPath, entry.name)))
    .filter((path) => !path.includes('/dist/') && !path.includes('node_modules'));
}

const checkMode = process.argv[2] === '--check';
const checkout = resolve(checkMode ? (process.env.CAVEMAN_CHECKOUT ?? '/tmp/caveman') : (process.argv[2] ?? ''));
if (!existsSync(join(checkout, 'packages', 'pi-extension'))) {
  process.stderr.write('usage: vendor-runtime.mjs <caveman checkout> | --check (CAVEMAN_CHECKOUT defaults to /tmp/caveman)\n');
  process.exit(2);
}
const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== pin) {
  process.stderr.write(`checkout is at ${head}, UPSTREAM.json pins ${pin}\n`);
  process.exit(2);
}
const want = expected(checkout);

if (checkMode) {
  const drift = [];
  for (const [path, text] of want) {
    const file = join(target, path);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) drift.push(`changed or missing: ${path}`);
  }
  for (const path of vendoredFiles()) if (!want.has(path)) drift.push(`unexpected: ${path}`);
  if (drift.length > 0) {
    process.stderr.write(`${drift.join('\n')}\nrun: node scripts/vendor-runtime.mjs <caveman checkout>\n`);
    process.exit(1);
  }
  process.stdout.write(`vendor/caveman matches ${pin} (${want.size} files)\n`);
} else {
  rmSync(target, { recursive: true, force: true });
  for (const [path, text] of want) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), text);
  }
  process.stdout.write(`vendored ${want.size} files from ${pin}\n`);
}
