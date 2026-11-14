import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotFamilies } from './families/pr-autopilot.ts';
import type { Ctx } from './lib/driver.ts';
import { required } from './lib/required.ts';

test('hold interrupts at both code-ready handoffs, before verification or merge authorization', () => {
  const root = mkdtempSync(join(tmpdir(), 'hold-trigger-'));
  try {
    const events: ({ type: string } & Record<string, unknown>)[] = ['one', 'two'].flatMap((id) => {
      const dir = join(root, id);
      mkdirSync(dir);
      const path = join(dir, 'assignment.json');
      writeFileSync(path, JSON.stringify({ role: 'owner', workerId: id, runId: 'queue' }));
      return [
        { type: 'tool_execution_start', toolCallId: id, toolName: 'pstack_worker', args: { action: 'spawn', assignmentPath: id === 'one' ? join(id, 'assignment.json') : path } },
        { type: 'tool_execution_end', toolCallId: id, toolName: 'pstack_worker', isError: false },
      ];
    });
    const interrupt = required(required(autopilotFamilies.find((family) => family.id === 'autopilot-hold')).spec.interrupt);
    const ctx = { repo: root } as Ctx;
    expect(interrupt(ctx, required(events.at(-1)), events)).toBeUndefined();
    for (const id of ['one', 'two']) {
      events.push({ type: 'tool_execution_start', toolCallId: `collect-${id}`, toolName: 'pstack_worker', args: { action: 'collect', workerId: id, runId: 'queue' } });
      const end = { type: 'tool_execution_end', toolCallId: `collect-${id}`, toolName: 'pstack_worker', isError: false };
      expect(interrupt(ctx, { ...end, isError: true }, [...events, { ...end, isError: true }])).toBeUndefined();
      events.push(end);
      expect(interrupt(ctx, end, events)).toBe(id === 'two' ? '/poteto-mode hold everything: stop all writes now, do not merge anything' : undefined);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
