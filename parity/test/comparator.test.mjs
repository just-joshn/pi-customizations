import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { comparePair } from '../comparator/compare.mjs';

const event = (seq, kind, fields = {}) => ({
  seq,
  monoNs: String(1000 + seq),
  utc: `2026-01-01T00:00:0${seq}.000Z`,
  kind,
  ...fields,
});

async function writeAttempt(root, side, { output = Buffer.from('same'), pid = 100, fixtureDigest = 'sha256:fixture' } = {}) {
  const attemptId = `${side}-attempt-id`;
  const dir = join(root, side, attemptId);
  await mkdir(dir, { recursive: true });
  const identity = {
    schema: 1,
    attemptId,
    side,
    scenarioRef: 'scenario:test',
    fixtureRef: fixtureDigest === null ? null : { path: `/fixtures/${side}`, digest: fixtureDigest },
  };
  const events = [
    event(0, 'launch_intent'),
    event(1, 'process_started', { pid }),
    event(2, 'output', { dataB64: output.toString('base64') }),
    event(3, 'exited', { exitCode: 0, signal: null }),
    event(4, 'drained'),
    event(5, 'sealed', { eventCount: 6 }),
  ];
  await writeFile(join(dir, 'identity.json'), `${JSON.stringify(identity)}\n`);
  await writeFile(join(dir, 'events.jsonl'), `${events.map((value) => JSON.stringify(value)).join('\n')}\n`);
  return { attemptId, dir };
}

async function writePair({ cursor = {}, pi = {}, omit, fixtureDigest = 'sha256:fixture' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'comparator-'));
  const sides = {};
  if (omit !== 'cursor') sides.cursor = await writeAttempt(root, 'cursor', { fixtureDigest, ...cursor });
  if (omit !== 'pi') sides.pi = await writeAttempt(root, 'pi', { fixtureDigest, ...pi });
  const pair = {
    schema: 1,
    pairId: 'pair-id',
    scenarioRef: 'scenario:test',
    fixtureDigest,
    steps: [],
    ...sides,
  };
  const path = join(root, 'pair.json');
  await writeFile(path, `${JSON.stringify(pair, null, 2)}\n`);
  return path;
}

test('identical stable observables yield zero differences', async () => {
  const report = await comparePair(await writePair());

  expect(report.verdict).toBe('pass');
  expect(report.pass).toBe(true);
  expect(report.counts).toEqual({
    rawOutputDifferences: 0,
    normalizations: 0,
    inputDifferences: 0,
    outcomeDifferences: 0,
    unexplainedDifferences: 0,
  });
  expect(report.hasUnexplainedDifferences).toBe(false);
});

test('one flipped output byte is retained with byte and event offsets', async () => {
  const report = await comparePair(await writePair({ cursor: { output: Buffer.from('abc') }, pi: { output: Buffer.from('axc') } }));

  expect(report.verdict).toBe('fail');
  expect(report.differences.rawOutput).toEqual([
    {
      offset: 1,
      cursor: { byte: 0x62, seq: 2, eventByteOffset: 1 },
      pi: { byte: 0x78, seq: 2, eventByteOffset: 1 },
    },
  ]);
  expect(report.differences.unexplainedOutput[0].offset).toBe(1);
  expect(report.counts.unexplainedDifferences).toBe(1);
});

test('a proven process id difference is normalized and listed', async () => {
  const report = await comparePair(
    await writePair({
      cursor: { pid: 123, output: Buffer.from('pid=123') },
      pi: { pid: 456, output: Buffer.from('pid=456') },
    }),
  );

  expect(report.verdict).toBe('pass');
  expect(report.counts.rawOutputDifferences).toBe(3);
  expect(report.counts.normalizations).toBe(2);
  expect(report.differences.normalizations).toMatchObject([
    { side: 'cursor', rule: 'process-id', raw: '123', seq: 2, byteOffset: 4 },
    { side: 'pi', rule: 'process-id', raw: '456', seq: 2, byteOffset: 4 },
  ]);
  expect(report.counts.unexplainedDifferences).toBe(0);
});

test('a missing side refuses comparison', async () => {
  const report = await comparePair(await writePair({ omit: 'pi' }));

  expect(report.verdict).toBe('refused');
  expect(report.pass).toBe(false);
  expect(report.refusals).toContainEqual({ code: 'missing-side', side: 'pi' });
});

test('differing fixture digests refuse comparison', async () => {
  const path = await writePair();
  const pair = JSON.parse(await readFile(path, 'utf8'));
  const piIdentityPath = join(pair.pi.dir, 'identity.json');
  const identity = JSON.parse(await readFile(piIdentityPath, 'utf8'));
  await writeFile(piIdentityPath, `${JSON.stringify({ ...identity, fixtureRef: { ...identity.fixtureRef, digest: 'sha256:different' } })}\n`);

  const report = await comparePair(path);

  expect(report.verdict).toBe('refused');
  expect(report.refusals.some(({ code }) => code === 'fixture-digest-mismatch')).toBe(true);
});

test('differing recorded input digests refuse comparison', async () => {
  const path = await writePair();
  const pair = JSON.parse(await readFile(path, 'utf8'));
  const piEventsPath = join(pair.pi.dir, 'events.jsonl');
  const events = await readFile(piEventsPath, 'utf8');
  const extraInput = event(6, 'input_dispatched', {
    dataB64: Buffer.from('unexpected').toString('base64'),
    origin: 'literal_user',
  });
  await writeFile(piEventsPath, `${events}${JSON.stringify(extraInput)}\n`);

  const report = await comparePair(path);

  expect(report.verdict).toBe('refused');
  expect(report.refusals.some(({ code }) => code === 'input-digest-mismatch')).toBe(true);
  expect(report.counts.inputDifferences).toBe(1);
});

test('the recorded Cursor and Pi help outputs remain honestly different', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pairPath = join(here, '../evidence/pair-first-slice/pair-2f298bbc-fc66-46f0-8b10-05d274501f10/pair.json');

  const report = await comparePair(pairPath);

  expect(report.verdict).toBe('fail');
  expect(report.pass).toBe(false);
  expect(report.counts.rawOutputDifferences).toBeGreaterThan(100);
  expect(report.counts.unexplainedDifferences).toBeGreaterThan(100);
});
