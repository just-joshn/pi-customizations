export type Entry = { readonly name: string; readonly kb: number };
export type LeakGroup = { readonly prefix: string; readonly count: number; readonly kb: number };
export type LiveProcess = { readonly pid: number; readonly command: string };

// Node and jiti cache compiled modules under TMPDIR by design. They are content-addressed tool
// caches that speed up child pi startup, so they are listed apart and never counted as leaks.
const TOOL_CACHES: ReadonlySet<string> = new Set(['node-compile-cache', 'jiti']);

export function isToolCache(name: string): boolean {
  return TOOL_CACHES.has(name);
}

const RANDOM_SUFFIX = /^(.+?)[-.][A-Za-z0-9]{6}$/;

export function leakPrefix(name: string): string {
  const match = RANDOM_SUFFIX.exec(name);
  return match?.[1] ? match[1] : name;
}

export function groupLeaks(entries: readonly Entry[]): LeakGroup[] {
  const byPrefix = new Map<string, LeakGroup>();
  for (const entry of entries) {
    const prefix = leakPrefix(entry.name);
    const seen = byPrefix.get(prefix);
    byPrefix.set(prefix, {
      prefix,
      count: (seen?.count ?? 0) + 1,
      kb: (seen?.kb ?? 0) + entry.kb,
    });
  }
  return [...byPrefix.values()].sort((a, b) => b.kb - a.kb || b.count - a.count);
}

// `du -k -d 1` prints one "<kb>\t<path>" line per child and a final line for the directory itself.
export function parseDu(output: string, dir: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    if (path === dir || !path.startsWith(`${dir}/`)) continue;
    entries.push({ name: path.slice(dir.length + 1), kb: Number(line.slice(0, tab)) });
  }
  return entries;
}

// `ps -axwwE -o pid=,command=` appends each process environment to its command line.
export function parseLiveProcesses(
  output: string,
  dir: string,
  ignoredPids: ReadonlySet<number>,
): LiveProcess[] {
  const processes: LiveProcess[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const pid = Number(match[1]);
    if (ignoredPids.has(pid) || !match[2].includes(dir)) continue;
    processes.push({ pid, command: match[2] });
  }
  return processes;
}

export function parseLsofCwd(
  output: string,
  dir: string,
  ignoredPids: ReadonlySet<number>,
): LiveProcess[] {
  const processes: LiveProcess[] = [];
  let pid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && line.slice(1).startsWith(dir) && !ignoredPids.has(pid)) {
      processes.push({ pid, command: `cwd ${line.slice(1)}` });
    }
  }
  return processes;
}

export function formatLeakReport(
  dir: string,
  groups: readonly LeakGroup[],
  processes: readonly LiveProcess[],
  caches: readonly LeakGroup[] = [],
): string {
  const lines = [`[leak-report] run directory ${dir}`];
  for (const cache of caches) lines.push(`[leak-report] tool cache ${cache.prefix} ${cache.kb} KB`);
  if (groups.length === 0) lines.push('[leak-report] no leftover entries');
  for (const group of groups) {
    lines.push(
      `[leak-report] ${String(group.count).padStart(5)} x ${group.prefix} ${group.kb} KB`,
    );
  }
  for (const proc of processes) {
    lines.push(`[leak-report] LIVE pid ${proc.pid}: ${proc.command.slice(0, 300)}`);
  }
  return `${lines.join('\n')}\n`;
}
