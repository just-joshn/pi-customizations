import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const sum = key => [...report.matchAll(new RegExp(`^${key}:(\\d+)$`, 'gm'))]
    .reduce((total, match) => total + Number(match[1]), 0);
  const files = [...report.matchAll(/^SF:(.+)$/gm)].map(match => match[1]);
  const metrics = [
    { name: 'lines', hit: sum('LH'), found: sum('LF') },
    { name: 'functions', hit: sum('FNH'), found: sum('FNF') },
  ];
  if (!files.length || metrics.some(metric => metric.found === 0 || metric.hit > metric.found)) {
    throw new Error('Upstream coverage report is empty or invalid.');
  }
  process.stdout.write(`Upstream coverage includes ${files.length} imported helper files.\n`);
  process.stdout.write(`${files.join('\n')}\n`);
  for (const metric of metrics) {
    process.stdout.write(`${metric.name}: ${metric.hit}/${metric.found} (${(100 * metric.hit / metric.found).toFixed(2)}%)\n`);
    if (metric.hit / metric.found < requiredCoverage) throw new Error(`Upstream aggregate ${metric.name} coverage is below 80%.`);
  }
}

async function verify() {
  const workspace = await mkdtemp(join(tmpdir(), 'pi-pstack-upstream-'));
  try {
    await cp(join(root, 'upstream/skills/poteto-mode/scripts'), workspace, { recursive: true });
    await mkdir(join(workspace, 'supplemental'));
    const tests = (await readdir(join(root, 'test/upstream'))).filter(name => name.endsWith('.test.mjs'));
    for (const name of tests) await cp(join(root, 'test/upstream', name), join(workspace, 'supplemental', name));
    await writeFile(join(workspace, 'bunfig.toml'), '[test]\ncoverage = true\ncoverageReporter = ["text", "lcov"]\n');
    run(['install', '--frozen-lockfile'], workspace);
    run(['test', 'orch', 'watch-pr', 'supplemental', '--coverage'], workspace);
    await enforceCoverage(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) await verify();
