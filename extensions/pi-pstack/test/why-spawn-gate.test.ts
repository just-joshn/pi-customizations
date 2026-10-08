import { expect, test } from 'vitest';

import {
  investigatorTaskStarted,
  registerWhySpawnGate,
  whySkillPrompt,
  whySpawnGateMessage,
  whySpawnUsageBlock,
} from '../src/why-spawn-gate.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const whyPrompt = `<skill name="why" location="/pkg/skills/why/SKILL.md">\n## Step 3. Spawn Parallel Investigators\n</skill>\n\nwhy what forces led pstack to use inherit-parent?`;

function harness() {
  const handlers = new Map<string, (event: never, ctx?: never) => unknown>();
  const pi = {
    on: (name: string, handler: (event: never, ctx?: never) => unknown) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  registerWhySpawnGate(pi);
  return handlers;
}

test('whySkillPrompt detects an expanded why skill turn and ignores other skills', () => {
  expect(whySkillPrompt(whyPrompt)).toBe(true);
  expect(whySkillPrompt('<skill name="how" location="/pkg/skills/how/SKILL.md">\nbody\n</skill>')).toBe(false);
  expect(whySkillPrompt('why is inherit-parent used?')).toBe(false);
});

test('investigatorTaskStarted accepts generalPurpose Task without requiring readonly', () => {
  expect(
    investigatorTaskStarted('Task', { prompt: 'source-control investigator', subagent_type: 'generalPurpose' }),
  ).toBe(true);
  expect(
    investigatorTaskStarted('Task', {
      prompt: 'source-control investigator',
      subagent_type: 'generalPurpose',
      readonly: false,
    }),
  ).toBe(true);
  expect(investigatorTaskStarted('Task', { prompt: 'explore', subagent_type: 'explore', readonly: true })).toBe(false);
  expect(investigatorTaskStarted('bash', { command: 'git log' })).toBe(false);
});

test('investigatorTaskStarted accepts live Pi-shaped task args and why-investigator names', () => {
  expect(
    investigatorTaskStarted('task', {
      agent_type: 'general-purpose',
      name: 'why-investigator-source-control',
      prompt: 'Investigate git history for inherit-parent',
    }),
  ).toBe(true);
  expect(
    investigatorTaskStarted('task', {
      agent_type: 'explore',
      name: 'why-investigator',
      prompt: 'Investigate tickets',
    }),
  ).toBe(true);
  expect(
    investigatorTaskStarted('task', {
      agent_type: 'explore',
      name: 'how-explainer',
      prompt: 'wrong skill role',
    }),
  ).toBe(false);
});

test('a why turn allows Step 2 bash before settle, then blocks exploration until an investigator Task starts', () => {
  const handlers = harness();
  const sections: Record<string, string> = {
    subagent_usage: '<subagent_usage>\nDefault to doing the work yourself.\n</subagent_usage>',
  };
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: whyPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections },
  } as never);

  expect(sections['subagent_usage']).toBe(whySpawnUsageBlock);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'git log' } } as never)).toBe(
    undefined,
  );

  const settle = handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never) as {
    continue: boolean;
    entries: Array<{ customType: string; content: string }>;
  };
  expect(settle.continue).toBe(true);
  expect(settle.entries[0]?.customType).toBe('pstack-why-spawn');

  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'bash', input: { command: 'git log' } } as never)).toEqual({
    block: true,
    reason: whySpawnGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '3', toolName: 'read', input: { path: 'models.mdc' } } as never)).toEqual({
    block: true,
    reason: whySpawnGateMessage,
  });

  expect(
    handlers.get('tool_call')?.({
      type: 'tool_call',
      toolCallId: '4',
      toolName: 'Task',
      input: { prompt: 'source-control investigator', subagent_type: 'generalPurpose' },
    } as never),
  ).toBe(undefined);

  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '5', toolName: 'bash', input: { command: 'git log' } } as never)).toBe(
    undefined,
  );
});

test('a non-why turn does not arm the spawn gate', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'summarize models.mdc',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'git log' } } as never)).toBe(
    undefined,
  );
});

test('settling a why turn without an investigator Task continues once with a spawn reminder', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: whyPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);

  const first = handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never) as {
    continue: boolean;
    entries: Array<{ customType: string; content: string }>;
  };
  expect(first.continue).toBe(true);
  expect(first.entries[0]?.customType).toBe('pstack-why-spawn');
  expect(first.entries[0]?.content).toContain('Step 3');

  expect(handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never)).toBe(undefined);
});
