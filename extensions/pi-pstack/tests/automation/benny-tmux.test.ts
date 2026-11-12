// A real tmux worker running real Pi with the scripted model: the serve process's completion path end to end, with a
// fake Slack and a fake gh at the two external edges.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, afterEach, expect, test } from 'vitest';
import { type Automation } from '../../adapters/automation-events.ts';
import { spawnInTmux } from '../../src/automation/dispatch.ts';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { killTmuxServer, makeProject, type Project, PI, stopProject, TEST_PI_ARGS, TMUX, until, workerTestEnv } from '../worker-lifecycle/harness.ts';
import { bennyProject, fakeGh, fakeSlack, REPORT, ROOT_TS, wiringDeps } from './benny-fakes.ts';

let project: Project | undefined;
afterEach(async () => {
  if (project !== undefined) await stopProject(project);
  project = undefined;
});
afterAll(killTmuxServer);

test('a real worker settles, its result completes the case, and the issue and the reply land once', async () => {
  project = makeProject('pstack-benny-');
  const benny = bennyProject({ root: project.dir });
  const slack = fakeSlack();
  const gh = fakeGh();
  const verdict = 'Reproducible export failure.\n[benny:bug]';
  const result = JSON.stringify({ text: verdict, tracker: { operation: 'create', title: 'Export fails on Safari', body: 'Expected a download.' } });
  const current = project;
  const spawn = spawnInTmux(current.dir, { tmuxSocket: TMUX, piCommand: [PI], extraPiArgs: TEST_PI_ARGS, extraEnv: workerTestEnv(current), agentsDir: current.agentsDir, resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }) });
  const automation: Automation = wireBenny(benny.config('triage'), wiringDeps(slack, gh, {
    // The scripted model replies with the directive in the brief, so the worker's final message is the result above.
    spawnWorker: async (runId, assignmentPath) => {
      writeFileSync(join(assignmentPath, '..', 'brief.md'), `@@say ${result}`);
      await spawn(runId, assignmentPath);
    },
  }));

  const run = await automation.handle(REPORT);
  if (run.status !== 'dispatched') throw new Error(`not dispatched: ${JSON.stringify(run)}`);
  await until(
    async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0,
    Boolean,
    45_000,
    'the worker to settle and the case to complete',
  );

  expect(gh.issues.map((issue) => issue.title)).toEqual(['Export fails on Safari']);
  expect(slack.posts).toEqual([{ thread_ts: ROOT_TS, text: verdict }]);
  expect(automation.pendingRuns()).toEqual([]);
  const restarted = wireBenny(loadBennyConfig(current.dir, 'triage'), wiringDeps(slack, gh));
  await restarted.reconcile();
  expect(await completeSettledRuns(restarted)).toBe(0);
  expect(slack.posts).toHaveLength(1);
  expect(gh.issues).toHaveLength(1);
});
