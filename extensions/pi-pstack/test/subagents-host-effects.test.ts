import { expect, test } from 'vitest';
import { type HostEffect, runHostEffect, type SubagentHost } from '../src/subagents/host-effects.ts';

const model = { reference: 'p/m', provider: 'p', id: 'm', cost: 1, contextWindow: 1 };
const host = (overrides: Partial<SubagentHost> = {}): SubagentHost => ({
  blocksStart: () => false,
  toolsAvailable: () => true,
  selectedModel: () => model,
  rubberDuckRollout: () => true,
  subconscious: () => false,
  availableCustomAgents: () => ['mine'],
  customPrompt: () => 'Be brief.',
  hasActiveBackgroundWork: () => true,
  transformSection: (section, text) => `${section}:${text}`,
  ...overrides,
});
const start = (action: string): HostEffect => ({ kind: 'start_subagent', action });

test.for([
  { action: 'checkStartAllowed', reply: { allowed: true } },
  { action: 'prepareTools', reply: { allowed: true } },
  { action: 'resolveSelectedModel', reply: { model } },
  { action: 'resolveRubberDuckRollout', reply: { enabled: true } },
  { action: 'resolveSubconscious', reply: { enabled: false } },
])('start_subagent $action answers from the host state', ({ action, reply }) => {
  expect(runHostEffect(host(), start(action))).toEqual(reply);
});

test('checkStartAllowed refuses while a rewind or dispose is under way', () => {
  expect(() => runHostEffect(host({ blocksStart: () => true }), start('checkStartAllowed'))).toThrow('Cannot start subagent while the session is rewinding or disposing');
});

test('prepareTools refuses when the session has no tools', () => {
  expect(() => runHostEffect(host({ toolsAvailable: () => false }), start('prepareTools'))).toThrow('Cannot start subagent: tools are not available for this session');
});

test('an unknown start_subagent action is unsupported', () => {
  expect(() => runHostEffect(host(), start('explode'))).toThrow('Unsupported start-subagent host action');
});

test('a custom agent prompt is served only for an available custom agent', () => {
  expect(runHostEffect(host(), { kind: 'custom_agent_prompt', agent: 'mine' })).toEqual({ text: 'Be brief.' });
  expect(runHostEffect(host(), { kind: 'custom_agent_system_prompt', agent: 'mine' })).toEqual({ text: 'Be brief.' });
  expect(() => runHostEffect(host(), { kind: 'custom_agent_prompt', agent: 'ghost' })).toThrow("Custom agent 'ghost' is not available in this session.");
});

test('section transforms and background work are answered by the host', () => {
  expect(runHostEffect(host(), { kind: 'system_prompt_section_transform', section: 'tools', text: 'x' })).toEqual({ text: 'tools:x' });
  expect(runHostEffect(host(), { kind: 'has_active_background_work' })).toEqual({ active: true });
});
