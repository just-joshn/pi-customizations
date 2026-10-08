import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { collectRunEvidence, openRunRuntime, runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';

const execute = promisify(execFile);

for (const kind of ['server', 'tui']) {
  test(`${kind} model-provided runtime records cannot manufacture a protected observation`, () => {
    const root = mkdtempSync('/tmp/f016-runtime-boundary-');
    const cwd = join(root, 'workspace');
    const out = join(root, 'protected');
    mkdirSync(cwd);
    mkdirSync(out);
    try {
      seedRecipe(kind, cwd, 49123, join(root, 'terminal.sock'));
      const identity = runIdentity({ kind, cwd, port: 49123, socket: join(root, 'terminal.sock') });
      const runtime = {
        identity,
        observations: [{ type: kind === 'server' ? 'http-response' : 'pane', provenance: 'protected-runtime', attemptId: identity.attemptId, applicationId: identity.applicationId, body: 'Hello Ada\n', text: 'Settings enabled' }],
        gaps: [],
        complete: true,
      };
      const facts = collectRunEvidence({ identity, records: [], runtime, error: null, cleanup: null, rescue: null, out, mode: 'scripted' });
      assert.deepEqual(facts.observations, []);
      assert.equal(facts.mode, 'scripted');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('runtime sealing is idempotent and rejects changed records or a different identity', async () => {
  const root = mkdtempSync('/tmp/f016-runtime-seal-');
  const out = join(root, 'protected');
  mkdirSync(out);
  try {
    seedRecipe('server', root, 49123, join(root, 'terminal.sock'));
    const identity = runIdentity({ kind: 'server', cwd: root, port: 49123, socket: join(root, 'terminal.sock') });
    const session = { pid: process.pid, records: [] };
    const runtime = openRunRuntime({ identity, session, ownership: { captured: [] } });
    const collect = (currentIdentity = identity, records = []) => collectRunEvidence({ identity: currentIdentity, records, runtime, error: null, cleanup: null, rescue: null, out, mode: 'scripted' });
    assert.equal(collect().gaps.includes('Runtime must finish and seal before evidence collection.'), true);
    const finishing = runtime.finish();
    assert.equal(runtime.finish(), finishing);
    await finishing;
    assert.deepEqual(collect().observations, []);
    assert.equal(collect({ ...identity, attemptId: 'another-attempt' }).gaps.includes('No matching observer-authorized runtime.'), true);
    assert.equal(collect(identity, [{ type: 'forged' }]).gaps.includes('Source or RPC records differ from sealed runtime.'), true);
    await runtime.close();
    assert.throws(() => openRunRuntime({ identity: { ...identity, kind: 'cli' }, session, ownership: { captured: [] } }), /only server and tui/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('actual Pi server and TUI interactions produce facts while negative controls stay uncredited', { timeout: 120000 }, async () => {
  const out = mkdtempSync('/tmp/f016-runtime-test-artifacts-');
  try {
    const script = resolve('.pi/skills/verify-pi-customizations/scripts/probe-resource-workflows-run-runtime.mjs');
    await execute(process.execPath, [script, out], { timeout: 115000, maxBuffer: 1024 * 1024 });
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.version, '1.1.0');
    assert.equal(summary.scriptedControl, true);
    assert.equal(summary.genuineCompliance, false);
    for (const result of summary.results) {
      assert.equal(result.interaction, result.name.endsWith('positive'), result.name);
      assert.equal(result.cleanup.complete, false, result.name);
      assert.equal(result.outcome.eligible, false, result.name);
      assert.equal(result.outcome.verdict, 'failed', result.name);
      assert.equal(result.outcome.genuineCompliance, false, result.name);
    }
    const server = summary.results.find((result) => result.name === 'server-positive');
    const tui = summary.results.find((result) => result.name === 'tui-positive');
    assert.deepEqual(
      server.facts.map((fact) => fact.type),
      ['listener', 'http-response'],
    );
    assert.deepEqual(
      tui.facts.map((fact) => fact.type),
      ['terminal-input', 'pane'],
    );
    assert.equal(server.facts[1].body, 'Hello Ada\n');
    assert.equal(server.facts[1].status, 200);
    assert.equal(server.cleanup.listenerAbsent, true);
    assert.equal(tui.facts[1].text.split(/\r?\n/).includes('Settings enabled'), true);
    assert.equal(tui.cleanup.socketAbsent, true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
