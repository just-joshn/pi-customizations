import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { fixturePath } from '../unit/support.ts';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function writeAndCommit(cwd: string, files: Readonly<Record<string, string>>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, 'add', '-A', '--', ...Object.keys(files));
  git(cwd, 'commit', '-qm', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

export function tempRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 's50-'));
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 's50@example.test');
  git(cwd, 'config', 'user.name', 's50 test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(cwd, '.gitignore'), '.s50/\n');
  for (const name of ['leaderboard.2026-10-07.json', 'skill-sources.2026-10-07.json', 'leaderboard.diagnosing-bugs-rank-51.json']) copyFileSync(fixturePath(name), join(cwd, name));
  writeAndCommit(cwd, { 'src/export/csv.ts': 'export const csv = 1;\n', 'docs/readme.md': '# app\n' }, 'init');
  return cwd;
}
