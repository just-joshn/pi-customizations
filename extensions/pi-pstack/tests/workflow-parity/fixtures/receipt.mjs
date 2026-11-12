// Writes a pstack_evidence receipt for a command that already ran: its exit code and the sha256 of each artifact.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string' }, 'run-id': { type: 'string' }, id: { type: 'string' }, target: { type: 'string' }, kind: { type: 'string', default: 'command' },
    commit: { type: 'string' }, env: { type: 'string', default: 'local' }, artifact: { type: 'string', multiple: true }, exit: { type: 'string', default: '0' },
    cmd: { type: 'string' }, verdict: { type: 'string' }, reason: { type: 'string' },
  },
});
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const exitCode = Number(values.exit);
const receipt = {
  schemaVersion: 1, id: values.id, runId: values['run-id'], target: values.target, kind: values.kind,
  verdict: values.verdict ?? (exitCode === 0 ? 'pass' : 'fail'), commit: values.commit ?? null, environment: values.env,
  command: values.cmd ? ['sh', '-c', values.cmd] : undefined, exitCode,
  artifacts: (values.artifact ?? []).map((path) => ({ path, sha256: sha(path) })), createdAt: new Date().toISOString(),
  ...(values.reason ? { reason: values.reason } : {}),
};
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(receipt, null, 2)}\n`);
