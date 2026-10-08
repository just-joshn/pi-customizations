import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { reservePort, seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { collectRunEvidence, runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';
import { evaluateRun, summarizeRuns } from '../helpers/resource-workflows-run-outcome.mjs';
import { openRunOwnership } from '../helpers/resource-workflows-run-ownership.mjs';
import { surfaceContract } from '../helpers/resource-workflows-surfaces.mjs';

export function writeOutcomeReceipt({ repoRoot, receipts }, outcome) {
  const { expected } = surfaceContract(readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8'), outcome.surfaceId);
  return receipts.write({ ...outcome, expected });
}

async function runAttempt({ kind, repoRoot, artifactDir }) {
  const root = mkdtempSync('/tmp/rw-');
  const out = join(artifactDir, kind);
  const port = await reservePort();
  const socket = join(root, 'terminal.sock');
  const fixture = makeLocalSession({ root, out, repoRoot, localPorts: ['server', 'playwright'].includes(kind) ? [port] : [] });
  const ownership = openRunOwnership({ pid: fixture.session.pid, port: ['server', 'playwright'].includes(kind) ? port : null, socket: kind === 'tui' ? socket : null });
  try {
    seedRecipe(kind, fixture.cwd, port, socket);
    const identity = runIdentity({ kind, cwd: fixture.cwd, port, socket });
    let error = null;
    try {
      await fixture.session.prompt(
        `/skill:run Run my ${kind} project at ${fixture.cwd} and try its main interaction. ${kind === 'tui' ? 'Open settings with s, capture the pane, then quit with q. Use only the tmux socket in the README.' : kind === 'server' ? 'Request the greeting route with Ada.' : 'Greet Ada.'} Use already-installed tools only. This project is offline. Do not download anything. Stop any processes you start.`,
      );
    } catch (failure) {
      error = failure.message;
    }
    const cleanup = await ownership.snapshot();
    const facts = collectRunEvidence({ identity, records: fixture.session.records, error, cleanup, rescue: null, out });
    const rescue = await ownership.rescue();
    const attempt = { ...facts, rescue };
    const outcome = evaluateRun(attempt);
    cpSync(fixture.cwd, join(out, 'workspace'), { recursive: true });
    writeFileSync(join(out, 'attempt.json'), `${JSON.stringify({ attempt, outcome }, null, 2)}\n`);
    return attempt;
  } finally {
    ownership.close();
    try {
      await ownership.rescue();
    } finally {
      await fixture.session.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}

export default async function drive({ repoRoot, artifactDir, receipts }) {
  let attempts = [];
  for (const kind of ['cli', 'electron', 'library', 'playwright', 'server', 'tui']) attempts = [...attempts, await runAttempt({ kind, repoRoot, artifactDir })];
  mkdirSync(artifactDir, { recursive: true });
  const summary = join(artifactDir, 'summary.json');
  writeFileSync(summary, `${JSON.stringify(attempts, null, 2)}\n`);
  writeOutcomeReceipt(
    { repoRoot, receipts },
    {
      surfaceId: 'RS-SKILL-2',
      package: 'skills',
      observed: JSON.stringify(attempts),
      evidence: summary,
      verdict: summarizeRuns(attempts).verdict,
      reason:
        'All six correlated application interactions and pre-rescue cleanup are required. Missing runtime collectors and incomplete descendant capture fail closed. Rescue never credits agent cleanup. Eligible evidence still requires independent genuine-workflow review.',
    },
  );
}
