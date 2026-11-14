import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { sourceState, toolchain } from '../../scripts/parity-lib.mjs';
import { routeCases, routePath } from './cases.ts';
import { routeEvidence } from './evidence.ts';

const { values } = parseArgs({ options: { out: { type: 'string' }, model: { type: 'string' }, pi: { type: 'string' }, case: { type: 'string', multiple: true }, all: { type: 'boolean' } } });
if (!values.out || !values.model?.startsWith('openai/') || Boolean(values.all) === Boolean(values.case?.length))
  throw new Error('Specify --out <new-directory>, --model openai/<model>:<thinking>, and either --all or --case <id> (repeatable).');
const selected = values.all
  ? routeCases
  : (values.case?.map((id) => {
      const item = routeCases.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown routing case ${id}`);
      return item;
    }) ?? []);
if (new Set(selected.map((item) => item.id)).size !== selected.length) throw new Error('Duplicate routing case');
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(values.out);
mkdirSync(out);
const before = sourceState(root);
if (!before.commit || !before.sourceDigest) throw new Error('Cannot attribute this source tree; no model invocation attempted.');
const pi = values.pi ?? process.env['PSTACK_E2E_PI'] ?? 'pi';
const identity = toolchain({ ...process.env, PSTACK_E2E_PI: pi });
if (!identity.piVersion) throw new Error('Cannot determine selected Pi version; no model invocation attempted.');
const rows = [];
for (const item of selected) {
  const cwd = join(out, item.id);
  mkdirSync(cwd);
  const session = join(cwd, 'session.jsonl');
  const stages = [...(item.previous ? [{ ...item.previous, id: `${item.id}-previous` }] : []), item];
  for (const [index, stage] of stages.entries()) {
    const prompt = `/skill:poteto-mode Routing-only acceptance probe. Classify the TASK below under the active pstack routing contract. Do not execute the task, create a TODO, start workers, change files, or take external actions. Read the full selected playbook or figure-it-out skill. Return a final JSON object with route (the playbook basename or figure-it-out), path (the selected file), reason, and prRequired (whether the requested task eventually calls for a new PR). This probe stops after routing and does not prove execution of the task.\n\nTASK\n${stage.prompt}`;
    const args = [
      '--no-approve',
      '--offline',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--extension',
      join(root, 'src/extension.ts'),
      '--skill',
      join(root, 'generated/skills'),
      '--tools',
      'read',
      '--model',
      values.model,
      '--session',
      session,
      '--session-dir',
      cwd,
      '--mode',
      'json',
      '--print',
      prompt,
    ];
    const stdout = join(cwd, `${index}.events.jsonl`);
    const stderr = join(cwd, `${index}.stderr.log`);
    const outputFd = openSync(stdout, 'wx', 0o600);
    const errorFd = openSync(stderr, 'wx', 0o600);
    console.log(`${stage.id}: starting ${values.model}`);
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync(pi, args, { cwd, stdio: ['ignore', outputFd, errorFd] });
    } finally {
      closeSync(outputFd);
      closeSync(errorFd);
    }
    const expectedPath = routePath(root, stage.expected);
    let evidence: ReturnType<typeof routeEvidence> | { status: 'INCONCLUSIVE'; harnessError: string; axes: ReturnType<typeof routeEvidence>['axes'] };
    try {
      evidence = routeEvidence(readFileSync(stdout, 'utf8'), { route: stage.expected, path: expectedPath, source: readFileSync(expectedPath, 'utf8'), cwd, ...('noPr' in stage && stage.noPr ? { noPr: true } : {}) }, result.status);
    } catch (error) {
      evidence = { status: 'INCONCLUSIVE', harnessError: String(error), axes: { outcome: 'INCONCLUSIVE', workflow: 'INCONCLUSIVE', piImplementation: 'INCONCLUSIVE' } };
    }
    const row = { id: stage.id, prompt: stage.prompt, expected: stage.expected, expectedPath, args, stdout, stderr, exitCode: result.status, signal: result.signal, spawnError: result.error?.message, ...evidence };
    rows.push(row);
    writeFileSync(join(cwd, `${index}.result.json`), `${JSON.stringify(row, null, 2)}\n`);
    console.log(`${stage.id}: ${evidence.status}`);
  }
}
const after = sourceState(root);
const sameSource = before.commit === after.commit && before.sourceDigest === after.sourceDigest && before.dirty === after.dirty;
writeFileSync(
  join(out, 'summary.json'),
  `${JSON.stringify({ model: values.model, root, pi, ...identity, before, after, sameSource, rows, scope: 'Controlled routing-only probes, not final ZIP receipts. Full task workflow and Pi attribution remain separately reviewable.' }, null, 2)}\n`,
);
process.exitCode = !sameSource || rows.some((row) => row.status !== 'PASS') ? 1 : 0;
