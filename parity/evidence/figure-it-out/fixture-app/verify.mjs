import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const notesPath = join(root, 'notes.json');
const isoLine =
  /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z .+$/;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function runCli() {
  const result = spawnSync(process.execPath, [join(root, 'src/cli.js')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(`cli exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout.replace(/\r\n/g, '\n').trimEnd().split('\n');
}

if (existsSync(notesPath)) {
  unlinkSync(notesPath);
}

const first = runCli();
if (!existsSync(notesPath)) {
  fail('notes.json missing after first cli run');
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(notesPath, 'utf8'));
} catch (error) {
  fail(`notes.json not valid JSON: ${error.message}`);
}

if (!Array.isArray(parsed) || parsed.length < 2) {
  fail('notes.json must be an array with seed notes');
}

const texts = parsed.map((n) => (typeof n === 'string' ? n : n.text));
if (!texts.includes('alpha') || !texts.includes('beta')) {
  fail(`notes.json missing seed texts, got ${JSON.stringify(texts)}`);
}

if (first.length !== texts.length) {
  fail(`cli line count ${first.length} != notes ${texts.length}`);
}

for (const line of first) {
  if (!isoLine.test(line)) {
    fail(`line missing ISO timestamp: ${JSON.stringify(line)}`);
  }
}

for (const text of ['alpha', 'beta']) {
  if (!first.some((line) => line.endsWith(` ${text}`) || line.endsWith(text))) {
    fail(`cli output missing note ${text}: ${JSON.stringify(first)}`);
  }
}

const second = runCli();
if (JSON.stringify(second) !== JSON.stringify(first)) {
  fail(`second run differed from first:\n${second.join('\n')}\nvs\n${first.join('\n')}`);
}

console.log('PASS: notes.json persisted; CLI loads it; every line has ISO timestamp');
