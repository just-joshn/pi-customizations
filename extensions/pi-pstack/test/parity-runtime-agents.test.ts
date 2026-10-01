import { expect, test } from 'vitest';
import { readPersona } from '../src/personas.ts';
import { fixture, prompt } from './session-fixture.ts';

test('the poteto-agent persona scopes resume to one conversation and respawns after an interrupt', async () => {
  const { instructions } = await readPersona('poteto-agent');
  expect(instructions).toContain('Resume rule. Resume an existing poteto-agent with Task resume only inside one conversation while its last run finished without an interrupt. After an interrupt or TaskStop, never resume it or chain a TaskMessage to it. Start a fresh poteto-agent with the consolidated scope, because an interrupt-chained resume silently drops directives.');
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
