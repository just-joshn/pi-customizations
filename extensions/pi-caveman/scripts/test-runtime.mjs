#!/usr/bin/env node
// Runs upstream's own runtime suite against the vendored @caveman-ai/pi sources,
// building dist/ the way upstream's scripts/bundle.mjs does and linking this
// package's pinned Pi install where the suite expects node_modules.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'vendor', 'caveman', 'packages', 'pi-extension');
const common = { bundle: true, format: 'esm', platform: 'node', target: 'node22', external: ['@earendil-works/*', 'typebox'], logLevel: 'error' };

const link = join(pkg, 'node_modules');
// The suites run from a sibling copy so ../dist still resolves and the vendored files are never written.
const suiteDir = join(pkg, 'tests-host');
let status = 1;
try {
  cpSync(join(pkg, 'tests'), suiteDir, { recursive: true });
  await admitHostSdk(join(suiteDir, 'provider-compat.runtime.mjs'));
  await build({ entryPoints: [join(pkg, 'src', 'index.ts')], outfile: join(pkg, 'dist', 'index.mjs'), ...common });
  await build({ entryPoints: [join(pkg, 'src', 'testable.ts')], outfile: join(pkg, 'dist', 'testable.mjs'), ...common });
  if (!existsSync(link)) symlinkSync(join(root, 'node_modules'), link, 'dir');
  const suites = ['protocol', 'provider', 'provider-compat', 'recovery', 'portable-command', 'integration'].map((name) => join(suiteDir, `${name}.runtime.mjs`));
  status = spawnSync(process.execPath, ['--test', '--test-force-exit', ...suites], { cwd: pkg, stdio: 'inherit' }).status ?? 1;
} finally {
  rmSync(suiteDir, { recursive: true, force: true });
  rmSync(join(pkg, 'dist'), { recursive: true, force: true });
  rmSync(link, { force: true });
}
process.exit(status);

// Upstream's compat suite asserts the exact pi-ai version it reviewed. A newer host
// SDK is admitted only when its dist differs from that pin in exactly the files
// recorded in sdk-review.json and every routed provider keeps its catalog hosts.
async function admitHostSdk(compat) {
  const source = readFileSync(compat, 'utf8');
  const pinned = /\.version, "([^"]+)", "Review compat detection/.exec(source)?.[1];
  const hostDir = join(root, 'node_modules', '@earendil-works', 'pi-ai');
  const host = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf8')).version;
  if (!pinned) throw new Error('upstream compat suite no longer names its reviewed pi-ai version');
  if (host === pinned) return;
  const review = JSON.parse(readFileSync(join(root, 'scripts', 'sdk-review.json'), 'utf8'));
  if (review.upstreamPin !== pinned || review.host !== host) {
    throw new Error(`pi-ai ${host} differs from upstream's reviewed ${pinned}; review it and update scripts/sdk-review.json`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'caveman-sdk-'));
  try {
    const url = `https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-${pinned}.tgz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not download ${url}: HTTP ${response.status}`);
    const tarball = join(scratch, 'pi-ai.tgz');
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
    const untar = spawnSync('tar', ['xzf', tarball, '-C', scratch], { encoding: 'utf8' });
    if (untar.status !== 0) throw new Error(`could not unpack pi-ai@${pinned}: ${untar.stderr}`);
    const pinnedDist = join(scratch, 'package', 'dist');
    const hostDist = join(hostDir, 'dist');
    const changed = [...new Set([...listFiles(pinnedDist), ...listFiles(hostDist)])]
      .filter((file) => !file.endsWith('.map'))
      .filter((file) => !existsSync(join(pinnedDist, file)) || !existsSync(join(hostDist, file)) || !readFileSync(join(pinnedDist, file)).equals(readFileSync(join(hostDist, file))))
      .sort();
    const expected = [...review.changedFiles].sort();
    if (JSON.stringify(changed) !== JSON.stringify(expected)) {
      throw new Error(`pi-ai ${pinned} -> ${host} changed files differ from the review:\n${changed.join('\n')}`);
    }
    for (const provider of ['anthropic', 'openai', 'google', 'opencode-go']) {
      const hosts = (dist) => {
        const file = join(dist, 'providers', 'data', `${provider}.json`);
        return existsSync(file) ? [...new Set([...readFileSync(file, 'utf8').matchAll(/"baseUrl":"([^"]+)"/g)].map((m) => new URL(m[1]).host))].sort().join() : '';
      };
      if (hosts(pinnedDist) !== hosts(hostDist)) throw new Error(`pi-ai ${host} moved ${provider} to another host`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(compat, source.replace(`.version, "${pinned}", "Review compat detection`, `.version, "${host}", "Review compat detection`));
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(join(dir, name)).isDirectory() ? listFiles(join(dir, name), rel) : [rel];
  });
}
