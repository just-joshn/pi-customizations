import { expect, test } from 'vitest';
import { asEnvelope, type EventEnvelope, EventLog, eventChannel, eventEntryType, eventsLogIncludesSubagents, provenanceOf } from '../src/subagents/events.ts';

function harness() {
  const emitted: EventEnvelope[] = [];
  const persisted: EventEnvelope[] = [];
  const log = new EventLog({ emit: (envelope) => emitted.push(envelope), persist: (envelope) => persisted.push(envelope) }, () => new Date('2026-01-02T03:04:05.000Z'));
  return { log, emitted, persisted };
}

test('a durable event is emitted and persisted with an iso timestamp and a null parent', () => {
  const { log, emitted, persisted } = harness();
  const started = log.emit('subagent.configured', { model: 'm', contextTier: 'default', multiTurn: true });
  expect(started).toMatchObject({ type: 'subagent.configured', parentId: null, timestamp: '2026-01-02T03:04:05.000Z', data: { model: 'm', contextTier: 'default', multiTurn: true } });
  expect(emitted).toEqual([started]);
  expect(persisted).toEqual([started]);
});

test('each durable event links to the previous durable event', () => {
  const { log } = harness();
  const first = log.emit('subagent.selected', { agentName: 'a', agentDisplayName: 'A', tools: [] });
  const second = log.emit('subagent.deselected', {});
  expect(second.parentId).toBe(first.id);
});

test('an ephemeral event is emitted but neither persisted nor chained', () => {
  const { log, emitted, persisted } = harness();
  const first = log.emit('subagent.deselected', {});
  const tick = log.emit('session.background_tasks_changed', {}, { ephemeral: true });
  const next = log.emit('subagent.deselected', {});
  expect(tick).toMatchObject({ ephemeral: true, parentId: first.id });
  expect(next.parentId).toBe(first.id);
  expect(emitted).toHaveLength(3);
  expect(persisted.map((envelope) => envelope.id)).toEqual([first.id, next.id]);
});

test('a child owned event carries the agent id on the envelope', () => {
  const { log } = harness();
  expect(log.emit('assistant.turn_start', {}, { agentId: 'child-1' })).toMatchObject({ agentId: 'child-1' });
});

test('provenance reports whether the configured model matched the actual one', () => {
  expect(provenanceOf({ model: 'openai/gpt-6-luna', firstDispatched: 'openai/gpt-6-luna', source: 'configured_required', configured: 'gpt-6-luna' })).toEqual({
    model: 'openai/gpt-6-luna',
    firstDispatchedModel: 'openai/gpt-6-luna',
    configuredModelPreference: 'gpt-6-luna',
    modelSelectionSource: 'configured_required',
    configuredModelMatchesActual: true,
  });
});

test('provenance records an explicit override that differs from the preference', () => {
  expect(provenanceOf({ model: 'a/x', firstDispatched: 'a/x', source: 'explicit_override', configured: 'y', requested: 'a/x', overrideReason: 'why' })).toEqual({
    model: 'a/x',
    firstDispatchedModel: 'a/x',
    configuredModelPreference: 'y',
    modelSelectionSource: 'explicit_override',
    configuredModelMatchesActual: false,
    explicitModelOverride: 'a/x',
    explicitModelMatchesPreference: false,
    modelOverrideReason: 'why',
  });
});

test('asEnvelope accepts a complete envelope and rejects malformed values', () => {
  const envelope = { id: 'e1', timestamp: '2026-01-02T03:04:05.000Z', parentId: null, type: 'subagent.selected', data: { a: 1 } };
  expect(asEnvelope(envelope)).toEqual(envelope);
  expect(asEnvelope({ ...envelope, agentId: 'child-1', ephemeral: true })).toMatchObject({ agentId: 'child-1', ephemeral: true });
  for (const bad of [undefined, null, {}, { ...envelope, id: 1 }, { ...envelope, parentId: undefined }, { ...envelope, ephemeral: false }, { ...envelope, agentId: 7 }]) {
    expect(asEnvelope(bad)).toBeUndefined();
  }
});

test('the event channel and entry type keep their documented names', () => {
  expect({ channel: eventChannel, entryType: eventEntryType }).toEqual({ channel: 'reference-assistant:event', entryType: 'reference-assistant-event' });
});

test('relay stamps a child-owned event with the agent id and keeps the durable chain intact', () => {
  const { log, emitted, persisted } = harness();
  const root = log.emit('subagent.selected', { agentName: 'a', agentDisplayName: 'A', tools: [] });
  const childEnvelope: EventEnvelope = { id: 'child-e1', timestamp: '2026-01-02T03:04:06.000Z', parentId: null, type: 'assistant.turn_start', data: {} };
  log.relay(childEnvelope, 'child-1');
  const next = log.emit('subagent.deselected', {});
  expect(emitted[1]).toEqual({ ...childEnvelope, agentId: 'child-1' });
  expect(persisted.map((envelope) => envelope.id)).toEqual([root.id, 'child-e1', next.id]);
  expect(next.parentId).toBe(root.id);
});

test('relay keeps an agent id the child already stamped', () => {
  const { log, emitted } = harness();
  log.relay({ id: 'e', timestamp: 't', parentId: null, type: 'assistant.turn_start', data: {}, agentId: 'own' }, 'other');
  expect(emitted[0]).toMatchObject({ agentId: 'own' });
});

test('an ephemeral relay is emitted but not persisted', () => {
  const { log, emitted, persisted } = harness();
  log.relay({ id: 'e', timestamp: 't', parentId: null, type: 'assistant.turn_start', data: {}, ephemeral: true }, 'child-1');
  expect(emitted).toHaveLength(1);
  expect(persisted).toEqual([]);
});

test('provenance without a configured preference cannot mismatch', () => {
  expect(provenanceOf({ model: 'a/x', firstDispatched: 'a/x', source: 'session_inheritance', requested: 'a/x' })).toEqual({
    model: 'a/x',
    firstDispatchedModel: 'a/x',
    modelSelectionSource: 'session_inheritance',
    configuredModelMatchesActual: true,
    explicitModelOverride: 'a/x',
  });
});

test.for([
  { value: 'true', expected: true },
  { value: '1', expected: false },
  { value: 'TRUE', expected: false },
  { value: ' true ', expected: false },
  { value: undefined, expected: false },
])('COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS=$value is $expected', ({ value, expected }) => {
  expect(eventsLogIncludesSubagents(value === undefined ? {} : { COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS: value })).toBe(expected);
});
