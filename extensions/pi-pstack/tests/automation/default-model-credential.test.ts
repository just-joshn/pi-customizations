// An automation run has no parent session, so `inherit-parent` launches Pi's configured default model. Its env
// 'minimal' must still carry that provider's credential.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { spawnInTmux } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/run-files.ts';
import { FAKE_PI, killTmuxServer, makeProject, makeRun, type Project, readState, stopProject, TMUX, transcript, until, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';

const KEY = 'ANTHROPIC_API_KEY';
let project: Project;
let saved: string | undefined;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'auto1', null);
  saved = process.env[KEY];
});

afterEach(async () => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  await stopProject(project);
});

afterAll(killTmuxServer);

test("an automation worker on Pi's default model gets that provider's credential from the parent under env minimal", async () => {
  writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-5' }));
  process.env[KEY] = 'parent-only-credential';
  const assignmentPath = writeAssignment(project, 'auto1', 'general', `@@env ${KEY}`, { model: 'inherit-parent' });

  await spawnInTmux(project.dir, { tmuxSocket: TMUX, piCommand: [process.execPath, FAKE_PI], extraEnv: workerTestEnv(project), agentsDir: project.agentsDir })('auto1' as RunId, assignmentPath);

  await until(
    () => readState(project, 'auto1', 'general').settles.length,
    (count) => count > 0,
    15_000,
    'the automation worker settles',
  );
  expect(readState(project, 'auto1', 'general')).toMatchObject({ phase: 'idle' });
  expect(transcript(project, 'auto1', 'general')).toEqual(['assistant:parent-only-credential']);
});
