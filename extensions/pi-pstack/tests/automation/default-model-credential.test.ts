// An automation run has no parent session, so `inherit-parent` launches Pi's configured default model. Its env
// 'minimal' must still carry that provider's credential.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { spawnInTmux } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/run-files.ts';
import { FAKE_PI, killTmuxServer, makeProject, makeRun, type Project, readState, stopProject, TMUX, transcript, until, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';

const KEY = 'ANTHROPIC_API_KEY';
const SENTINEL = 'U04A7_NOT_A_CREDENTIAL';
let project: Project;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  project = makeProject();
  makeRun(project, 'auto1', null);
  saved = { [KEY]: process.env[KEY], [SENTINEL]: process.env[SENTINEL] };
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await stopProject(project);
});

const spawnAutomation = (brief: string) =>
  spawnInTmux(project.dir, { tmuxSocket: TMUX, piCommand: [process.execPath, FAKE_PI], extraEnv: workerTestEnv(project), agentsDir: project.agentsDir })(
    'auto1' as RunId,
    writeAssignment(project, 'auto1', 'general', brief, { model: 'inherit-parent' }),
  );

afterAll(killTmuxServer);

test("an automation worker on Pi's default model gets that provider's credential from the parent under env minimal", async () => {
  writeFileSync(join(project.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-5' }));
  process.env[KEY] = 'parent-only-credential';
  await spawnAutomation(`@@env ${KEY}`);

  await until(
    () => readState(project, 'auto1', 'general').settles.length,
    (count) => count > 0,
    15_000,
    'the automation worker settles',
  );
  expect(readState(project, 'auto1', 'general')).toMatchObject({ phase: 'idle' });
  expect(transcript(project, 'auto1', 'general')).toEqual(['assistant:parent-only-credential']);
});

test('an automation worker whose default provider Pi picks itself gets every provider credential the parent has and no other variable under env minimal', async () => {
  process.env[KEY] = 'parent-only-credential';
  process.env[SENTINEL] = 'parent-only-value';
  await spawnAutomation(`@@env-json ${KEY} ${SENTINEL}`);

  await until(
    () => readState(project, 'auto1', 'general').settles.length,
    (count) => count > 0,
    15_000,
    'the automation worker settles',
  );
  expect(transcript(project, 'auto1', 'general')).toEqual([`assistant:${JSON.stringify({ [KEY]: 'parent-only-credential', [SENTINEL]: null })}`]);
});
