import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRun, summarizeRuns } from '../helpers/resource-workflows-run-outcome.mjs';

const source = [{ type: 'tool_execution_end', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: 'Source contains Hello Ada' }] } }];

test('reading source containing a greeting is not a real CLI interaction', () => {
  assert.equal(evaluateRun({ kind: 'cli', records: source }).eligible, false);
});

test('internal library output cannot establish a working package export', () => {
  assert.equal(evaluateRun({ kind: 'library', records: source, packageExport: { resolved: false } }).eligible, false);
});

test('a server rescued after settlement did not satisfy agent cleanup', () => {
  assert.equal(evaluateRun({ kind: 'server', records: source, cleanup: { survivors: [123] }, rescue: { confirmed: true } }).eligible, false);
});

function attempt(kind, observations) {
  const identity = { attemptId: 'attempt-1', applicationId: 'app-1', executable: '/owned/greet', sha256: 'cli-hash', packageRoot: '/owned/library', port: 49123, socket: '/owned/terminal.sock' };
  return {
    kind,
    mode: 'scripted',
    identity,
    invocation: { error: null },
    calls: [
      { id: 'model-1', toolName: 'bash', modelOrigin: true, success: true },
      { id: 'model-read', toolName: 'read', modelOrigin: true, success: true },
    ],
    observations: observations.map((fact) => ({ provenance: 'protected-runtime', attemptId: 'attempt-1', applicationId: 'app-1', callId: fact.type === 'image-read' ? 'model-read' : 'model-1', ...fact })),
    cleanup: { beforeRescue: true, complete: true, listenerAbsent: true, socketAbsent: true, resources: [{ alive: false, listenerAbsent: true }] },
    rescue: { performed: false, confirmed: true },
  };
}

function facts(kind) {
  if (kind === 'cli') return [{ type: 'exec', executable: '/owned/greet', sha256: 'cli-hash', argv: ['hello', 'Ada'], exitCode: 0, signal: null, stdout: 'Hello Ada\n' }];
  if (kind === 'library')
    return [{ type: 'package-call', specifier: 'greeting-kit', packageRoot: '/owned/library', resolvedThroughExport: true, exportSha256: 'cli-hash', exportName: 'greet', arguments: ['Ada'], result: 'Hello Ada', exitCode: 0 }];
  if (kind === 'server')
    return [
      { type: 'listener', leaseId: 'lease-1', pid: 42, port: 49123, address: '127.0.0.1', ready: true },
      { type: 'http-response', leaseId: 'lease-1', pid: 42, port: 49123, url: '/greet?name=Ada', status: 200, body: 'Hello Ada\n' },
    ];
  if (kind === 'tui')
    return [
      { type: 'terminal-input', socket: '/owned/terminal.sock', paneId: '%0', leaseId: 'tmux-1', key: 's', sequence: 2 },
      { type: 'pane', socket: '/owned/terminal.sock', paneId: '%0', leaseId: 'tmux-1', text: 'Ready\nSettings enabled\n', sequence: 3 },
    ];
  return [
    { type: 'window-ready', windowId: 'window-1', actual: true, sequence: 1 },
    { type: 'click', windowId: 'window-1', target: 'Greet Ada', sequence: 2 },
    { type: 'visible', windowId: 'window-1', text: 'Hello Ada', sequence: 3 },
    { type: 'png', windowId: 'window-1', sha256: 'png-hash', path: '/protected/app.png', valid: true, width: 640, height: 480, sequence: 4 },
    { type: 'image-read', windowId: 'window-1', sha256: 'png-hash', path: '/protected/app.png', sdkImage: true, sequence: 5 },
  ];
}

for (const kind of ['cli', 'library', 'server', 'tui', 'electron', 'playwright']) {
  test(`${kind} complete fact model is eligible but never genuine verification`, () => {
    const result = evaluateRun(attempt(kind, facts(kind)));
    assert.equal(result.eligible, true);
    assert.equal(result.verdict, 'failed');
    assert.equal(result.genuineCompliance, false);
  });
  test(`${kind} missing actual observation fails closed`, () => {
    const result = evaluateRun(attempt(kind, facts(kind).slice(0, -1)));
    assert.equal(result.eligible, false);
    assert.equal(result.missing.includes(`${kind} actual correlated interaction`), true);
  });
  test(`${kind} unrelated application or unpaired call does not count`, () => {
    const input = attempt(kind, facts(kind));
    assert.equal(evaluateRun({ ...input, observations: input.observations.map((fact) => ({ ...fact, applicationId: 'another-app' })) }).eligible, false);
    assert.equal(evaluateRun({ ...input, calls: [{ id: 'model-1', modelOrigin: false, success: true }] }).eligible, false);
  });
}

