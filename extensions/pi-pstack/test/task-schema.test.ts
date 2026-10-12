import { describe, expect, test } from 'vitest';
import { effectiveReadonly, TaskParams, taskPreflight } from '../src/task/tool.ts';

describe('Task parameters (TASK-001)', () => {
  test('requires description and prompt, like Cursor', () => {
    expect(TaskParams.required).toEqual(['description', 'prompt']);
  });

  test('accepts Cursor parameters plus the readonly and environment fields pstack passes', () => {
    const schema = JSON.parse(JSON.stringify(TaskParams)) as { properties: Record<string, { type?: string; enum?: string[] }> };
    expect(Object.keys(schema.properties).toSorted()).toEqual(['cloud_base_branch', 'description', 'environment', 'file_attachments', 'model', 'prompt', 'readonly', 'resume', 'run_in_background', 'subagent_type']);
    expect(schema.properties['environment']?.enum).toEqual(['local', 'cloud']);
    expect(schema.properties['run_in_background']?.type).toBe('boolean');
  });
});

describe('Task preflight', () => {
  const ok = { description: 'probe', prompt: 'p' };

  test.for([{ environment: 'cloud' as const }, { cloud_base_branch: 'feature/x' }])('refuses cloud execution instead of running locally: %j (TASK-010)', (extra) => {
    expect(() => taskPreflight({ ...ok, ...extra }, 0)).toThrow(
      'Pi has no cloud subagents, so environment "cloud" and cloud_base_branch are unavailable. Repeat this call without them to run the worker locally. A local worker starts in this working directory, so when workers write in parallel, tell each one to create its own git worktree (git worktree add <path> -b <branch> <base>) and work only there.',
    );
  });

  test('refuses a grandchild launch (TASK-011)', () => {
    expect(() => taskPreflight(ok, 2)).toThrow('A subagent launched by another subagent cannot launch further subagents.');
  });

  test('allows the main agent and direct subagents (TASK-011)', () => {
    const outcome = (depth: number, environment?: 'local') => {
      try {
        taskPreflight(environment === undefined ? ok : { ...ok, environment }, depth);
        return 'allowed';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect([outcome(0, 'local'), outcome(1), outcome(2)]).toEqual(['allowed', 'allowed', 'A subagent launched by another subagent cannot launch further subagents.']);
  });
});

describe('readonly (TASK-008; review: security)', () => {
  test('a readonly agent type stays readonly whatever the call asks', () => {
    expect([effectiveReadonly(true, false), effectiveReadonly(true, undefined), effectiveReadonly(false, true), effectiveReadonly(false, undefined)]).toEqual([true, true, true, false]);
  });
});
