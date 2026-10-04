import { expect, test } from 'vitest';
import { parseRoutine, webhookBody } from '../src/routine-domain.ts';

const cases = [
  { field: 'ticket-id', body: '{"ticket-id":"123"}', expected: { 'ticket-id': '123' } },
  { field: '1st', body: '{"1st":"first"}', expected: { '1st': 'first' } },
  { field: 'équipe', body: '{"équipe":"ops"}', expected: { équipe: 'ops' } },
  { field: '', body: '{"":"empty key"}', expected: { '': 'empty key' } },
  { field: '__proto__', body: '{"__proto__":"data"}', expected: { ['__proto__']: 'data' } },
  { field: '\n', body: '{"\\n":"data"}', expected: { '\n': 'data' } },
];

test.for(cases)('preserves the declared JSON member name $field', ({ field, body, expected }) => {
  const draft = parseRoutine({ name: 'button', prompt: 'Read the declared JSON member as data.', fields: [field] });
  expect(draft.fields).toEqual([field]);
  expect(webhookBody(body, draft.fields)).toEqual(expected);
});

test('accepts a fieldless button payload without inventing an action member', () => {
  const draft = parseRoutine({ name: 'button', prompt: 'Ignore the empty JSON probe.', fields: [] });
  expect(draft.fields).toEqual([]);
  expect(webhookBody('{}', draft.fields)).toEqual({});
});

test('accepts the maximum bounded member-name length and field count', () => {
  const fields = ['x'.repeat(64), ...Array.from({ length: 15 }, (_, index) => `field${index}`)];
  const draft = parseRoutine({ name: 'button', prompt: 'Read fields as data.', fields });
  expect(draft.fields).toHaveLength(16);
  expect(draft.fields).toContain('x'.repeat(64));
});

test('matches declared Unicode names exactly without normalization', () => {
  const body = JSON.stringify({ 'e\u0301quipe': 'ops' });
  expect(() => webhookBody(body, ['équipe'])).toThrow('Webhook body contains an undeclared field.');
});

test.for([null, undefined, [null], [1], [{}], ['x'.repeat(65)], Array.from({ length: 17 }, (_, index) => `field${index}`)])('rejects malformed or oversized field lists %j', (fields) => {
  expect(() => parseRoutine({ name: 'button', prompt: 'Read fields as data.', fields })).toThrow('Invalid routine definition.');
});
