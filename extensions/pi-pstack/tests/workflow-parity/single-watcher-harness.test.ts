import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitSingleWatcherFamily } from './families/pr-babysit.ts';
import { FORGE_CLI } from './fixtures/forge.ts';
import { runWorkflow, SCRIPTED_ROLES } from './lib/driver.ts';

test.for(['real', 'scripted'] as const)('%s single-watcher CI progresses at its polling cadence', async (driver) => {
  process.env['FAKE_PI_MODE'] = 'crash';
  const states: string[] = [];
  const spec = babysitSingleWatcherFamily.spec;
  await expect(
    runWorkflow(
      {
        ...spec,
        roles: SCRIPTED_ROLES,
        env: (ctx) => {
          const env = { ...process.env, ...spec.env?.(ctx, driver) };
          for (let poll = 0; poll < 3; poll += 1) {
            const result = spawnSync(process.execPath, [FORGE_CLI, 'gh', 'pr', 'checks', '16', '--json', 'state'], { cwd: ctx.repo, env, encoding: 'utf8' });
            expect([0, 8]).toContain(result.status);
            states.push(JSON.parse(result.stdout)[0].state);
          }
          return {};
        },
      },
      driver,
      { pi: join(import.meta.dirname, 'fixtures/fake-pi.mjs'), model: 'sim/claude-sim' },
    ),
  ).rejects.toThrow(/pi exited/);
  expect(states).toEqual(driver === 'real' ? ['PENDING', 'PENDING', 'SUCCESS'] : ['PENDING', 'PENDING', 'PENDING']);
});
