import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectDifferential, evidenceMapLinks, readOwnedJson } from '../helpers/resource-workflows-implementation-evidence.mjs';

const ids = Object.freeze(['help', 'version', 'greeting', 'empty-name', 'unicode', 'invalid']);

function writeSide(root, side, items) {
  const dir = join(root, 'comparison', side);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'probes.jsonl'), items.map((item) => JSON.stringify(item)).join('\n'));
}

function fixture(t, python = false) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'implementation-evidence-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const target = join(cwd, 'reference');
  const artifact = join(cwd, 'greet.pyz');
  const driver = join(cwd, 'differential.py');
  const cases = join(cwd, 'cases.json');
  const out = join(cwd, 'comparison');
  const observations = ids.map((id, index) => ({ id, args: [id], code: index === 5 ? 2 : 0, stdout: Buffer.from(`result ${id}\n`).toString('base64'), stderr: Buffer.from(index === 5 ? 'invalid argument\n' : '').toString('base64') }));
  const sides = ['reference', 'candidate'].map((side) =>
    observations.map((item) => {
      const dir = join(out, side);
      mkdirSync(dir, { recursive: true });
      const streams = Object.fromEntries(
        ['stdout', 'stderr'].map((stream) => {
          const path = join(dir, `${item.id}.${stream}`);
          writeFileSync(path, Buffer.from(item[stream], 'base64'));
          return [stream, { path }];
        }),
      );
      const prefix = side === 'reference' ? [target] : python ? ['python3', artifact] : [artifact];
      return { id: item.id, argv: [...prefix, ...item.args], exit_code: item.code, signal: null, timed_out: false, launch_error: null, capture_complete: true, ...streams };
    }),
  );
  sides.forEach((items, index) => {
    writeSide(cwd, index === 0 ? 'reference' : 'candidate', items);
  });
  const candidate = python ? `python3 ${artifact}` : artifact;
  const command = `python3 ${driver} run ${cases} --reference ${target} --candidate "${candidate}" --out ${out}`;
  const output = ['reference', 'candidate'].flatMap((side) => observations.map((item) => `${side} ${JSON.stringify({ id: item.id, exit_code: item.code, signal: null, timed_out: false })}`)).join('\n');
  const records = [
    { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'differential-call', args: { command } },
    { type: 'tool_execution_end', toolName: 'bash', toolCallId: 'differential-call', isError: false, result: { content: [{ type: 'text', text: output }] } },
  ];
  return { cwd, target, artifact, driver, cases, out, sides, records, reference: { observations } };
}

function collect(value, records = value.records) {
  return collectDifferential({ ...value, records });
}

for (const python of [false, true]) {
  test(`identifies all six literal streams for ${python ? 'Python-launched' : 'executable'} packaged comparison`, (t) => {
    const value = fixture(t, python);
    assert.deepEqual(collect(value), {
      code: 0,
      signal: null,
      error: null,
      reference: value.target,
      candidate: value.artifact,
      cases: value.cases,
      ids: ['help', 'version', 'greeting', 'empty-name', 'unicode', 'invalid'],
      matched: true,
      toolCallId: 'differential-call',
      output: value.out,
    });
  });
}

for (const field of ['driver', 'target', 'artifact', 'cases']) {
  test(`does not credit a differential invocation for a different ${field}`, (t) => {
    const value = fixture(t);
    assert.equal(collect({ ...value, [field]: join(value.cwd, 'other') }), null);
  });
}

for (const recordChange of [
  { name: 'no execution', select: () => [] },
  { name: 'missing completion', select: (records) => records.slice(0, 1) },
  { name: 'failed completion', select: (records) => records.map((item) => (item.type === 'tool_execution_end' ? { ...item, isError: true } : item)) },
  { name: 'foreign completion', select: (records) => records.map((item) => (item.type === 'tool_execution_end' ? { ...item, toolCallId: 'foreign' } : item)) },
  { name: 'unsupported command', select: (records) => records.map((item) => (item.type === 'tool_execution_start' ? { ...item, args: { command: 'cat cases.json' } } : item)) },
]) {
  test(`does not infer successful execution from ${recordChange.name}`, (t) => {
    const value = fixture(t);
    assert.equal(collect(value, recordChange.select(value.records)), null);
  });
}

for (const text of ['reference {}', 'reference not-json', 'reference {broken}', '']) {
  test(`rejects incomplete or malformed printed observations ${JSON.stringify(text)}`, (t) => {
    const value = fixture(t);
    const records = value.records.map((item) => (item.type === 'tool_execution_end' ? { ...item, result: { content: [{ type: 'text', text }] } } : item));
    assert.equal(collect(value, records), null);
  });
}

