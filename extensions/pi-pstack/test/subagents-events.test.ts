import { expect, test } from 'vitest';
import { type EventEnvelope, EventLog, eventsLogIncludesSubagents, provenanceOf } from '../src/subagents/events.ts';

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

test.for([
  { value: 'true', expected: true },
  { value: '1', expected: false },
  { value: 'TRUE', expected: false },
  { value: undefined, expected: false },
])('COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS=$value is $expected', ({ value, expected }) => {
  expect(eventsLogIncludesSubagents(value === undefined ? {} : { COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS: value })).toBe(expected);
});
