import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { seedGreetingCli, seedLibrary } from '../helpers/resource-workflows-fixtures.mjs';
import { seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { collectRunEvidence, modelCalls, runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';

test('unpaired successful tool text is not a completed model call', () => {
  assert.deepEqual(modelCalls([{ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'fake', isError: false, result: { content: [{ type: 'text', text: 'Hello Ada' }] } }]), []);
});

function records(command, output = 'Hello Ada\n') {
  return [
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'm1', name: 'bash', arguments: { command } }] } },
    { type: 'tool_execution_start', toolCallId: 'm1', toolName: 'bash', args: { command } },
    { type: 'tool_execution_end', toolCallId: 'm1', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: output }] } },
  ];
}

function withFixture(kind, run) {
  const cwd = mkdtempSync('/tmp/f016-run-evidence-');
  const out = mkdtempSync('/tmp/f016-run-evidence-protected-');
  try {
    if (kind === 'cli') seedGreetingCli(cwd);
    else if (kind === 'library') seedLibrary(cwd);
    else seedRecipe(kind, cwd, 49123, join(cwd, 'tmux.sock'));
    const identity = runIdentity({ kind, cwd, port: 49123, socket: join(cwd, 'tmux.sock') });
    const collect = (capture) => collectRunEvidence({ identity, records: capture, error: null, cleanup: { beforeRescue: true, complete: false, resources: [] }, rescue: null, out, mode: 'scripted' });
    run({ cwd, out, identity, collect });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

test('only canonical owned CLI execution produces an executable observation', () => {
  withFixture('cli', ({ collect, out }) => {
    assert.deepEqual(
      collect(records('./greet hello Ada')).observations.map((fact) => [fact.type, fact.argv, fact.stdout]),
      [['exec', ['hello', 'Ada'], 'Hello Ada\n']],
    );
    for (const command of ['cat README.md', 'cat greet', 'echo "Hello Ada"', './greet hello Ada; echo "Hello Ada"']) assert.deepEqual(collect(records(command)).observations, []);
    assert.deepEqual(collect(records('./greet hello Ada', 'Wrong Ada')).observations, []);
    const stored = JSON.parse(readFileSync(join(out, 'protected-run-evidence.json'), 'utf8'));
    assert.equal(stored.mode, 'scripted');
    assert.equal(stored.invocation.error, null);
  });
});

test('package call requires the bare package export, unchanged source, and literal output', () => {
  withFixture('library', ({ collect, cwd }) => {
    const command = `node --input-type=module -e 'import { greet } from "greeting-kit"; process.stdout.write(greet("Ada") + "\\n");'`;
    assert.deepEqual(
      collect(records(command)).observations.map((fact) => [fact.type, fact.specifier, fact.result]),
      [['package-call', 'greeting-kit', 'Hello Ada']],
    );
    assert.deepEqual(collect(records(command.replace('greeting-kit', './greet.mjs'))).observations, []);
    writeFileSync(join(cwd, 'package.json'), '{"name":"greeting-kit","exports":"./missing.mjs"}');
    assert.deepEqual(collect(records(command)).observations, []);
  });
});

test('missing assistant call, mismatched args, failed tool, and missing result stay unpaired', () => {
  const input = records('./greet hello Ada');
  assert.deepEqual(modelCalls(input.slice(1)), []);
  assert.deepEqual(modelCalls(input.slice(0, 1)), []);
  assert.deepEqual(modelCalls(input.slice(0, 2)), []);
  assert.deepEqual(modelCalls([input[0], { ...input[1], args: { command: 'echo Hello' } }, input[2]]), []);
  assert.equal(modelCalls([input[0], input[1], { ...input[2], isError: true }])[0].success, false);
  assert.deepEqual(modelCalls([{ type: 'message_end', message: { role: 'user', content: input[0].message.content } }, ...input.slice(1)]), []);
});

test('missing GUI runtime observations remain missing rather than text-derived', () => {
  for (const kind of ['electron', 'playwright', 'server', 'tui']) {
    withFixture(kind, ({ collect }) => {
      const input = collect(records('echo "Hello Ada"'));
      assert.deepEqual(input.observations, []);
      assert.equal(
        input.gaps.some((gap) => gap.includes('Workspace marker files are not runtime observations.')),
        true,
      );
    });
  }
});