test('rejects twelve printed records that duplicate one case and omit another', (t) => {
  const value = fixture(t);
  const records = value.records.map((item) => (item.type === 'tool_execution_end' ? { ...item, result: { content: [{ type: 'text', text: item.result.content[0].text.replaceAll('"id":"version"', '"id":"help"') }] } } : item));
  assert.equal(collect(value, records), null);
});

for (const change of [
  { name: 'different argv', patch: { argv: ['wrong-program'] } },
  { name: 'different status', patch: { exit_code: 99 } },
  { name: 'signal exit', patch: { signal: 'SIGTERM' } },
  { name: 'timeout', patch: { timed_out: true } },
  { name: 'launch error', patch: { launch_error: 'permission denied' } },
  { name: 'incomplete capture', patch: { capture_complete: false } },
]) {
  test(`retains execution identity but rejects ${change.name}`, (t) => {
    const value = fixture(t);
    writeSide(
      value.cwd,
      'candidate',
      value.sides[1].map((item, index) => (index === 0 ? { ...item, ...change.patch } : item)),
    );
    assert.equal(collect(value).matched, false);
  });
}

for (const stream of ['stdout', 'stderr']) {
  test(`rejects changed literal ${stream} bytes`, (t) => {
    const value = fixture(t);
    writeFileSync(value.sides[1][0][stream].path, 'different bytes');
    assert.equal(collect(value).matched, false);
  });
}

test('rejects duplicate raw case identities', (t) => {
  const value = fixture(t);
  writeSide(
    value.cwd,
    'reference',
    value.sides[0].map((item, index) => (index === 1 ? { ...item, id: 'help' } : item)),
  );
  assert.equal(collect(value).matched, false);
});

test('does not read a raw stream symlink escaping the owned workspace', (t) => {
  const value = fixture(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'implementation-outside-')));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const path = value.sides[1][0].stdout.path;
  writeFileSync(join(outside, 'matching'), 'result help\n');
  rmSync(path);
  symlinkSync(join(outside, 'matching'), path);
  assert.equal(collect(value).matched, false);
});

test('does not credit missing or malformed differential evidence', (t) => {
  const value = fixture(t);
  const path = join(value.out, 'reference/probes.jsonl');
  writeFileSync(path, 'not-json');
  assert.equal(collect(value), null);
  rmSync(path);
  assert.equal(collect(value), null);
});

test('reads owned JSON without treating malformed or escaped input as evidence', (t) => {
  const value = fixture(t);
  const path = join(value.cwd, 'metadata.json');
  writeFileSync(path, '{"id":"help"}');
  assert.deepEqual(readOwnedJson(path, value.cwd), { id: 'help' });
  writeFileSync(path, 'broken');
  assert.equal(readOwnedJson(path, value.cwd), null);
  assert.equal(readOwnedJson(join(value.cwd, 'missing'), value.cwd), null);
  assert.equal(readOwnedJson(null, value.cwd), null);
  assert.equal(readOwnedJson(path, value.out), null);
});

test('resolves implementation, test, and probe links against actual owned files', (t) => {
  const value = fixture(t);
  writeFileSync(value.artifact, 'packaged bytes');
  writeFileSync(join(value.cwd, 'probe.json'), '{"id":"help","referenceSha256":"captured-hash"}');
  const map = [{ case: 'help', implementation: 'greet.pyz', test: 'comparison/reference/probes.jsonl#help', probe: 'probe.json' }];
  assert.deepEqual(evidenceMapLinks(map, value.cwd), [{ case: 'help', implementationPresent: true, testId: 'help', probeId: 'help', referenceSha256: 'captured-hash' }]);
  assert.deepEqual(evidenceMapLinks([{ ...map[0], test: 'comparison/reference/probes.jsonl#different' }], value.cwd)[0].testId, null);
  writeFileSync(value.artifact, '');
  assert.equal(evidenceMapLinks(map, value.cwd)[0].implementationPresent, false);
  writeFileSync(join(value.cwd, 'probe.json'), 'broken');
  assert.equal(evidenceMapLinks(map, value.cwd)[0].probeId, null);
  rmSync(value.artifact);
  assert.deepEqual(evidenceMapLinks(map, value.cwd), [{ case: 'help', implementationPresent: false, testId: null, probeId: null }]);
  assert.deepEqual(evidenceMapLinks(null, value.cwd), []);
  assert.deepEqual(evidenceMapLinks([], value.cwd), []);
  assert.ok(readFileSync(join(value.out, 'candidate/probes.jsonl')).length > 0);
});
