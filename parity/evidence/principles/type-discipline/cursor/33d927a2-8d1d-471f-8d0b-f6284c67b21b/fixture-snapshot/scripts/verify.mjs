#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const ticketUrl = `${pathToFileURL(join(root, 'src', 'ticket.ts')).href}?t=${Date.now()}`;

const runner = `
import { describe, loadCases } from ${JSON.stringify(ticketUrl)};
const cases = loadCases();
const lines = [];
let error = null;
try {
  for (const t of cases) lines.push(describe(t));
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}
const joined = lines.join('|');
const hasOpen = lines.includes('open:a');
const hasDone = lines.includes('done:b@2026-10-08');
const ok = error === null && hasOpen && hasDone && cases.length >= 2;
console.log(JSON.stringify({ ok, joined, error, count: cases.length, lines }));
`;

const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', runner], {
  encoding: 'utf8',
  cwd: root,
});

let parsed = { ok: false, joined: '', error: run.stderr || 'runner failed', count: 0, lines: [] };
try {
  const stdout = (run.stdout || '').trim().split('\n').filter(Boolean).at(-1);
  if (stdout) parsed = JSON.parse(stdout);
} catch {
  parsed = { ok: false, joined: '', error: (run.stderr || run.stdout || 'parse failed').trim(), count: 0, lines: [] };
}

const line = parsed.ok
  ? `TYPE-OK value=${JSON.stringify(parsed.joined)}`
  : `TYPE-FAIL value=${JSON.stringify(parsed.joined)} error=${JSON.stringify(parsed.error ?? 'none')} count=${parsed.count}`;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(parsed.ok ? 0 : 1);
