import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const subprocessDeadlineMs = 120000;
const requiredCoverage = 0.8;

export function run(args, cwd) {
  const result = spawnSync('bun', args, { cwd, stdio: 'inherit', timeout: subprocessDeadlineMs });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`bun ${args.join(' ')} failed with ${result.signal ?? result.status}`);
}

export async function enforceCoverage(workspace) {
  const report = await readFile(join(workspace, 'coverage/lcov.info'), 'utf8');
  const sum = (key) => [...report.matchAll(new RegExp(`^${key}:(\\d+)$`, 'gm'))].reduce((total, match) => total + Number(match[1]), 0);
  const files = [...report.matchAll(/^SF:(.+)$/gm)].map((match) => match[1]);
  const metrics = [
    { name: 'lines', hit: sum('LH'), found: sum('LF') },
    { name: 'functions', hit: sum('FNH'), found: sum('FNF') },
  ];
  if (!files.length || metrics.some((metric) => metric.found === 0 || metric.hit > metric.found)) {
    throw new Error('Upstream coverage report is empty or invalid.');
  }
  process.stdout.write(`Upstream coverage includes ${files.length} imported helper files.\n`);
  process.stdout.write(`${files.join('\n')}\n`);
  for (const metric of metrics) {
    process.stdout.write(`${metric.name}: ${metric.hit}/${metric.found} (${((100 * metric.hit) / metric.found).toFixed(2)}%)\n`);
    if (metric.hit / metric.found < requiredCoverage) throw new Error(`Upstream aggregate ${metric.name} coverage is below 80%.`);
  }
}

function runVitest(workspace) {
  const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
  const scripts = 'upstream/skills/poteto-mode/scripts';
  // Keep the existing seven-file helper denominator; Bun-only entrypoints run in child processes.
  const helpers = ['orch/store.ts', 'watch-pr/cli.ts', 'watch-pr/fakes.test-helper.ts', 'watch-pr/github.ts', 'watch-pr/policy.ts', 'watch-pr/render.ts', 'watch-pr/types.ts'];
  const coverage = helpers.flatMap((file) => ['--coverage.include', `${scripts}/${file}`]);
  const result = spawnSync(process.execPath, [vitest, 'run', '--coverage', ...coverage, '--coverage.reporter', 'text', '--coverage.reporter', 'lcov'], { cwd: workspace, stdio: 'inherit', timeout: subprocessDeadlineMs });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`vitest run --coverage failed with ${result.signal ?? result.status}`);
}

async function verify() {
  const workspace = await mkdtemp(join(tmpdir(), 'pi-pstack-upstream-'));
  try {
    const scripts = join(workspace, 'upstream/skills/poteto-mode/scripts');
    const supplemental = join(workspace, 'test/upstream');
    await cp(join(root, 'upstream/skills/poteto-mode/scripts'), scripts, { recursive: true });
    await mkdir(supplemental, { recursive: true });
    const tests = (await readdir(join(root, 'test/upstream'))).filter((name) => name.endsWith('.test.mjs'));
    for (const name of tests) await cp(join(root, 'test/upstream', name), join(supplemental, name));
    await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), 'dir');
    run(['install', '--frozen-lockfile'], scripts);
    runVitest(workspace);
    await enforceCoverage(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) await verify();
