// Scans every file this branch changes against origin/main for credential patterns before publication. The patterns
// are the earlier PR scan's (parity/pstack-reconstruction-2026-11-04/pr-secret-scan.json). Matched values are never
// written, only the file, line, and pattern name.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const source = JSON.parse(readFileSync(join(repo, 'parity/pstack-reconstruction-2026-11-04/pr-secret-scan.json'), 'utf8')).patterns;
// JavaScript has no leading (?i) group, so that prefix becomes the i flag.
const patterns = Object.entries(source).map(([name, pattern]) => [name, pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'gi') : new RegExp(pattern, 'g')]);
const files = [
  ...new Set(
    [...git('diff', '--name-only', 'origin/main...HEAD').split('\n'), ...git('diff', '--name-only', '--cached').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(
      (file) => file !== '' && existsSync(join(repo, file)),
    ),
  ),
].toSorted();
const findings = [];
let scanned = 0;
for (const file of files) {
  const bytes = readFileSync(join(repo, file));
  if (bytes.includes(0)) continue;
  scanned += 1;
  for (const [index, line] of bytes.toString('utf8').split('\n').entries())
    for (const [name, regex] of patterns) {
      regex.lastIndex = 0;
      if (regex.test(line)) findings.push({ file, line: index + 1, pattern: name });
    }
}
const report = { scope: 'Every file changed against origin/main, the index, and untracked authored files. Matched values are never included.', textFilesScanned: scanned, patterns: source, findings };
writeFileSync(join(root, 'evidence/pr-secret-scan.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ textFilesScanned: scanned, findings }, null, 2));
assert.deepEqual(findings, [], 'no credential pattern may reach the public repository');
