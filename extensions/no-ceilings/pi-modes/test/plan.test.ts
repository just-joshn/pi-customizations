import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { advancePlanSteps } from '../src/plan-progress.ts';
import { double, type TestHarness, useTestHarness } from './harness.ts';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const SESSION_ID = 'sess1234-5678-90ab-cdef';

const AUTH_PLAN = {
  name: 'Auth Refactor',
  overview: 'Modernize token refresh',
  todos: [
    { id: 't1', content: 'Add refresh endpoint' },
    { id: 't2', content: 'Wire client retry', dependencies: ['t1'] },
  ],
  plan: '# Auth Refactor\n\n1. Add refresh endpoint\n2. Wire client retry\n',
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-modes-plans-'));
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function requireFilePath(details: Record<string, unknown> | undefined): string {
  const rawFilePath = details?.['filePath'];
  expect(typeof rawFilePath).toBe('string');
  if (typeof rawFilePath !== 'string') {
    throw new Error('filePath was not a string');
  }
  return rawFilePath;
}

async function startExecutingAuthPlan(): Promise<TestHarness> {
  const plansDir = makeTempDir();
  vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);
  const h = useTestHarness({ selectResponses: ['1. Yes, build locally'] });
  await h.emit('session_start', {});
  await h.runCommand('plan');
  await h.callTool('create_plan', AUTH_PLAN);
  await h.emit('agent_end', { messages: [] });
  return h;
}

describe('Plan mode plan creation and execution', () => {
  it('writes phases into the plan file when create_plan receives phases without is_project', async () => {
    const plansDir = makeTempDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);
    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const created = await h.callTool('create_plan', {
      name: 'Phased',
      plan: '# Phased\n',
      phases: [
        { name: 'Phase One', todos: [{ id: 'a1', content: 'Do the first thing' }] },
        { name: 'Phase Two', todos: [{ id: 'b1', content: 'Do the second thing' }] },
      ],
    });

    expect(created.details?.['stepCount']).toBe(TWO);
    const filePath = requireFilePath(created.details);
    expect(dirname(filePath)).toBe(plansDir);
    const raw = readFileSync(filePath, 'utf-8');
    expect(raw).toContain('Phase One');
    expect(raw).toContain('Phase Two');
    expect(raw).toContain('isProject: true');
  });

  it('writes .plan.md with YAML todos frontmatter', async () => {
    const plansDir = makeTempDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);
    const h = useTestHarness({ sessionId: SESSION_ID });
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const created = await h.callTool('create_plan', AUTH_PLAN);
    const filePath = requireFilePath(created.details);
    expect(dirname(filePath)).toBe(plansDir);
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, 'utf-8');
    expect(raw).toContain(`<!-- ${SESSION_ID} -->`);
    expect(raw).toContain('id: "t1"');
  });

  it('starts execution with write tools and a plan widget', async () => {
    const h = await startExecutingAuthPlan();
    expect(h.getStatuses()['pi-modes']).toContain('Plan 0/2');
    expect(h.getActiveTools()).toContain('edit');
    expect(h.getWidgets()['pi-modes-plan']).toHaveLength(TWO);
  });

  it('marks the first plan step done when the assistant reports [DONE:1]', async () => {
    const h = await startExecutingAuthPlan();
    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Done [DONE:1]' }] } });
    expect(h.getStatuses()['pi-modes']).toContain('Plan 1/2');
  });

  it('clears plan execution when the remaining step completes', async () => {
    const h = await startExecutingAuthPlan();
    await h.emit('turn_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Done [DONE:1]' }] } });
    await h.emit('agent_end', { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Step 2 complete' }] }] });
    expect(h.getStatuses()['pi-modes']).toBeUndefined();
    expect(h.getSentMessages()).toHaveLength(TWO);
  });

  it('supports proposing changes to a plan via editor', async () => {
    const plansDir = makeTempDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);

    const h = useTestHarness({ selectResponses: ['2. No, propose changes'], editorResponses: ['Please add rollback steps'] });
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
    const h = useTestHarness({ initialEntries: RESUME_ENTRIES });
    await h.emit('session_start', {});
    expect(h.getStatuses()['pi-modes']).toContain('Plan 1/2');
  });

  it('clears plan execution state on resume when all steps are already completed', async () => {
    const h = useTestHarness({ initialEntries: RESUME_ALL_DONE_ENTRIES });
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
  it('returns the freeform Other answer for a single-select question', async () => {
    const h = useTestHarness({
      selectResponses: ['Other'],
      inputResponses: ['Postgres'],
    });
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const single = await h.callTool('ask_question', SINGLE_QUESTION_ARGS);
    expect(single.details?.['status']).toBe('success');
    expect(single.content[ZERO]?.text).toContain('Postgres');
  });

  it('returns every chosen option for a multi-select question', async () => {
    const h = useTestHarness({
      selectResponses: ['[ ] Redis', '[ ] SQLite', 'Done selecting'],
    });
    await h.emit('session_start', {});
    await h.runCommand('plan');

    const multi = await h.callTool('ask_question', MULTI_QUESTION_ARGS);
    expect(multi.details?.['status']).toBe('success');
    expect(multi.content[ZERO]?.text).toContain('redis');
    expect(multi.content[ZERO]?.text).toContain('sqlite');
  });
});

