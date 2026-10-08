import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { differentialInvocation } from './resource-workflows-implementation-outcome.mjs';

function owned(path, root) {
  const rel = relative(realpathSync(root), realpathSync(path));
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

export function readOwnedJson(path, root) {
  try {
    return owned(path, root) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

export function evidenceMapLinks(map, root) {
  if (!Array.isArray(map)) return [];
  return map.map((item) => {
    try {
      const implementation = join(root, item.implementation);
      const [testPath, testId] = item.test.split('#');
      const testRecords = sideRecords(join(root, testPath), root);
      const probe = readOwnedJson(join(root, item.probe), root);
      return {
        case: item.case,
        implementationPresent: owned(implementation, root) && readFileSync(implementation).length > 0,
        testId: testId === item.case && testRecords.some((record) => record.id === item.case) ? testId : null,
        probeId: probe?.id ?? null,
        referenceSha256: probe?.referenceSha256 ?? null,
      };
    } catch {
      return { case: item?.case, implementationPresent: false, testId: null, probeId: null };
    }
  });
}

function sideRecords(path, root) {
  if (!owned(path, root)) throw new Error('Differential records escaped the owned workspace.');
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

export function collectDifferential({ records, cwd, driver, target, artifact, cases, reference }) {
  const calls = records.filter((record) => record.type === 'tool_execution_start' && record.toolName === 'bash');
  for (const call of calls) {
    const invocation = differentialInvocation(call.args?.command);
    if (!invocation || invocation.driver !== driver || invocation.reference !== target || ![artifact, `python3 ${artifact}`].includes(invocation.candidate) || invocation.cases !== cases) continue;
    const end = records.find((record) => record.type === 'tool_execution_end' && record.toolCallId === call.toolCallId && record.toolName === 'bash' && record.isError === false);
    if (!end) continue;
    try {
      const output = (end.result?.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      const printed = output.split('\n').flatMap((line) => {
        const match = line.match(/^(reference|candidate)\s+(\{.*\})$/);
        return match ? [{ side: match[1], ...JSON.parse(match[2]) }] : [];
      });
      if (
        printed.length !== 12 ||
        !['reference', 'candidate'].every((side) =>
          reference.observations.every((expected) => printed.filter((item) => item.side === side && item.id === expected.id && item.exit_code === expected.code && item.signal === null && item.timed_out === false).length === 1),
        )
      )
        continue;
      const sides = ['reference', 'candidate'].map((side) => sideRecords(join(invocation.out, side, 'probes.jsonl'), cwd));
      const matched = sides.every(
        (items, sideIndex) =>
          items.length === 6 &&
          reference.observations.every((expected) => {
            const matches = items.filter((item) => item.id === expected.id);
            if (matches.length !== 1) return false;
            const item = matches[0];
            const prefix = sideIndex === 0 ? [target] : invocation.candidate === artifact ? [artifact] : ['python3', artifact];
            if (
              JSON.stringify(item.argv) !== JSON.stringify([...prefix, ...expected.args]) ||
              item.exit_code !== expected.code ||
              item.signal !== null ||
              item.timed_out !== false ||
              item.launch_error != null ||
              item.capture_complete !== true
            )
              return false;
            return ['stdout', 'stderr'].every((stream) => owned(item[stream].path, cwd) && readFileSync(item[stream].path).toString('base64') === expected[stream]);
          }),
      );
      return { code: 0, signal: null, error: null, reference: target, candidate: artifact, cases, ids: sides[0].map((item) => item.id), matched, toolCallId: call.toolCallId, output: invocation.out };
    } catch {
      // Missing or unowned evidence is not a successful execution proof.
    }
  }
  return null;
}
