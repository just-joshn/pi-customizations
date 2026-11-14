import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import { liveObservation, readObservations } from './families/pr-watcher-observation.ts';
import { Parent, scenario } from './fixtures/dsl.ts';
import { readForge, WATCH_PR } from './fixtures/forge.ts';
import { evaluate } from './lib/check.ts';
import { runWorkflow } from './lib/driver.ts';

// Pinned babysit.md steps 3 and 6 allow a mid-loop request and forbid a second polling loop.
test('repeat delivery observes the original watcher before CI can settle', async () => {
  const spec = babysitSingleWatcherFamily.spec;
  const run = await runWorkflow(
    {
      ...spec,
      scenario: (ctx) => {
        const script = spec.scenario(ctx);
        script.actors['parent']?.unshift(...Array.from({ length: 6 }, () => ({ tool: 'bash', args: { command: 'gh pr checks 16 --repo acme/widgets --json state || test $? -eq 8' } })));
        return script;
      },
    },
    'scripted',
  );
  try {
    expect(run.meta.inconclusive).toBeUndefined();
    expect(run.meta.timedOut).toBe(false);
    const observations = readObservations(run.sandbox);
    expect(observations?.deliveries).toHaveLength(1);
    expect(observations?.deliveries[0]?.workers.filter(liveObservation)).toHaveLength(1);
    expect(readForge(run.view).state.prs['16']?.checks[0]?.state).toBe('SUCCESS');
    const checks = babysitSingleWatcherFamily.checks.filter((check) => check.id.startsWith('babysit.single.') && check.id.includes('watcher'));
    expect(evaluate(checks, run.view).map((result) => ({ id: result.id, verdict: result.verdict, evidence: result.evidence }))).toEqual(checks.map((check) => ({ id: check.id, verdict: 'PASS', evidence: expect.any(String) })));
    expect(JSON.parse(readFileSync(join(run.sandbox, 'worker-states-before-stop.json'), 'utf8'))).toEqual(expect.arrayContaining([expect.objectContaining({ state: expect.objectContaining({ phase: 'exited' }) })]));
  } finally {
    run.cleanup();
  }
}, 120_000);

test('two real watcher children active together fail without assuming a repeat premise', async () => {
  const spec = babysitSingleWatcherFamily.spec;
  const run = await runWorkflow(
    {
      ...spec,
      interrupt: () => undefined,
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        parent.beginPlaybook('babysit', 'Overlapping watchers');
        for (const id of ['watch-a', 'watch-b'])
          parent.spawn(
            id,
            { kind: 'watch', role: 'watcher', model: 'inherit-parent', workspace: parent.readonly(), watch: { argv: [WATCH_PR, '--owner', 'acme', '--repo', 'widgets', '--pr', '16', '--interval', '0.3'], cwd: ctx.repo } },
            '',
          );
        parent.text('Both watchers were started.');
        return scenario(parent);
      },
    },
    'scripted',
  );
  try {
    expect(run.meta.timedOut).toBe(false);
    expect(readObservations(run.sandbox)?.spawns.some((workers) => workers.filter(liveObservation).length === 2)).toBe(true);
    const checks = babysitSingleWatcherFamily.checks.filter((check) => check.id.startsWith('babysit.single.') && check.id.includes('watcher'));
    expect(evaluate(checks, run.view).map((result) => result.verdict)).toEqual(['FAIL', 'FAIL']);
  } finally {
    run.cleanup();
  }
}, 120_000);
