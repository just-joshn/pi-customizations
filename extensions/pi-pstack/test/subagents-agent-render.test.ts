import type { Component } from '@earendil-works/pi-tui';
import { expect, test, vi } from 'vitest';
import { AgentCallGroups, agentActivity, agentDisplayName, renderAgentCall, renderAgentResult } from '../src/subagents/agent-render.ts';
import { workerFixture } from './worker-fixture.ts';

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;
const lines = (component: Component) => component.render(60).map((line) => line.trimEnd());
const context = (toolCallId: string, invalidate = () => {}) => ({ toolCallId, invalidate, lastComponent: undefined }) as never;
const call = (id: string, args: Record<string, unknown>) => ({ type: 'toolCall', id, name: 'Agent', arguments: args });

test.for([
  { args: { description: 'Find auth code', prompt: 'p' }, name: 'Agent' },
  { args: { description: 'Find auth code', prompt: 'p', subagent_type: 'general-purpose' }, name: 'Agent' },
  { args: { description: 'Find auth code', prompt: 'p', subagent_type: 'Explore' }, name: 'Explore' },
])('[C94] user-facing name for subagent_type $args.subagent_type is $name', ({ args, name }) => {
  expect(agentDisplayName(args)).toBe(name);
});

test.for([
  { description: '  Find \n  auth\tcode ', activity: 'Find auth code' },
  { description: '   ', activity: 'Running task' },
  { description: undefined, activity: 'Running task' },
])('[C94] activity description for $description is $activity', ({ description, activity }) => {
  expect(agentActivity({ description })).toBe(activity);
});

test('[C94] a lone Agent call renders its name and activity on one row', () => {
  const groups = new AgentCallGroups();
  groups.observe({ role: 'assistant', content: [call('a', { description: 'Map the repo', subagent_type: 'Explore' })] });
  expect(lines(renderAgentCall({ description: 'Map the repo', prompt: 'p', subagent_type: 'Explore' }, theme, context('a'), groups))).toEqual(['Explore Map the repo']);
});

test('[C96] parallel Agent calls from one assistant message render as one grouped tree', () => {
  const groups = new AgentCallGroups();
  const args = [
    { description: 'one', prompt: 'p', subagent_type: 'Explore' },
    { description: 'two', prompt: 'p' },
    { description: 'three', prompt: 'p', subagent_type: 'Plan' },
  ];
  groups.observe({ role: 'assistant', content: [call('a', args[0] ?? {}), { type: 'toolCall', id: 'r', name: 'read', arguments: {} }, call('b', args[1] ?? {}), call('c', args[2] ?? {})] });
  expect(['a', 'b', 'c'].map((id, index) => lines(renderAgentCall(args[index] as never, theme, context(id), groups)))).toEqual([['Running 3 agents…', '├─ Explore one'], ['├─ Agent two'], ['└─ Plan three']]);
});

test('[C96] the group header reports completion once every grouped call finished', () => {
  const groups = new AgentCallGroups();
  const invalidate = vi.fn();
  groups.observe({ role: 'assistant', content: [call('a', {}), call('b', {})] });
  renderAgentCall({ description: 'one', prompt: 'p' }, theme, context('a', invalidate), groups);
  groups.finish('a');
  expect(lines(renderAgentCall({ description: 'one', prompt: 'p' }, theme, context('a', invalidate), groups))[0]).toBe('Running 2 agents…');
  groups.finish('b');
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(lines(renderAgentCall({ description: 'one', prompt: 'p' }, theme, context('a', invalidate), groups))).toEqual(['2 agents finished', '├─ Agent one']);
});

test('[C96] observing a message with non-assistant or malformed content groups nothing', () => {
  const groups = new AgentCallGroups();
  groups.observe({ role: 'user', content: [call('a', {}), call('b', {})] });
  groups.observe({ role: 'assistant', content: 'text' });
  groups.observe(undefined);
  expect(lines(renderAgentCall({ description: 'one', prompt: 'p' }, theme, context('a'), groups))).toEqual(['Agent one']);
});

test.for([
  { name: 'completed', details: { status: 'completed', totalToolUseCount: 2, totalTokens: 5 }, partial: false, expected: ['Done · 2 tool uses · 5 tokens'] },
  { name: 'one tool use', details: { status: 'completed', totalToolUseCount: 1, totalTokens: 1200 }, partial: false, expected: ['Done · 1 tool use · 1200 tokens'] },
  { name: 'background launch', details: { status: 'async_launched', agentId: 'abc' }, partial: false, expected: ['Running in the background · abc'] },
  { name: 'partial progress', details: undefined, partial: true, expected: ['Running…'] },
  { name: 'an error without details', details: undefined, partial: false, expected: ['body'] },
])('[C94] result row for $name', ({ details, partial, expected }) => {
  const result = { content: [{ type: 'text' as const, text: 'body' }], details };
  expect(lines(renderAgentResult(result as never, { expanded: false, isPartial: partial }, theme))).toEqual(expected);
});

test('[C96] the registered Agent tool groups parallel calls announced by message_end', async () => {
  const fixture = await workerFixture();
  try {
    const runner = fixture.session.extensionRunner;
    const definition = runner.getToolDefinition('Agent');
    await runner.emit({ type: 'message_end', message: { role: 'assistant', content: [call('x1', {}), call('x2', {})] } } as never);
    const render = (id: string, description: string) => lines(definition?.renderCall?.({ description, prompt: 'p' }, theme, context(id)) as Component);
    expect([render('x1', 'first'), render('x2', 'second')]).toEqual([['Running 2 agents…', '├─ Agent first'], ['└─ Agent second']]);
  } finally {
    await fixture.close();
  }
});

test('[C94] an expanded completed result shows the child output below the summary', () => {
  const result = { content: [{ type: 'text' as const, text: 'ignored\nagentId: x' }], details: { status: 'completed', totalToolUseCount: 0, totalTokens: 5, content: [{ type: 'text', text: 'line one\nline two' }] } };
  expect(lines(renderAgentResult(result as never, { expanded: true, isPartial: false }, theme))).toEqual(['Done · 0 tool uses · 5 tokens', 'line one', 'line two']);
});
