// Compares the tool descriptions a live Cursor CLI session declared with the ones real Pi declares for pi-pstack.
// Writes the word-level differences to the ignored .audit tree and prints only similarity numbers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const pkg = join(repo, 'extensions/pi-pstack');
const live = join(repo, '.audit/pi-pstack-behavior-parity/cursor-evidence');
const out = join(repo, '.audit/pstack-source-audit-2026-11-05/tool-text');

function cursorTools() {
  const tools = new Map();
  for (const file of ['dynamic-tool-schemas.jsonl', 'task-schema.jsonl']) {
    const walk = (value) => {
      if (typeof value === 'string' && value.startsWith('{"tool":')) {
        const tool = JSON.parse(value);
        if (!tools.has(tool.tool)) tools.set(tool.tool, tool.description);
      } else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) walk(child);
    };
    for (const line of readFileSync(join(live, file), 'utf8').trim().split('\n')) walk(JSON.parse(line));
  }
  return tools;
}

function piDescriptions(names) {
  const sandbox = mkdtempSync(join(tmpdir(), 'pstack-tool-text-'));
  try {
    const agentDir = join(sandbox, 'agent');
    const workDir = join(sandbox, 'work');
    mkdirSync(agentDir);
    mkdirSync(workDir);
    const extensions = [join(pkg, 'test/fixtures/scripted-model.ts'), join(pkg, 'test/fixtures/image-model.ts')];
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [pkg], extensions, quietStartup: true }));
    const prompts = names.map((name) => `describe\n@@tool-description ${name}`);
    const run = spawnSync('pi', ['--mode', 'json', '--offline', '--no-session', '--model', 'scripted/echo', ...prompts], {
      cwd: workDir,
      env: { ...process.env, HOME: sandbox, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const texts = run.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === 'message_end' && event.message.role === 'assistant')
      .map((event) => event.message.content.map((part) => part.text ?? '').join(''));
    assert.equal(texts.length, names.length);
    return new Map(names.map((name, index) => [name, texts[index]]));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Longest common subsequence over words: the share of Cursor's words Pi keeps in order.
function similarity(cursor, pi) {
  const a = cursor.split(/\s+/).filter(Boolean);
  const b = pi.split(/\s+/).filter(Boolean);
  const previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(previous[j], previous[j - 1]);
      diagonal = above;
    }
  }
  const common = previous[b.length];
  return { cursorWords: a.length, piWords: b.length, keptOfCursor: Number((common / a.length).toFixed(3)), piFromCursor: Number((common / b.length).toFixed(3)) };
}

const cursor = cursorTools();
const names = ['Task', 'TodoWrite', 'SwitchMode', 'GenerateImage', 'AwaitShell'];
const pi = piDescriptions(names);
mkdirSync(out, { recursive: true });
const report = {};
for (const name of names) {
  const cursorText = cursor.get(name);
  const piText = pi.get(name);
  assert.ok(cursorText !== undefined && piText !== undefined, name);
  report[name] = similarity(cursorText, piText);
  writeFileSync(join(out, `${name}.cursor.txt`), `${cursorText}\n`);
  writeFileSync(join(out, `${name}.pi.txt`), `${piText}\n`);
}
writeFileSync(join(root, 'evidence/tool-text-similarity.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
