import { expect, test } from 'vitest';
import { type AgentView, backgroundStartedText, listAgentsText, listAgentsTooManyText, movedToBackgroundText, promptDetail, readAgentText, syncResultText, writeAgentRefusal, writeAgentSentText } from '../src/subagents/tool-results.ts';

const view = (overrides: Partial<AgentView> = {}): AgentView => ({ id: 'a1', agentType: 'explore', name: 'alpha', status: 'idle', mode: 'background', description: 'find files', elapsedMs: 4200, turns: ['two files'], ...overrides });

test('a sync result is the final message verbatim', () => {
  expect(syncResultText('src/a.ts\nsrc/b.ts')).toBe('src/a.ts\nsrc/b.ts');
});

test('an empty sync result reports that no response was produced', () => {
  expect(syncResultText('')).toBe('Agent completed but produced no response.');
});

test('the background start text opens with the agent id sentence', () => {
  expect(backgroundStartedText('id-7').startsWith("Agent started in background with agent_id: id-7. You'll be notified when it completes.")).toBe(true);
  expect(backgroundStartedText('id-7')).toContain('write_agent only for follow-ups on the same task');
});

test('the prompt detail names the agent type and id before the prompt', () => {
  expect(promptDetail('explore', 'id-7', 'look around')).toBe('Prompt to explore agent (id-7)\n\nlook around');
});

test('a move to background ends with the read_agent suffix', () => {
  expect(movedToBackgroundText('id-7').endsWith(' Use read_agent to check for results.')).toBe(true);
});

test('an idle agent reads as waiting for messages with its turns', () => {
  expect(readAgentText(view())).toBe('Agent is idle (waiting for messages).\nagent_id: a1\nagent_type: explore\nstatus: idle\ndescription: find files\nelapsed: 4s\ntotal_turns: 1\n\n[Turn 0]\ntwo files');
});

test('since_turn is inclusive and skips earlier turns', () => {
  const text = readAgentText(view({ turns: ['first', 'second', 'third'] }), 1);
  expect(text).toContain('total_turns: 3');
  expect(text.split('\n\n').slice(1)).toEqual(['[Turn 1]\nsecond', '[Turn 2]\nthird']);
});

test('a since_turn past the last turn says there is nothing new', () => {
  expect(readAgentText(view(), 5).endsWith('No responses from turn 5 onward.')).toBe(true);
});

test.for([
  { status: 'running', headline: 'Agent is still running.' },
  { status: 'completed', headline: 'Agent completed.' },
  { status: 'cancelled', headline: 'Agent was cancelled.' },
] as const)('a $status agent opens with its headline', ({ status, headline }) => {
  expect(readAgentText(view({ status })).split('\n')[0]).toBe(headline);
});

test('a failed agent carries its error and an empty completion carries the no-response text', () => {
  expect(readAgentText(view({ status: 'failed', error: 'boom' })).split('\n')[0]).toBe('Agent failed: boom');
  expect(readAgentText(view({ status: 'completed', turns: [''] })).split('\n')[0]).toBe('Agent completed but produced no response.');
});

test('write_agent refusals name the background-only rule', () => {
  expect(writeAgentRefusal({ id: 'a1', mode: 'sync', status: 'completed' })).toBe('write_agent only supports background agents. Agent a1 was started in sync mode.');
  expect(writeAgentRefusal({ id: 'a1', mode: 'background', status: 'failed' })).toBe('write_agent only supports background agents that are running or idle. Agent a1 is failed.');
});

test('the write_agent confirmation differs for idle and running agents', () => {
  expect(writeAgentSentText({ id: 'a1', status: 'idle' })).toContain('It resumed work');
  expect(writeAgentSentText({ id: 'a1', status: 'running' })).toContain('queued for its next turn');
});

test('list_agents prints one line per agent and a placeholder for none', () => {
  expect(listAgentsText([view()])).toBe('agent_id: a1 | agent_type: explore | name: alpha | mode: background | status: idle | description: find files');
  expect(listAgentsText([])).toBe('No agents.');
});

test('a scope that matches too many agents asks for an explicit list', () => {
  expect(listAgentsTooManyText(80)).toBe('The requested scope matches 80 agents, which exceeds the limit of 50. Pass an explicit agent_ids list.');
});
