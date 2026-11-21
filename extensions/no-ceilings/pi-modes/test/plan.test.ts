import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, type TestHarness } from './harness.ts';

const ZERO = 0;
const ONE = 1;
const TWO = 2;

let harnesses: readonly TestHarness[] = [];
let tempDirs: readonly string[] = [];

function track(harness: TestHarness): TestHarness {
  harnesses = [...harnesses, harness];
  return harness;
}

function makeTempPlansDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-modes-plans-'));
  tempDirs = [...tempDirs, dir];
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const current = harnesses;
  harnesses = [];
  for (const h of current) {
    await h.cleanup();
  }
  const dirs = tempDirs;
  tempDirs = [];
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Plan mode plan creation and execution', () => {
  it('writes .plan.md with YAML todos frontmatter and tracks execution to completion', async () => {
    const plansDir = makeTempPlansDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);

    const h = track(createTestHarness({ selectResponses: ['1. Yes, build locally'] }));
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const created = await h.callTool('create_plan', {
      name: 'Auth Refactor',
      overview: 'Modernize token refresh',
      todos: [
        { id: 't1', content: 'Add refresh endpoint' },
        { id: 't2', content: 'Wire client retry', dependencies: ['t1'] },
      ],
      plan: '# Auth Refactor\n\n1. Add refresh endpoint\n2. Wire client retry\n',
    });

    const rawFilePath = created.details?.['filePath'];
    const filePath = typeof rawFilePath === 'string' ? rawFilePath : '';
    expect(filePath.startsWith(plansDir)).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, 'utf-8');
    expect(raw).toContain('<!-- sess1234-5678-90ab-cdef -->');
    expect(raw).toContain('id: "t1"');

    await h.emit('agent_end', { messages: [] });
    expect(h.getStatuses()['pi-modes']).toContain('Plan 0/2');
    expect(h.getActiveTools()).toContain('edit');
    expect(h.getWidgets()['pi-modes-plan']).toHaveLength(TWO);

    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Done [DONE:1]' }] } });
    expect(h.getStatuses()['pi-modes']).toContain('Plan 1/2');

    await h.emit('agent_end', { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Step 2 complete' }] }] });
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getSentMessages()).toHaveLength(TWO);
  });

  it('supports proposing changes to a plan via editor', async () => {
    const plansDir = makeTempPlansDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);

    const h = track(createTestHarness({ selectResponses: ['2. No, propose changes'], editorResponses: ['Please add rollback steps'] }));
    await h.emit('session_start', {});
    await h.runCommand('plan');
    await h.callTool('create_plan', { name: 'Migration', plan: '# Migration\n\n1. Run script\n' });
    await h.emit('agent_end', { messages: [] });

    expect(h.getSentUserMessages().at(-ONE)?.content).toBe('Please add rollback steps');
    expect(h.getStatuses()['pi-modes']).toContain('Plan');
  });
});

const RESUME_PLAN_STEPS = [
  { step: ONE, id: 's1', text: 'First step', completed: false },
  { step: TWO, id: 's2', text: 'Second step', completed: false },
];

const RESUME_ENTRIES = [
  { type: 'custom', customType: 'pi-modes-state', data: { mode: 'agent', planExecuting: true, planSteps: RESUME_PLAN_STEPS } },
  { type: 'custom', customType: 'pi-modes-plan-execute', data: {} },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Finished first [DONE:1]' }] } },
];

const RESUME_ALL_DONE_ENTRIES = [
  { type: 'custom', customType: 'pi-modes-state', data: { mode: 'agent', planExecuting: true, planSteps: RESUME_PLAN_STEPS } },
  { type: 'custom', customType: 'pi-modes-plan-execute', data: {} },
  { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Done [DONE:1] and [DONE:2]' }] } },
];

describe('Plan mode session resume', () => {
  it('reconciles completed plan steps from assistant messages on session resume', async () => {
    const h = track(createTestHarness({ initialEntries: RESUME_ENTRIES }));
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Plan 1/2');
  });

  it('clears plan execution state on resume when all steps are already completed', async () => {
    const h = track(createTestHarness({ initialEntries: RESUME_ALL_DONE_ENTRIES }));
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getWidgets()['pi-modes-plan']).toBeUndefined();
  });
});

const SINGLE_QUESTION_ARGS = {
  title: 'Storage',
  questions: [
    {
      id: 'q1',
      prompt: 'Which database?',
      options: [
        { id: 'sqlite', label: 'SQLite' },
        { id: 'other', label: 'Other' },
      ],
    },
  ],
};

const MULTI_QUESTION_ARGS = {
  title: 'Caches',
  questions: [
    {
      id: 'q2',
      prompt: 'Select backends',
      allow_multiple: true,
      options: [
        { id: 'redis', label: 'Redis' },
        { id: 'sqlite', label: 'SQLite' },
      ],
    },
  ],
};

describe('Plan mode ask_question tool', () => {
  it('supports single-select with automatic Other freeform option and multi-select', async () => {
    const h = track(
      createTestHarness({
        selectResponses: ['Other', '[ ] Redis', '[ ] SQLite', 'Done selecting'],
        inputResponses: ['Postgres'],
      }),
    );
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const single = await h.callTool('ask_question', SINGLE_QUESTION_ARGS);
    expect(single.details?.['status']).toBe('success');
    expect(single.content[ZERO]?.text).toContain('Postgres');

    const multi = await h.callTool('ask_question', MULTI_QUESTION_ARGS);
    expect(multi.details?.['status']).toBe('success');
    expect(multi.content[ZERO]?.text).toContain('redis');
    expect(multi.content[ZERO]?.text).toContain('sqlite');
  });
});
