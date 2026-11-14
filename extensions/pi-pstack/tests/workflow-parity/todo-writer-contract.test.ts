import { expect, test } from 'vitest';
import { todoChecks } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

const check = todoChecks({ playbook: 'autopilot-full' }).find((entry) => entry.id.endsWith('.parent-sole-writer'));
const result = (command: string) => check?.run({ runs: [{ id: 'run', runJson: { playbook: 'autopilot-full' }, workers: [{ id: 'owner', session: { toolCalls: [{ name: 'bash', args: { command } }] } }] }] } as unknown as RunView);

test('reading TODO with stderr redirected to stdout is not writing it', () => {
  expect(result('ls /repo/.pi/pstack/runs/run/ 2>&1; cat /repo/.pi/pstack/runs/run/TODO.md 2>&1 | head -60')).toMatchObject({ ok: true });
});

test('writing TODO through redirection or a modifying command still fails', () => {
  for (const command of ['echo bad > /repo/.pi/pstack/runs/run/TODO.md', 'echo bad >> /repo/.pi/pstack/runs/run/TODO.md', 'tee /repo/.pi/pstack/runs/run/TODO.md', 'sed -i s/a/b/ /repo/.pi/pstack/runs/run/TODO.md']) expect(result(command), command).toMatchObject({ ok: false });
});
