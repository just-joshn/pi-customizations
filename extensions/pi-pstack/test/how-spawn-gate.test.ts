import { expect, test } from 'vitest';

import {
  explainerTaskStarted,
  howSkillPrompt,
  howSpawnGateMessage,
  howSpawnUsageBlock,
  registerHowSpawnGate,
} from '../src/how-spawn-gate.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const howPrompt = `<skill name="how" location="/pkg/skills/how/SKILL.md">\n## Step 2b. Direct Explain\n</skill>\n\nhow does the budget line change behavior?`;

function harness() {
  const handlers = new Map<string, (event: never, ctx?: never) => unknown>();
  const pi = {
    on: (name: string, handler: (event: never, ctx?: never) => unknown) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  registerHowSpawnGate(pi);
  return handlers;
}

test('howSkillPrompt detects an expanded how skill turn and ignores other skills', () => {
  expect(howSkillPrompt(howPrompt)).toBe(true);
  expect(howSkillPrompt('<skill name="why" location="/pkg/skills/why/SKILL.md">\nbody\n</skill>')).toBe(false);
  expect(howSkillPrompt('how does auth work?')).toBe(false);
});

test('explainerTaskStarted accepts only readonly generalPurpose Task calls', () => {
  expect(explainerTaskStarted('Task', { prompt: 'explain', subagent_type: 'generalPurpose', readonly: true })).toBe(true);
  expect(explainerTaskStarted('Task', { prompt: 'explain', subagent_type: 'generalPurpose' })).toBe(false);
  expect(explainerTaskStarted('Task', { prompt: 'explain', subagent_type: 'explore', readonly: true })).toBe(false);
  expect(explainerTaskStarted('bash', { command: 'rg budget' })).toBe(false);
});

test('explainerTaskStarted accepts the live Cursor-shaped Task args from Pi recapture 3ebef40f', () => {
  // Measured: tool name "task", agent_type "general-purpose", READONLY prompt prefix, no readonly bool.
  expect(
    explainerTaskStarted('task', {
      agent_type: 'general-purpose',
      name: 'how-explainer',
      description: 'Explain budget line behavior',
      mode: 'sync',
      prompt: 'READONLY task: do not modify any files. Question: "Does the budget line change behavior?"',
    }),
  ).toBe(true);
});

test('explainerTaskStarted accepts the live explore how-explainer Task from pair-investigate-3 pi 951a315d', () => {
  // Measured: tool name "task", agent_type "explore", name "how-explainer", prompt "Readonly task:..."
  // Evidence: parity/evidence/investigate/pi/951a315d-ac83-4901-9342-c82fbcd235a1/method-a-session.json
  expect(
    explainerTaskStarted('task', {
      agent_type: 'explore',
      name: 'how-explainer',
      prompt: 'Readonly task: do not modify any files. Question: "Does the budget line change behavior?"',
    }),
  ).toBe(true);
  expect(
    explainerTaskStarted('task', {
      agent_type: 'explore',
      name: 'how-explorer',
      prompt: 'Readonly task: explore the budget line',
    }),
  ).toBe(false);
  expect(
    explainerTaskStarted('task', {
      agent_type: 'explore',
      name: 'how-explainer',
      prompt: 'explain without a readonly marker',
    }),
  ).toBe(false);
});

test('a simple /how turn blocks direct exploration until a readonly explainer Task starts', () => {
  const handlers = harness();
  const sections: Record<string, string> = {
    subagent_usage: '<subagent_usage>\nDefault to doing the work yourself.\n</subagent_usage>',
  };
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: howPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections },
  } as never);

  expect(sections['subagent_usage']).toBe(howSpawnUsageBlock);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'rg budget' } } as never)).toEqual({
    block: true,
    reason: howSpawnGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'read', input: { path: 'models.mdc' } } as never)).toEqual({
    block: true,
    reason: howSpawnGateMessage,
  });

  expect(
    handlers.get('tool_call')?.({
      type: 'tool_call',
      toolCallId: '3',
      toolName: 'Task',
      input: { prompt: 'explain the budget line', subagent_type: 'generalPurpose', readonly: true },
    } as never),
  ).toBe(undefined);

  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '4', toolName: 'bash', input: { command: 'rg budget' } } as never)).toBe(undefined);
});

test('a non-how turn does not arm the spawn gate', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'summarize models.mdc',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'rg budget' } } as never)).toBe(undefined);
});

test('settling a how turn without an explainer Task continues once with a spawn reminder', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: howPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);

  const first = handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never) as {
    continue: boolean;
    entries: Array<{ customType: string; content: string }>;
  };
  expect(first.continue).toBe(true);
  expect(first.entries[0]?.customType).toBe('pstack-how-spawn');
  expect(first.entries[0]?.content).toContain('Step 2b');

  expect(handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never)).toBe(undefined);
});