test('literal CLI output, argv, executable identity, and status are required', () => {
  for (const change of [{ stdout: 'source Hello Ada' }, { argv: ['--help'] }, { executable: '/other/greet' }, { sha256: 'changed' }, { exitCode: 1 }, { signal: 'SIGTERM' }]) {
    assert.equal(evaluateRun(attempt('cli', [{ ...facts('cli')[0], ...change }])).eligible, false);
  }
});

test('a relative internal import cannot replace package resolution', () => {
  for (const change of [{ specifier: './greet.mjs' }, { resolvedThroughExport: false }, { result: 'Wrong Ada' }, { exportSha256: 'changed' }, { arguments: ['Bob'] }]) {
    assert.equal(evaluateRun(attempt('library', [{ ...facts('library')[0], ...change }])).eligible, false);
  }
});

test('request logs cannot replace an owned listener and literal HTTP response', () => {
  for (const change of [{ body: 'Wrong Ada\n' }, { status: 500 }, { leaseId: 'other-lease' }, { pid: 99 }, { url: '/' }]) {
    assert.equal(evaluateRun(attempt('server', [facts('server')[0], { ...facts('server')[1], ...change }])).eligible, false);
  }
});

test('TUI file state cannot replace post-input pane inspection at the owned socket', () => {
  for (const change of [{ socket: '/other.sock' }, { sequence: 1 }, { text: 'Ready' }]) {
    assert.equal(evaluateRun(attempt('tui', [facts('tui')[0], { ...facts('tui')[1], ...change }])).eligible, false);
  }
});

for (const kind of ['electron', 'playwright']) {
  test(`${kind} absent click, different window, fake PNG, and text-only read fail closed`, () => {
    const input = facts(kind);
    for (const index of [0, 1, 2, 3, 4])
      assert.equal(
        evaluateRun(
          attempt(
            kind,
            input.filter((_, i) => i !== index),
          ),
        ).eligible,
        false,
      );
    for (const change of [{ windowId: 'other-window' }, { sdkImage: false }, { sha256: 'other-png' }, { sequence: 0 }]) {
      assert.equal(evaluateRun(attempt(kind, [...input.slice(0, 4), { ...input[4], ...change }])).eligible, false);
    }
    assert.equal(
      evaluateRun(
        attempt(
          kind,
          input.map((fact) => (fact.type === 'png' ? { ...fact, valid: false } : fact)),
        ),
      ).eligible,
      false,
    );
  });
}

test('rescue cannot change the pre-rescue cleanup result', () => {
  const input = attempt('cli', facts('cli'));
  for (const cleanup of [
    { ...input.cleanup, beforeRescue: false },
    { ...input.cleanup, complete: false },
    { ...input.cleanup, listenerAbsent: false, resources: [] },
    { ...input.cleanup, socketAbsent: false, resources: [] },
    { ...input.cleanup, resources: [{ alive: true, listenerAbsent: false }] },
  ]) {
    assert.equal(evaluateRun({ ...input, cleanup, rescue: { performed: true, confirmed: true } }).eligible, false);
  }
});

test('all six recipes are necessary and duplicates cannot replace GUI recipes', () => {
  const inputs = ['cli', 'library', 'server', 'tui', 'electron', 'playwright'].map((kind) => attempt(kind, facts(kind)));
  assert.equal(summarizeRuns(inputs).eligible, true);
  assert.equal(summarizeRuns(inputs).verdict, 'failed');
  assert.equal(summarizeRuns(inputs.slice(0, 4)).eligible, false);
  assert.equal(summarizeRuns([...inputs.slice(0, 4), inputs[0], inputs[1]]).eligible, false);
});

test('missing identity and failed invocation are rejected', () => {
  const input = attempt('cli', facts('cli'));
  assert.equal(evaluateRun({ ...input, identity: null }).eligible, false);
  assert.equal(evaluateRun({ ...input, invocation: { error: 'failed' } }).eligible, false);
  assert.equal(evaluateRun({ ...input, kind: 'unknown' }).eligible, false);
});
