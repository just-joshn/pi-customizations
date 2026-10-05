import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { formatLeakReport, groupLeaks, isToolCache, type LiveProcess, parseDu, parseLiveProcesses, parseLsofCwd } from './leaks.ts';

// Vitest pool workers and test children exit shortly after teardown starts. A leaked server never does.
const GRACE_MS = 5000;
const POLL_MS = 250;

export type RunDir = {
  readonly dir: string;
  readonly previous: Readonly<Record<string, string | undefined>>;
};

function capture(command: string, args: readonly string[]): { out: string; pid: number } {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { out: result.stdout ?? '', pid: result.pid ?? 0 };
}

function commandLines(pids: readonly number[]): Map<number, string> {
  const lines = new Map<number, string>();
  if (pids.length === 0) return lines;
  const ps = capture('ps', ['-ww', '-o', 'pid=,command=', '-p', pids.join(',')]);
  for (const line of ps.out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match?.[1] && match[2]) lines.set(Number(match[1]), match[2].slice(0, 300));
  }
  return lines;
}

// Matches the run directory in a process environment (ps -E) or working directory (lsof). The
// environment is only used to find pids, so secrets in it never reach the report.
function liveProcesses(dir: string): LiveProcess[] {
  const ps = capture('ps', ['-axwwE', '-o', 'pid=,command=']);
  const lsof = capture('lsof', ['-d', 'cwd', '-Fpn']);
  const ignored = new Set([process.pid, process.ppid, ps.pid, lsof.pid]);
  const found = new Set([...parseLiveProcesses(ps.out, dir, ignored).map((proc) => proc.pid), ...parseLsofCwd(lsof.out, dir, ignored).map((proc) => proc.pid)]);
  const lines = commandLines([...found]);
  return [...found].filter((pid) => lines.has(pid)).map((pid) => ({ pid, command: lines.get(pid) ?? '' }));
}

async function liveProcessesAfterGrace(dir: string): Promise<LiveProcess[]> {
  const deadline = Date.now() + GRACE_MS;
  let live = liveProcesses(dir);
  while (live.length > 0 && Date.now() < deadline) {
    await sleep(POLL_MS);
    live = liveProcesses(dir);
  }
  return live;
}

// The base stays short because macOS unix socket paths are limited to 104 bytes.
export function openRunDir(): RunDir {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pv-'));
  const previous = { TMPDIR: process.env['TMPDIR'] };
  process.env['TMPDIR'] = dir;
  return { dir, previous };
}

// Prints the report, removes the directory unless processes still use it, and returns the failure.
export async function closeRunDir(run: RunDir): Promise<string | undefined> {
  const { dir } = run;
  const entries = parseDu(capture('du', ['-k', '-d', '1', dir]).out, dir);
  const groups = groupLeaks(entries.filter((entry) => !isToolCache(entry.name)));
  const caches = groupLeaks(entries.filter((entry) => isToolCache(entry.name)));
  const live = await liveProcessesAfterGrace(dir);
  process.stderr.write(formatLeakReport(dir, groups, live, caches));
  for (const [key, value] of Object.entries(run.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (live.length > 0) {
    process.stderr.write(`[leak-report] keeping ${dir} because processes are still running\n`);
    return `${live.length} process(es) started under ${dir} are still alive`;
  }
  rmSync(dir, { recursive: true, force: true });
  if (groups.length > 0) return `${groups.length} leaked temp prefix(es) left under ${dir}`;
  return undefined;
}
