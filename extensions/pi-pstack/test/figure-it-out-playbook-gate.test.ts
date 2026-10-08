import { expect, test } from 'vitest';

import {
  figureItOutPlaybookGateMessage,
  figureItOutPlaybookUsageBlock,
  figureItOutSkillPrompt,
  isPlaybookArtifactPath,
  playbookWriteStarted,
  registerFigureItOutPlaybookGate,
} from '../src/figure-it-out-playbook-gate.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const fioPrompt = `<skill name="figure-it-out" location="/pkg/skills/figure-it-out/SKILL.md">\n# Figure it out\n</skill>\n\nthis is a multi-part note-store migration`;

function harness() {
  const handlers = new Map<string, (event: never, ctx?: never) => unknown>();
  const pi = {
    on: (name: string, handler: (event: never, ctx?: never) => unknown) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  registerFigureItOutPlaybookGate(pi);
  return handlers;
}

test('figureItOutSkillPrompt detects an expanded figure-it-out skill turn and ignores other skills', () => {
  expect(figureItOutSkillPrompt(fioPrompt)).toBe(true);
  expect(figureItOutSkillPrompt('<skill name="how" location="/pkg/skills/how/SKILL.md">\nbody\n</skill>')).toBe(false);
  expect(figureItOutSkillPrompt('/figure-it-out migrate notes')).toBe(false);
});

test('isPlaybookArtifactPath matches capture-recognized trail and playbook names', () => {
  expect(isPlaybookArtifactPath('PLAYBOOK.md')).toBe(true);
  expect(isPlaybookArtifactPath('decisions.tsv')).toBe(true);
  expect(isPlaybookArtifactPath('DECISIONS.md')).toBe(true);
  expect(isPlaybookArtifactPath('/tmp/fixture/.audit/run.tsv')).toBe(true);
  expect(isPlaybookArtifactPath('src/store.js')).toBe(false);
  expect(isPlaybookArtifactPath('notes.json')).toBe(false);
});

test('playbookWriteStarted accepts write/edit of a playbook path only', () => {
  expect(playbookWriteStarted('write', { path: 'PLAYBOOK.md', content: 'Phase A\nDone predicate: x' })).toBe(true);
  expect(playbookWriteStarted('edit', { path: 'decisions.tsv', edits: [{ oldText: 'a', newText: 'b' }] })).toBe(true);
  expect(playbookWriteStarted('write', { path: 'src/store.js', content: 'export {}' })).toBe(false);
  expect(playbookWriteStarted('bash', { command: 'echo hi > PLAYBOOK.md' })).toBe(false);
});

test('a figure-it-out turn blocks product mutation until a playbook write lands', () => {
  const handlers = harness();
  const sections: Record<string, string> = {};
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: fioPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections },
  } as never);

  expect(sections['pstack_fio_playbook']).toBe(figureItOutPlaybookUsageBlock);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'cat > src/store.js <<EOF\nx\nEOF' } } as never)).toEqual({
    block: true,
    reason: figureItOutPlaybookGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '2', toolName: 'write', input: { path: 'src/store.js', content: 'x' } } as never)).toEqual({
    block: true,
    reason: figureItOutPlaybookGateMessage,
  });
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '3', toolName: 'read', input: { path: 'src/store.js' } } as never)).toBe(undefined);

  expect(
    handlers.get('tool_call')?.({
      type: 'tool_call',
      toolCallId: '4',
      toolName: 'write',
      input: { path: 'PLAYBOOK.md', content: '## Phase A\nDone predicate: verify.mjs exits 0\n' },
    } as never),
  ).toBe(undefined);

  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '5', toolName: 'write', input: { path: 'src/store.js', content: 'x' } } as never)).toBe(undefined);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '6', toolName: 'bash', input: { command: 'node verify.mjs' } } as never)).toBe(undefined);
});

test('a non-figure-it-out turn does not arm the playbook gate', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: 'fix the store loader',
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);
  expect(handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: '1', toolName: 'write', input: { path: 'src/store.js', content: 'x' } } as never)).toBe(undefined);
});

test('settling a figure-it-out turn without a playbook write continues once with a reminder', () => {
  const handlers = harness();
  handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt: fioPrompt,
    systemPrompt: '',
    systemPromptOptions: { sections: {} },
  } as never);

  const first = handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never) as {
    continue: boolean;
    entries: Array<{ customType: string; content: string }>;
  };
  expect(first.continue).toBe(true);
  expect(first.entries[0]?.customType).toBe('pstack-fio-playbook');
  expect(first.entries[0]?.content).toContain('playbook');

  expect(handlers.get('agent_before_settle')?.({ type: 'agent_before_settle', outcome: 'completed' } as never)).toBe(undefined);
});
