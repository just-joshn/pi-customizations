#!/usr/bin/env node
// Retry wrapper for one capture side. Runs capture-setup-journeys.mjs until the attempt
// follows the canonical two-panel shape (six inputs: command, palette enter, per panel
// Space+Enter) and writes the skill-prescribed budget line. Every attempt is retained in
// the evidence root; non-matching runs are variance evidence, not deleted. Protocol per
// parity/progress.md: keep all attempts, close the pair only on a matching shape.
//
// Usage: node scripts/retry-setup-side.mjs [--cursor-only|--pi-only] [maxRounds]
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const side = process.argv[2] ?? '--cursor-only';
const maxRounds = Number(process.argv[3] ?? 3);
const name = side === '--cursor-only' ? 'cursor' : 'pi';
const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'setup-prepair');

const expectedInputs = ['/setup-pstack', '\r', '\r', ' ', '\r', ' ', '\r'];
const readInputs = async (attemptDir) => {
  const events = (await readFile(join(attemptDir, 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return events.filter((event) => event.kind === 'input_dispatched').map((event) => Buffer.from(event.dataB64, 'base64').toString('utf8'));
};

for (let round = 1; round <= maxRounds; round += 1) {
  const result = JSON.parse(execFileSync('node', [join(root, 'scripts', 'capture-setup-journeys.mjs'), side], { encoding: 'utf8' }));
  const attemptDir = result.sides[name].attemptDir;
  const inputs = await readInputs(attemptDir);
  let ruleLine = null;
  try {
    const written = await readFile(join(evidenceRoot, name, 'written-rule.mdc'), 'utf8');
    ruleLine = written.split('\n').find((line) => line.startsWith('# budget:')) ?? null;
  } catch {
    ruleLine = null;
  }
  const canonical = JSON.stringify(inputs) === JSON.stringify(expectedInputs);
  const budgetOk = ruleLine === '# budget: unlimited (max)';
  console.log(JSON.stringify({ side: name, round, attemptDir, inputs: inputs.length, canonical, budgetOk, ruleLine }));
  if (canonical && budgetOk) {
    console.log(JSON.stringify({ side: name, status: 'canonical', attemptDir, writtenDigest: result.sides[name].writtenDigest }));
    process.exit(0);
  }
}
console.log(JSON.stringify({ side: name, status: 'no-canonical-run', rounds: maxRounds }));
process.exit(1);