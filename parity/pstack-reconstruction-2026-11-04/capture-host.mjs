import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const output = dirname(fileURLToPath(import.meta.url));
const repository = resolve(output, '../..');
const cli = process.argv[2] ?? join(homedir(), '.local/share/cursor-agent/versions/2026.10.22-27dcf5f');
const desktop = process.argv[3] ?? '/usr/share/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js';
const snapshots = [];

for (const [file, names] of [['1623.index.js', ['./src/utils/plan-utils.ts', './src/utils/task-tool.ts', './src/subagent/cli-subagent-host-adapter.ts']]]) {
  const path = join(cli, file);
  const source = readFileSync(path, 'utf8');
  const exports = {};
  new Script(source, { filename: path }).runInNewContext({ exports }, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
  for (const name of names) {
    const factory = exports.modules?.[name];
    if (typeof factory !== 'function') throw new Error(`Reference module missing in ${path}: ${name}`);
    const formatted = spawnSync(join(repository, 'node_modules/.bin/biome'), ['format', '--stdin-file-path=reference.js'], { input: `({${factory.toString()}})\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (formatted.status !== 0) throw new Error(`Cannot format ${name}: ${formatted.stderr}`);
    snapshots.push({ sourcePath: path, sha256: createHash('sha256').update(source).digest('hex'), module: name, extraction: 'Unexecuted webpack factory', content: formatted.stdout });
  }
}

const desktopSource = readFileSync(desktop, 'utf8');
for (const needle of ['CreatePlanArgs', 'async acceptPlan(', 'async _loadPlanExecutionData(', 'async syncTodoUpdatesToFile(']) {
  const offset = desktopSource.indexOf(needle);
  if (offset === -1) throw new Error(`Desktop reference anchor missing: ${needle}`);
  snapshots.push({
    sourcePath: desktop,
    sha256: createHash('sha256').update(desktopSource).digest('hex'),
    anchor: needle,
    offset,
    extraction: 'Bounded raw-source excerpt; not a complete method',
    content: desktopSource.slice(Math.max(0, offset - 200), offset + 6_000),
  });
}

writeFileSync(join(output, 'reference-contracts.json'), `${JSON.stringify(snapshots, null, 2)}\n`);
console.log(`Captured ${snapshots.length} source selections. No reference tool implementation was invoked.`);
