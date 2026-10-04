import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const orchDirectory = new URL('../../skills/poteto-mode/scripts/orch/', import.meta.url).pathname;
export const script = join(orchDirectory, 'orch.ts');
const directories: string[] = [];

export type Run = { code: number; stdout: string; stderr: string };

export async function makeDirectory(prefix = 'orch-h-'): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  directories.push(directory);
  return directory;
}

export async function cleanDirectories(): Promise<void> {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
}

export function baseEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const env = { ...process.env, ...extra };
  for (const name of ['ORCH_STORE', 'ORCH_REPO']) if (!(name in extra)) delete env[name];
  return env;
}

export function runCli(args: readonly string[], options: { env?: Record<string, string | undefined>; cwd?: string } = {}): Run {
  const result = spawnSync(process.execPath, [script, ...args], { env: options.env ?? baseEnv(), cwd: options.cwd, encoding: 'utf8' });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Orch', '-c', 'user.email=orch@example.com', ...args], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
}

export async function makeRepo(directory: string, branches: string[]): Promise<string> {
  const repo = join(directory, 'repo');
  await mkdir(repo);
  git(repo, 'init', '-q', '--initial-branch=main');
  await writeFile(join(repo, 'main.txt'), 'main\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'main');
  for (const branch of branches) {
    git(repo, 'checkout', '-q', '-b', branch);
    await writeFile(join(repo, `${branch.replaceAll('/', '_')}.txt`), branch);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', branch);
  }
  return repo;
}

export type GtFixture = { logShort: string; info: Record<string, string> };

export async function installGt(directory: string, repo: string, fixture: GtFixture): Promise<string> {
  const bin = join(directory, 'gt-bin');
  await mkdir(bin, { recursive: true });
  const cases = Object.entries(fixture.info)
    .map(([branch, text]) => `  "--no-interactive info ${branch}")\n    printf '%b\\n' ${JSON.stringify(text)}\n    ;;`)
    .join('\n');
  const body = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${NO_COLOR:-}" != "1" ]; then echo "gt needs NO_COLOR=1" >&2; exit 3; fi
if [ "$(pwd -P)" != "${await realpath(repo)}" ]; then echo "gt ran outside the fixture repo: $(pwd -P)" >&2; exit 2; fi
case "$*" in
  "--no-interactive log short --stack --reverse")
    printf '%b\\n' ${JSON.stringify(fixture.logShort)}
    ;;
${cases}
  *)
    echo "unexpected gt arguments: $*" >&2
    exit 2
    ;;
esac
`;
  await writeFile(join(bin, 'gt'), body);
  await chmod(join(bin, 'gt'), 0o755);
  return bin;
}

export const stackLog = (...branches: string[]): string => ['◯ main', ...branches.map((branch) => `◯ ${branch}`)].join('\n');
