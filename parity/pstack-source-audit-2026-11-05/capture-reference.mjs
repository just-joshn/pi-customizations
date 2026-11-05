import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const repo = resolve(output, '../..');
const pluginRoot = process.env.PSTACK_REFERENCE_ROOT ?? '/home/josh/Documents/GitHub/plugins';
const desktopRoot = process.env.CURSOR_DESKTOP_ROOT ?? '/usr/share/cursor/resources/app';
const cliRoot = process.env.CURSOR_CLI_ROOT ?? '/home/josh/.local/share/cursor-agent/versions/2026.10.22-27dcf5f';
const revision = 'bb68f2365eceafa0cb2d253112f675acf5f144cc';
assert.equal(execFileSync('git', ['-C', pluginRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision);
assert.equal(execFileSync('git', ['-C', pluginRoot, 'status', '--porcelain', '--', 'pstack', 'cursor-team-kit'], { encoding: 'utf8' }).trim(), '');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push({ path: relative(pluginRoot, path), sha256: hash(readFileSync(path)) });
  }
}
for (const component of ['pstack', 'cursor-team-kit', 'pr-review-canvas', 'create-plugin']) walk(join(pluginRoot, component));
const captures = [];
function capture(id, path, begin, end, includeEnd = 0) {
  const bytes = readFileSync(path);
  const source = bytes.toString('utf8');
  const start = source.indexOf(begin);
  assert.notEqual(start, -1, `${id}: start marker missing`);
  const finish = source.indexOf(end, start + begin.length);
  assert.notEqual(finish, -1, `${id}: end marker missing`);
  const text = source.slice(start, finish + includeEnd);
  // Cursor's code stays out of the public repository: raw captures go to the ignored .audit tree.
  const file = `.audit/pstack-source-audit-2026-11-05/source/${id}.txt`;
  mkdirSync(join(repo, '.audit/pstack-source-audit-2026-11-05/source'), { recursive: true });
  writeFileSync(join(repo, file), text + '\n');
  captures.push({ id, source: path, sourceSha256: hash(bytes), startUtf16: start, endUtf16: finish + includeEnd, excerptSha256: hash(text), file });
  return text;
}
const desktop = join(desktopRoot, 'extensions/cursor-local-agent-runtime/dist/main.js');
capture('desktop-agent-definitions', desktop, 'const Ile=new Set(["GLOB"', 'const Vle=');
capture('desktop-agent-tool-filter', desktop, 'return e.toolsGenerator({...s,subagentConfig:t})', 'function EIe(');
capture('desktop-agent-registration', desktop, 'u=Jle({customSubagents:H,', 'computerUseSubagentOverrides:e.computerUseSubagentOverrides');
capture('cli-custom-commands', join(cliRoot, '1623.index.js'), '"./src/commands/custom-commands.ts"', '},"./src/', 1);
const app = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'));
const product = JSON.parse(readFileSync(join(desktopRoot, 'product.json'), 'utf8'));
const baseline = {
  repositoryStart: '0632cee3ef7d7507861974184b9faed49e5b28cb',
  reference: { root: pluginRoot, revision, pstack: '0.15.36', teamKit: '1.2.0' },
  desktop: { root: desktopRoot, cursorVersion: app.cursorVersion ?? app.version, packageVersion: app.version, distro: app.distro, commit: product.commit },
  cli: { root: cliRoot, version: '2026.10.22-27dcf5f' },
  pi: { version: '1.5.0', root: '/home/josh/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent' },
  referenceFiles: files,
  captures,
};
writeFileSync(join(output, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
console.log(JSON.stringify({ reference: baseline.reference, desktop: baseline.desktop, files: files.length, captures: captures.map((entry) => ({ id: entry.id, start: entry.startUtf16, end: entry.endUtf16 })) }, null, 2));
