import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, 'skills', path), 'utf8');
const playbook = (name: string) => read(`poteto-mode/playbooks/${name}.md`);

const fallback = 'When no remote executor is configured, run the unit locally, say so, and record the fallback in the decision log and the reply. The Task tool never falls back silently.';

test('swarm fans out all workers in one message with the upstream subagent type, background flag, and cloud default', async () => {
  const swarm = await read('swarm/SKILL.md');
  expect(swarm).toContain('Spawn all N workers in one message with `subagent_type: generalPurpose`, `run_in_background: true`, and the step 4 model');
  expect(swarm).toContain('Default each worker to `environment: "cloud"` when the host contract shows a configured remote executor');
  expect(swarm).toContain(fallback);
  expect(swarm).toContain('Use `environment: "local"` only when the worker needs access to something on this machine');
});

test('swarm rejects an off-slice or unevidenced exploration result, reruns once, then records a gap', async () => {
  expect(await read('swarm/SKILL.md')).toContain('Also drop a result that does not cover its named slice with evidence, and rerun that worker once. After a second miss, record a gap.');
});

test('shipping runs one unbatched verifier per PR against parent versus head with an exact verdict set', async () => {
  const shipping = await playbook('shipping');
  expect(shipping).toContain('One independent worker per PR, not batched');
  expect(shipping).toContain('against parent versus head');
  expect(shipping).toContain('Each returns `PASS`, `PASS+NOTES` or `FAIL` and posts that verdict on its own PR.');
});

test('shipping defaults each verifier to a cloud worker and keeps local only for lanes that need this machine', async () => {
  const shipping = await playbook('shipping');
  expect(shipping).toContain('Default each verifier to `environment: "cloud"` when the host contract shows a configured remote executor.');
  expect(shipping).toContain('Run a local app lane on the machine that can reach the app when the lane needs this machine\'s app, simulator, credentials, transcripts, or IDE state.');
  expect(shipping).toContain(fallback);
});

test('shipping treats every non-terminal queued watcher event as a wake and waits for merge evidence', async () => {
  const shipping = await playbook('shipping');
  expect(shipping).toContain('ignoring the watcher\'s non-terminal `QUEUE`, `STATUS`, `WAITING`, and `ADVANCE` wakes (queued mode never emits `READY`) until `mergedAt` is non-null or `state` is `MERGED`');
  expect(shipping).not.toContain('ignoring `READY` until');
});

test('both autopilots run each owner as a cloud worker unless it needs local state, and record the local fallback', async () => {
  for (const name of ['autopilot-full', 'autopilot-stack']) {
    const text = await playbook(name);
    expect(text).toContain('Run each owner as Task `environment: "cloud"` when the host contract shows a configured remote executor, unless it needs local app, simulator, credentials, transcripts, or IDE state.');
    expect(text).toContain('Keep an owner local when the app, simulator, credentials, transcripts, or IDE state are local.');
    expect(text).toContain(fallback);
  }
});

test('autopilot-stack counts an erroring lane as stuck, like autopilot-full', async () => {
  expect(await playbook('autopilot-stack')).toContain('Treat a lane that errors, or that passes its expected runtime without a side effect, as stuck.');
});

test('plan live lanes default to one cloud VM each and fall back locally with a record', async () => {
  const plan = await playbook('multi-phase-plan');
  expect(plan).toContain('Each live lane runs on its own cloud VM at the PR head when the host contract shows a configured remote executor, as Task `environment: "cloud"` with one VM per lane.');
  expect(plan).toContain('Use a local worker only for a local-only app, simulator, credential, transcript, or IDE.');
  expect(plan).toContain(fallback);
});

test('orchestrate workers fall back locally with a record when no remote executor is configured', async () => {
  expect(await playbook('orchestrate')).toContain(fallback);
});
