import { expect, test } from 'vitest';
import { parseJsonAgents } from '../src/subagents/json-definitions.ts';

test('[G2-05][G2-06] JSON definitions normalize model and preserve requested tools', () => {
  expect(parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Complete the task.', tools: ['Read'], model: ' INHERIT ', maxTurns: 2 } }), '/tmp')).toEqual([
    { agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Complete the task.', source: 'flagSettings', baseDir: '/tmp', tools: ['Read'], model: 'inherit', maxTurns: 2 },
  ]);
});

test.for([
  { data: { prompt: 'task' }, issue: 'description' },
  { data: { description: 'probe' }, issue: 'prompt' },
  { data: { description: '', prompt: 'task' }, issue: 'Description cannot be empty' },
  { data: { description: 'probe', prompt: 'task', model: '  ' }, issue: 'Model cannot be empty' },
  ...[0, -1, 1.5].map((maxTurns) => ({ data: { description: 'probe', prompt: 'task', maxTurns }, issue: 'maxTurns' })),
])('[G2-05] invalid JSON definition reports $issue', ({ data, issue }) => {
  expect(() => parseJsonAgents(JSON.stringify({ probe: data }), '/tmp')).toThrow(issue);
});

test('[G2-05] recognized unsupported JSON fields refuse instead of being silently dropped', () => {
  expect(() => parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Task', hooks: {} } }), '/tmp')).toThrow('Unsupported native JSON agent fields: hooks');
});

test('[G2-06] JSON Skill deprecation preserves explicit skills and warns', () => {
  let warnings: readonly string[] = [];
  const agents = parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Task', tools: ['Read', 'Skill'], skills: ['existing'] } }), '/tmp', (message) => {
    warnings = [...warnings, message];
  });
  expect(agents).toEqual([{ agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/tmp', tools: ['Read'], skills: ['existing'] }]);
  expect(warnings).toEqual(["Agent 'probe': 'Skill' in tools is deprecated; use the skills field instead."]);
});

test('[G2-05] JSON unknown prototype-named fields are ignored', () => {
  expect(parseJsonAgents('{"probe":{"description":"Probe","prompt":"Task","constructor":"unexpected"}}', '/tmp')).toEqual([{ agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/tmp' }]);
});

test('[G2-05][G2-29] JSON memory accepts exact scopes and rejects unknown scope', () => {
  expect(parseJsonAgents('{"probe":{"description":"Probe","prompt":"Task","memory":"project"}}', '/tmp')).toEqual([
    { agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/tmp', memory: 'project' },
  ]);
  expect(() => parseJsonAgents('{"probe":{"description":"Probe","prompt":"Task","memory":"team"}}', '/tmp')).toThrow('memory');
});

test.for(['low', 'medium', 'high', 'xhigh', 'max', 12000])('[G2-05] JSON effort %s is preserved', (effort) => {
  expect(parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Task', effort } }), '/tmp')).toEqual([{ agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/tmp', effort }]);
});

test.for(['invalid', 1.5, null])('[G2-05] invalid JSON effort %s refuses', (effort) => {
  expect(() => parseJsonAgents(JSON.stringify({ probe: { description: 'Probe', prompt: 'Task', effort } }), '/tmp')).toThrow('effort');
});

test.for(['null', '[]', 'invalid', '{"-bad":{"description":"probe","prompt":"task"}}'])('[G2-05] invalid JSON agent map %s refuses', (value) => {
  expect(() => parseJsonAgents(value, '/tmp')).toThrow();
});
