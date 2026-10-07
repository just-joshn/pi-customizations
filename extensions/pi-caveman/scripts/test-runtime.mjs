#!/usr/bin/env node
// Runs upstream's own runtime suite against the vendored @caveman-ai/pi sources,
// building dist/ the way upstream's scripts/bundle.mjs does and linking this
// package's pinned Pi install where the suite expects node_modules.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'vendor', 'caveman', 'packages', 'pi-extension');
const common = { bundle: true, format: 'esm', platform: 'node', target: 'node22', external: ['@earendil-works/*', 'typebox'], logLevel: 'error' };

await build({ entryPoints: [join(pkg, 'src', 'index.ts')], outfile: join(pkg, 'dist', 'index.mjs'), ...common });
await build({ entryPoints: [join(pkg, 'src', 'testable.ts')], outfile: join(pkg, 'dist', 'testable.mjs'), ...common });

const link = join(pkg, 'node_modules');
if (!existsSync(link)) symlinkSync(join(root, 'node_modules'), link, 'dir');

const suites = ['protocol', 'provider', 'provider-compat', 'recovery', 'portable-command', 'integration'].map((name) => join(pkg, 'tests', `${name}.runtime.mjs`));
const run = spawnSync(process.execPath, ['--test', '--test-force-exit', ...suites], { cwd: pkg, stdio: 'inherit' });
rmSync(join(pkg, 'dist'), { recursive: true, force: true });
rmSync(link, { force: true });
process.exit(run.status ?? 1);
