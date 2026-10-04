import { expect, test } from 'vitest';
import { readPersona } from '../src/personas.ts';
import { fixture, prompt } from './session-fixture.ts';

test('the poteto-agent persona defaults to fresh workers and permits reuse only for costly state', async () => {
  const { instructions } = await readPersona('poteto-agent');
  expect(instructions).toContain('**Fresh subagents by default.**');
  expect(instructions).toContain('Resume, message, or queue a follow-up on an existing subagent only when the new work strictly needs state that lives in that agent and is costly to move:');
  expect(instructions).toContain('Interrupt-chained resumes silently drop directives, so fire a fresh subagent with consolidated scope');
  expect(instructions).not.toContain('Resume rule.');
  expect(instructions).not.toContain('Resume an existing `poteto-agent` for the conversation rather than spawning a sibling.');
  expect(instructions).toContain('Routing target for `/poteto-mode`');
});

test('an empty /goal prints usage and arms no goal', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session, manager } = await f.open();
    const notices: { message: string; level?: string }[] = [];
    await session.bindExtensions({ uiContext: { notify: (message: string, level?: string) => notices.push({ message, level }), setStatus() {}, setWidget() {} } as never });
    await prompt(session, '/goal   ', { startsRun: false });
    expect(notices).toEqual([{ message: 'Usage: /goal <objective>. Use /goal clear to drop the active goal. A leading time limit is unsupported. Use /loop for recurring work.\nNo goal.', level: 'info' }]);
    expect(manager.getBranch().filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-goal')).toEqual([]);
    expect(f.requests).toEqual([]);
  } finally {
    await f.close();
  }
});
