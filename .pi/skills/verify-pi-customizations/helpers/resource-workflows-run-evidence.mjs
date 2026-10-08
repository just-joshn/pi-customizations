import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtimeEvidence } from './resource-workflows-run-runtime.mjs';

export { canonicalRunCommands, openRunRuntime } from './resource-workflows-run-runtime.mjs';

const hash = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const sameArguments = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function modelCalls(records) {
  return records.flatMap((record, messageIndex) => {
    if (record.type !== 'message_end' || record.message?.role !== 'assistant') return [];
    return (record.message.content ?? [])
      .filter((part) => part.type === 'toolCall')
      .flatMap((call) => {
        const startIndex = records.findIndex((item, index) => index > messageIndex && item.type === 'tool_execution_start' && item.toolCallId === call.id && item.toolName === call.name && sameArguments(item.args, call.arguments));
        if (startIndex < 0) return [];
        const endIndex = records.findIndex((item, index) => index > startIndex && item.type === 'tool_execution_end' && item.toolCallId === call.id && item.toolName === call.name);
        if (endIndex < 0) return [];
        const end = records[endIndex];
        return [{ id: call.id, toolName: call.name, arguments: call.arguments, modelOrigin: true, success: end.isError === false, messageIndex, startIndex, endIndex, result: end.result }];
      });
  });
}

export function runIdentity({ kind, cwd, port, socket }) {
  const applicationId = randomUUID();
  const entry = kind === 'cli' ? 'greet' : kind === 'library' ? 'greet.mjs' : kind === 'tui' ? 'terminal.py' : kind === 'electron' ? 'main.cjs' : 'server.mjs';
  return {
    attemptId: randomUUID(),
    applicationId,
    kind,
    cwd: realpathSync(cwd),
    executable: join(realpathSync(cwd), entry),
    sha256: hash(join(cwd, entry)),
    packageRoot: realpathSync(cwd),
    packageSha256: hash(join(cwd, 'package.json')),
    port,
    socket,
  };
}

function directObservations(identity, calls, unchanged) {
  if (!unchanged) return [];
  const commands = {
    cli: './greet hello Ada',
    library: `node --input-type=module -e 'import { greet } from "greeting-kit"; process.stdout.write(greet("Ada") + "\\n");'`,
  };
  return calls
    .filter((call) => call.toolName === 'bash' && call.success && call.arguments.command?.trim() === commands[identity.kind])
    .flatMap((call) => {
      const content = call.result?.content ?? [];
      if (content.length !== 1 || content[0].type !== 'text' || content[0].text !== 'Hello Ada\n') return [];
      const common = { provenance: 'protected-runtime', attemptId: identity.attemptId, applicationId: identity.applicationId, callId: call.id };
      if (identity.kind === 'cli') return [{ ...common, type: 'exec', executable: identity.executable, sha256: identity.sha256, argv: ['hello', 'Ada'], exitCode: 0, signal: null, stdout: content[0].text }];
      return [
        {
          ...common,
          type: 'package-call',
          specifier: 'greeting-kit',
          packageRoot: identity.packageRoot,
          resolvedThroughExport: true,
          exportSha256: identity.sha256,
          exportName: 'greet',
          arguments: ['Ada'],
          result: 'Hello Ada',
          exitCode: 0,
        },
      ];
    });
}

export function collectRunEvidence({ identity, records, error, cleanup, rescue, out, mode = 'genuine', runtime }) {
  const calls = modelCalls(records);
  const unchanged = hash(identity.executable) === identity.sha256 && hash(join(identity.packageRoot, 'package.json')) === identity.packageSha256;
  const observed = ['server', 'tui'].includes(identity.kind) && unchanged && runtime !== undefined ? runtimeEvidence(runtime, identity, records) : { observations: [], gaps: [] };
  const input = {
    kind: identity.kind,
    mode,
    identity,
    invocation: { error },
    calls,
    observations: [...directObservations(identity, calls, unchanged), ...observed.observations],
    cleanup,
    rescue,
    capture: join(out, 'rpc.jsonl'),
    gaps: [
      ...observed.gaps,
      'Only canonical calls are collected. Runtime sampling cannot prove complete resource capture. Workspace marker files are not runtime observations.',
      ...(['electron', 'playwright'].includes(identity.kind) ? ['Actual ready window, model click, same-window visible result, real PNG, and successful SDK image-read correlation await the GUI prototype.'] : []),
    ],
    sourceUnchanged: unchanged,
  };
  writeFileSync(join(out, 'protected-run-evidence.json'), `${JSON.stringify(input, null, 2)}\n`);
  return input;
}
