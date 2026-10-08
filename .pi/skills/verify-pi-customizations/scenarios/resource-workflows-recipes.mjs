import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { openGuiBridge } from '../helpers/resource-workflows-gui-bridge.mjs';
import { reservePort, seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { canonicalRunCommands, collectRunEvidence, openRunRuntime, runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';
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
  const socket = join(root, 'terminal.sock');
  let fixture;
  let ownership;
  let runtime;
  let gui;
  try {
    const port = await reservePort();
    fixture = makeLocalSession({ root, out, repoRoot, localPorts: ['server', 'playwright'].includes(kind) ? [port] : [] });
    ownership = openRunOwnership({ pid: fixture.session.pid, port: ['server', 'playwright'].includes(kind) ? port : null, socket: kind === 'tui' ? socket : null });
    seedRecipe(kind, fixture.cwd, port, socket);
    if (['electron', 'playwright'].includes(kind)) gui = await openGuiBridge({ kind, root, out, cwd: fixture.cwd });
    const identity = runIdentity({ kind, cwd: fixture.cwd, port, socket });
    if (['server', 'tui'].includes(kind)) runtime = openRunRuntime({ identity, session: fixture.session, ownership });
    const boundedRecipe = runtime
      ? ` For this bounded fixture, choose separate bash calls from these exact launch, interaction, inspection when present, and cleanup commands. ${JSON.stringify(canonicalRunCommands(identity))} Inspect the actual result before cleanup. These commands include a short observation dwell. Do not replace them with source reading or marker files.`
      : gui
        ? ` The owned finite GUI client is ${process.execPath} ${gui.cli}. It accepts one action per call, launch, read, input, click, capture, or close. Runtime release is held. Do not replace a rejected launch with a simulated window, fabricated observation, or another app. Do not write receipts. Report the actual rejection. The seeded application must match the independently sealed guest application before Root can release this capability.`
        : '';
    let error = null;
    try {
      await fixture.session.prompt(
        `/skill:run Run my ${kind} project at ${fixture.cwd} and try its main interaction. ${kind === 'tui' ? 'Open settings with s, capture the pane, then quit with q. Use only the tmux socket in the README.' : kind === 'server' ? 'Request the greeting route with Ada.' : 'Greet Ada.'} Use already-installed tools only. This project is offline. Do not download anything. Stop any processes you start.${boundedRecipe}`,
      );
    } catch (failure) {
      error = failure.message;
    }
    await runtime?.finish();
    if (gui) writeFileSync(join(out, 'gui-preparation.json'), `${JSON.stringify({ application: gui.application, ...gui.snapshot() }, null, 2)}\n`);
    const cleanup = await ownership.snapshot();
    const facts = collectRunEvidence({ identity, records: fixture.session.records, error, cleanup, rescue: null, out, runtime });
    const rescue = await ownership.rescue();
    const attempt = { ...facts, rescue };
    const outcome = evaluateRun(attempt);
    cpSync(fixture.cwd, join(out, 'workspace'), { recursive: true });
    writeFileSync(join(out, 'attempt.json'), `${JSON.stringify({ attempt, outcome }, null, 2)}\n`);
    return attempt;
  } finally {
    await gui?.close();
    await runtime?.close();
    ownership?.close();
    try {
      await ownership?.rescue();
    } finally {
      await fixture?.session.close();
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
        'All six correlated application interactions and pre-rescue cleanup are required. Missing GUI runtime observations and incomplete descendant capture fail closed. Rescue never credits agent cleanup. Eligible evidence still requires independent genuine-workflow review.',
    },
  );
}
