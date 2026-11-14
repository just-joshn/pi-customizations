import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { autopilotFamilies } from './families/pr-autopilot.ts';
import type { Ctx } from './lib/driver.ts';
import { required } from './lib/required.ts';

test('hold starts with both owners in flight, not before the second owner exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'hold-trigger-'));
  try {
    const events = ['one', 'two'].map((id) => {
      const dir = join(root, id);
      mkdirSync(dir);
      const path = join(dir, 'assignment.json');
      writeFileSync(path, JSON.stringify({ role: 'owner' }));
      return { type: 'tool_execution_start', toolName: 'pstack_worker', args: { action: 'spawn', assignmentPath: path } };
    });
    const interrupt = required(required(autopilotFamilies.find((family) => family.id === 'autopilot-hold')).spec.interrupt);
    expect(interrupt({} as Ctx, required(events[0]), events.slice(0, 1))).toBeUndefined();
    expect(interrupt({} as Ctx, required(events[1]), events)).toContain('hold everything');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
