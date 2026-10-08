import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { outcomeOf } from '../recorder/fold.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultAllowlistPath = join(moduleDir, 'normalization-allowlist.json');
const sides = ['cursor', 'pi'];

const digest = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const bytesDigest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const comparableAction = ({ seq: _seq, ...action }) => action;

async function readAttempt(dir) {
  const identity = JSON.parse(await readFile(join(dir, 'identity.json'), 'utf8'));
  const events = (await readFile(join(dir, 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { identity, events };
}

function output(events) {
  const chunks = [];
  let start = 0;
  for (const event of events.filter(({ kind }) => kind === 'output')) {
    const bytes = Buffer.from(event.dataB64, 'base64');
    chunks.push({ seq: event.seq, start, end: start + bytes.length, bytes });
    start += bytes.length;
  }
  return { bytes: Buffer.concat(chunks.map(({ bytes }) => bytes)), chunks };
}

function location(chunks, offset) {
  const chunk = chunks.find(({ start, end }) => offset >= start && offset < end);
  return chunk ? { seq: chunk.seq, eventByteOffset: offset - chunk.start } : { seq: null, eventByteOffset: null };
}

function byteDifferences(cursor, pi, cursorChunks = [], piChunks = []) {
  const differences = [];
  const length = Math.max(cursor.length, pi.length);
  for (let offset = 0; offset < length; offset += 1) {
    const cursorByte = offset < cursor.length ? cursor[offset] : null;
    const piByte = offset < pi.length ? pi[offset] : null;
    if (cursorByte === piByte) continue;
    differences.push({
      offset,
      cursor: { byte: cursorByte, ...location(cursorChunks, offset) },
      pi: { byte: piByte, ...location(piChunks, offset) },
    });
  }
  return differences;
}

function actualActions(events) {
  const actions = events.flatMap((event) => {
    if (event.kind === 'input_dispatched') {
      return [{ kind: 'send', dataB64: event.dataB64, origin: event.origin, seq: event.seq }];
    }
    if (event.kind === 'resize') return [{ kind: 'resize', rows: event.rows, cols: event.cols, seq: event.seq }];
    if (event.kind === 'cancel_requested') return [{ kind: 'cancel', seq: event.seq }];
    return [];
  });
  const firstCancel = actions.findIndex(({ kind }) => kind === 'cancel');
  return actions.filter(({ kind }, index) => kind !== 'cancel' || index === firstCancel);
}

function expectedActions(steps) {
  return steps.flatMap((step) => [
    ...(step.resize ? [{ kind: 'resize', rows: step.resize.rows, cols: step.resize.cols }] : []),
    ...(step.send !== undefined
      ? [
          {
            kind: 'send',
            dataB64: Buffer.from(step.send).toString('base64'),
            origin: step.origin ?? 'literal_user',
          },
        ]
      : []),
    ...(step.cancel ? [{ kind: 'cancel' }] : []),
  ]);
}

function inputDifferences(expected, attempts) {
  return sides.flatMap((side) => {
    const actual = attempts[side] ? actualActions(attempts[side].events) : [];
    const length = Math.max(expected.length, actual.length);
    return Array.from({ length }, (_, index) => {
      const expectedAction = expected[index] ?? null;
      const actualAction = actual[index] ?? null;
      if (JSON.stringify(expectedAction) === JSON.stringify(actualAction && comparableAction(actualAction))) return null;
      return { side, index, expected: expectedAction, actual: actualAction };
    }).filter(Boolean);
  });
}

function tokenValues(rule, attempt, fixturesEquivalent) {
  if (rule.id === 'attempt-id') return [{ raw: String(attempt.identity.attemptId), replacement: rule.replacement }];
  if (rule.id === 'process-id') {
    return attempt.events.filter(({ kind, pid }) => kind === 'process_started' && pid !== undefined).map(({ pid }) => ({ raw: String(pid), replacement: rule.replacement }));
  }
  if (rule.id === 'recorder-utc-timestamp' || rule.id === 'recorder-monotonic-timestamp') {
    const field = rule.id === 'recorder-utc-timestamp' ? 'utc' : 'monoNs';
    return attempt.events
      .filter((event) => event[field] !== undefined)
      .map((event) => ({
        raw: String(event[field]),
        replacement: rule.replacement.replace('{seq}', String(event.seq)),
      }));
  }
  if (rule.id === 'equivalent-fixture-path' && fixturesEquivalent && attempt.identity.fixtureRef?.path) {
    return [{ raw: String(attempt.identity.fixtureRef.path), replacement: rule.replacement }];
  }
  return [];
}

function normalize(side, value, chunks, tokens) {
  const ordered = tokens
    .filter(({ raw }) => raw.length > 0)
    .map((token) => ({ ...token, rawBytes: Buffer.from(token.raw), replacementBytes: Buffer.from(token.replacement) }))
    .sort((a, b) => b.rawBytes.length - a.rawBytes.length);
  const parts = [];
  const applied = [];
  for (let offset = 0; offset < value.length; ) {
    const token = ordered.find(({ rawBytes }) => value.subarray(offset, offset + rawBytes.length).equals(rawBytes));
    if (token) {
      applied.push({
        side,
        rule: token.rule,
        raw: token.raw,
        replacement: token.replacement,
        seq: location(chunks, offset).seq,
        byteOffset: offset,
      });
      parts.push(token.replacementBytes);
      offset += token.rawBytes.length;
    } else {
      parts.push(value.subarray(offset, offset + 1));
      offset += 1;
    }
  }
  return { bytes: Buffer.concat(parts), applied };
}

function fixtureRefDigest(attempt) {
  return attempt?.identity.fixtureRef?.digest ?? null;
}

function refusalsFor(pair, attempts, loadFailures) {
  const refusals = [...loadFailures];
  for (const side of sides) {
    if (!pair[side]) refusals.push({ code: 'missing-side', side });
  }
  if (!Array.isArray(pair.steps)) refusals.push({ code: 'missing-input-steps' });
  if (attempts.cursor && attempts.pi) {
    const fixtureDigests = [pair.fixtureDigest ?? null, fixtureRefDigest(attempts.cursor), fixtureRefDigest(attempts.pi)];
    if (!fixtureDigests.every((value) => value === fixtureDigests[0])) {
      refusals.push({ code: 'fixture-digest-mismatch', values: fixtureDigests });
    }
    const actual = Object.fromEntries(sides.map((side) => [side, digest(actualActions(attempts[side].events).map(comparableAction))]));
    if (actual.cursor !== actual.pi) refusals.push({ code: 'input-digest-mismatch', values: actual });
  }
  return refusals;
}

export async function comparePair(pairPath, { allowlistPath = defaultAllowlistPath } = {}) {
  const pair = JSON.parse(await readFile(pairPath, 'utf8'));
  const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
  const attempts = {};
  const loadFailures = [];
  for (const side of sides) {
    if (!pair[side]) continue;
    const dir = isAbsolute(pair[side].dir) ? pair[side].dir : join(dirname(pairPath), pair[side].dir);
    try {
      attempts[side] = await readAttempt(dir);
    } catch (error) {
      loadFailures.push({ code: 'unreadable-side', side, message: error.message });
    }
  }

  const refusals = refusalsFor(pair, attempts, loadFailures);
  const expected = expectedActions(Array.isArray(pair.steps) ? pair.steps : []);
  const inputs = inputDifferences(expected, attempts);
  const outcomes =
    attempts.cursor && attempts.pi && JSON.stringify(outcomeOf(attempts.cursor.events)) !== JSON.stringify(outcomeOf(attempts.pi.events)) ? [{ cursor: outcomeOf(attempts.cursor.events), pi: outcomeOf(attempts.pi.events) }] : [];

  let rawOutput = [];
  let unexplainedOutput = [];
  const normalizations = [];
  if (attempts.cursor && attempts.pi) {
    const outputs = Object.fromEntries(sides.map((side) => [side, output(attempts[side].events)]));
    rawOutput = byteDifferences(outputs.cursor.bytes, outputs.pi.bytes, outputs.cursor.chunks, outputs.pi.chunks);
    const fixturesEquivalent = fixtureRefDigest(attempts.cursor) === fixtureRefDigest(attempts.pi) && fixtureRefDigest(attempts.cursor) !== null;
    const normalized = {};
    for (const side of sides) {
      const tokens = allowlist.rules.flatMap((rule) => tokenValues(rule, attempts[side], fixturesEquivalent).map((token) => ({ ...token, rule: rule.id })));
      normalized[side] = normalize(side, outputs[side].bytes, outputs[side].chunks, tokens);
      normalizations.push(...normalized[side].applied);
    }
    unexplainedOutput = byteDifferences(normalized.cursor.bytes, normalized.pi.bytes);
  }

  const unexplainedDifferences = inputs.length + outcomes.length + unexplainedOutput.length;
  const counts = {
    rawOutputDifferences: rawOutput.length,
    normalizations: normalizations.length,
    inputDifferences: inputs.length,
    outcomeDifferences: outcomes.length,
    unexplainedDifferences,
  };
  const verdict = refusals.length > 0 ? 'refused' : unexplainedDifferences === 0 ? 'pass' : 'fail';
  const evidence = Object.fromEntries(
    sides.map((side) => {
      if (!attempts[side]) return [side, null];
      const value = output(attempts[side].events).bytes;
      return [
        side,
        {
          attemptId: attempts[side].identity.attemptId,
          traceDigest: digest(attempts[side].events),
          inputDigest: digest(actualActions(attempts[side].events).map(comparableAction)),
          outputDigest: bytesDigest(value),
        },
      ];
    }),
  );
  const report = {
    schema: 1,
    comparator: {
      version: 1,
      normalizationAllowlistDigest: digest(allowlist),
      normalizationRules: allowlist.rules.map(({ id }) => id),
    },
    pairId: pair.pairId ?? null,
    fixtureDigest: pair.fixtureDigest ?? null,
    evidence,
    verdict,
    pass: verdict === 'pass',
    hasUnexplainedDifferences: unexplainedDifferences > 0,
    counts,
    refusals,
    differences: { rawOutput, normalizations, input: inputs, outcome: outcomes, unexplainedOutput },
  };
  const SAMPLE_LIMIT = 100;
  const truncated = {};
  for (const [kind, list] of Object.entries(report.differences)) {
    if (Array.isArray(list) && list.length > SAMPLE_LIMIT) {
      truncated[kind] = { total: list.length, retained: SAMPLE_LIMIT };
      report.differences[kind] = list.slice(0, SAMPLE_LIMIT);
    }
  }
  if (Object.keys(truncated).length > 0) {
    report.boundedSamples = { ...truncated, note: 'Full lists recomputable via parity/comparator/compare.mjs on the pair record; both attempt dirs are retained.' };
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await comparePair(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}