describe('Plan file location', () => {
  it('writes plans under the configured Pi agent directory by default', async () => {
    const agentDir = makeTempDir();
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);

    const h = useTestHarness();
    await h.emit('session_start', {});
    await h.runCommand('plan');
    const created = await h.callTool('create_plan', { name: 'Agent Dir', plan: '# Agent Dir\n\n1. Do the work\n' });

    const filePath = requireFilePath(created.details);
    expect(dirname(filePath)).toBe(join(agentDir, 'plans'));
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Plan mode execution handoff', () => {
  it('drops the plan banner from the request once execution starts', async () => {
    const plansDir = makeTempDir();
    vi.stubEnv('PI_MODES_PLANS_DIR', plansDir);

    const h = useTestHarness({ selectResponses: ['1. Yes, build locally'] });
    await h.emit('session_start', {});
    await h.runCommand('plan');
    const injected = double<{ message?: { content: string; details: { runId: string } } } | undefined>(await h.emit('before_agent_start', { messageType: 'user', prompt: 'plan it' }));
    expect(injected?.message?.content).toContain('[PLAN MODE ACTIVE]');
    const runId = injected?.message?.details.runId ?? '';

    await h.callTool('create_plan', { name: 'Ship', plan: '# Ship\n\n1. Edit the file\n' });
    await h.emit('agent_end', { messages: [] });
    expect(h.getActiveTools()).toContain('edit');

    const filtered = double<{ messages: readonly { content?: string }[] }>(
      await h.emit('context', {
        messages: [
          { role: 'user', content: 'plan it' },
          { role: 'custom', customType: 'pi-modes-context', content: '[PLAN MODE ACTIVE] Do NOT edit', details: { runId } },
        ],
      }),
    );
    expect(filtered.messages.map((message) => message.content).join('\n')).not.toContain('PLAN MODE ACTIVE');
  });
});

describe('plan completion phrases', () => {
  const steps = [
    { step: ONE, id: 's1', text: 'First step', completed: false },
    { step: TWO, id: 's2', text: 'Second step', completed: false },
  ];

  it('does not complete on a negated plan statement', () => {
    const advanced = advancePlanSteps("I don't think the plan is done. Step 2 remains.", steps);
    expect(advanced.every((step) => !step.completed)).toBe(true);
  });

  it('completes all steps when the assistant says all steps are done', () => {
    const advanced = advancePlanSteps('All steps are done.', steps);
    expect(advanced.every((step) => step.completed)).toBe(true);
  });
});
