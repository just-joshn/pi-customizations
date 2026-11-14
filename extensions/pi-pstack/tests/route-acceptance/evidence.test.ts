import { readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { overrideCases, playbookCases, routePath } from './cases.ts';
import { routeEvidence } from './evidence.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expected = { route: 'investigation', path: '/package/playbooks/investigation.md', source: '# Investigation\nFull source\u2028not a record boundary\n', cwd: '/work', noPr: true };
const events = (): Record<string, unknown>[] => [
  { type: 'tool_execution_start', toolCallId: 'r1', toolName: 'read', args: { path: expected.path } },
  { type: 'tool_execution_end', toolCallId: 'r1', isError: false, result: { content: [{ type: 'text', text: expected.source }] } },
  { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ route: expected.route, path: expected.path, prRequired: false }) }] } },
  { type: 'agent_settled', aborted: false },
];
const jsonl = (value: unknown[]) => value.map((event) => JSON.stringify(event)).join('\n');

test('the matrix covers exactly the 23 pinned playbooks, plus source-backed override cases', () => {
  expect(playbookCases).toHaveLength(23);
  const names = readdirSync(dirname(routePath(root, 'feature')))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3));
  expect(playbookCases.map((item) => item.expected).sort()).toEqual(names.sort());
  expect(new Set(playbookCases.map((item) => item.prompt)).size).toBe(23);
  expect(overrideCases.map((item) => item.expected)).toEqual(['figure-it-out', 'figure-it-out', 'investigation']);
  for (const item of [...playbookCases, ...overrideCases]) expect(readFileSync(routePath(root, item.expected), 'utf8').length).toBeGreaterThan(0);
});

test('recorded choice, source path, full successful read and no-PR policy establish the limited routing property', () => {
  const result = routeEvidence(jsonl(events()), expected, 0);
  expect(result.status).toBe('PASS');
  expect(result.fullRead).toBe(true);
  expect(result.axes).toEqual({ outcome: 'YES', workflow: 'INCONCLUSIVE', piImplementation: 'INCONCLUSIVE' });
});

test.for(['wrong-source', 'truncated', 'failed-read', 'missing-read', 'wrong-call'])('a declared correct route cannot substitute for %s evidence', (mutation) => {
  const value = events();
  if (mutation === 'wrong-source') value[0] = { ...value[0], args: { path: '/unrelated/file.md' } };
  if (mutation === 'truncated') value[1] = { ...value[1], result: { content: [{ type: 'text', text: '# Investigation' }] } };
  if (mutation === 'failed-read') value[1] = { ...value[1], isError: true };
  if (mutation === 'missing-read') value.splice(0, 2);
  if (mutation === 'wrong-call') value[1] = { ...value[1], toolCallId: 'other' };
  expect(routeEvidence(jsonl(value), expected, 0)).toMatchObject({ status: 'FAIL', fullRead: false, axes: { workflow: 'NO' } });
});

test.for([
  { route: 'feature', path: expected.path, prRequired: false },
  { route: expected.route, path: '/wrong/path.md', prRequired: false },
  { route: expected.route, path: expected.path, prRequired: true },
])('wrong route, wrong path or an inappropriate PR cannot pass', (choice) => {
  const value = events();
  value[2] = { ...value[2], message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(choice) }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('FAIL');
});

test.for([null, 1])('an incomplete or failed process is inconclusive, not a model failure or PASS', (exitCode) => {
  expect(routeEvidence(jsonl(events()), expected, exitCode).status).toBe('INCONCLUSIVE');
});

test('missing settle, final provider error and unstructured output require review', () => {
  expect(routeEvidence(jsonl(events().slice(0, -1)), expected, 0).status).toBe('INCONCLUSIVE');
  expect(routeEvidence(jsonl([...events(), { type: 'agent_settled', aborted: true }]), expected, 0).status).toBe('INCONCLUSIVE');
  const value = events();
  value[2] = { ...value[2], message: { role: 'assistant', stopReason: 'error', content: [] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('INCONCLUSIVE');
  value[2] = { ...value[2], message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Choose Investigation.' }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('INCONCLUSIVE');
});

test('a recovered provider attempt does not erase the later valid parent response', () => {
  const value = [{ type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } }, ...events()];
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('PASS');
});

test('complete chunked reads pass while a missing chunk cannot pass', () => {
  const boundary = expected.source.indexOf('\n') + 1;
  const value = events();
  value[1] = { ...value[1], result: { content: [{ type: 'text', text: expected.source.slice(0, boundary) }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('FAIL');
  value.splice(
    2,
    0,
    { type: 'tool_execution_start', toolCallId: 'r2', toolName: 'read', args: { path: expected.path, offset: 2 } },
    { type: 'tool_execution_end', toolCallId: 'r2', isError: false, result: { content: [{ type: 'text', text: expected.source.slice(boundary) }] } },
  );
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('PASS');
});

test('quoting source inside unrelated output is not a successful file read', () => {
  const value = events();
  value[1] = { ...value[1], result: { content: [{ type: 'text', text: `unrelated prefix\n${expected.source}` }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('FAIL');
});

test('a missing PR policy is missing evidence rather than a claimed policy violation', () => {
  const value = events();
  value[2] = { ...value[2], message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ route: expected.route, path: expected.path }) }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('INCONCLUSIVE');
});

test('a selected source read after the final decision cannot validate that decision', () => {
  const value = events();
  expect(routeEvidence(jsonl([value[2], value[0], value[1], value[3]]), expected, 0).status).not.toBe('PASS');
});

test.for(['length', 'toolUse', 'pending', undefined])('final stop reason %s cannot establish a completed decision', (stopReason) => {
  const value = events();
  value[2] = { ...value[2], message: { role: 'assistant', stopReason, content: [{ type: 'text', text: JSON.stringify({ route: expected.route, path: expected.path, prRequired: false }) }] } };
  expect(routeEvidence(jsonl(value), expected, 0).status).toBe('INCONCLUSIVE');
});

test.for([{ type: 'agent_start', nonsense: true }, { type: 'agent_settled' }, { type: 'tool_execution_start', toolName: 'read' }, { type: 'message_end', message: 'not an object' }, { type: 'tool_execution_end', isError: 'false' }])(
  'malformed consumed event shapes require review rather than PASS',
  (malformed) => {
    const value = events();
    value.splice(2, 0, malformed);
    expect(() => routeEvidence(jsonl(value), expected, 0)).toThrow('Malformed');
  },
);

test('invalid event framing is rejected rather than treated as evidence', () => {
  expect(() => routeEvidence('null\n', expected, 0)).toThrow('Malformed');
  expect(() => routeEvidence('not json\n', expected, 0)).toThrow();
});
