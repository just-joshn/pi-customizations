import { expect, test } from 'vitest';

import {
  AUTOMATIONS_EDITOR_CHROME,
  automationsEditorResult,
  formatTriggerText,
  initialAutomationsEditorState,
  reduceAutomationsEditor,
  renderAutomationsEditor,
} from '../src/automations-editor.ts';
import type { AutomationsEditorDraft } from '../src/automations-editor.ts';

const draft: AutomationsEditorDraft = {
  name: 'benny-triage',
  description: 'Slack triage draft',
  instructions: 'Triage top-level Slack messages.',
  operationalPath: '.pi/automations/benny',
  trigger: { type: 'slack.top_level', channelId: 'C0123456789' },
  tools: ['slack.thread.read', 'tracker'],
  revision: 'a'.repeat(64),
};

test('chrome title is the automation name and state is Inactive', () => {
  const lines = renderAutomationsEditor(initialAutomationsEditorState(draft), 100).join('\n');
  expect(lines).toContain('benny-triage');
  expect(lines).toContain('State: Inactive');
  expect(lines).toContain(`chrome:${AUTOMATIONS_EDITOR_CHROME}`);
  expect(lines).toContain('Instructions:');
  expect(lines).toContain('Trigger:');
  expect(lines).toContain('Tools:');
  expect(lines).toContain('Save (keeps Inactive / disabled)');
});

test('Save disposition returns the edited definition without enabling', () => {
  let state = initialAutomationsEditorState(draft);
  // focus Save (index 4): description, instructions, trigger, tools, save
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'enter');
  expect(state.finished).toBe(true);
  expect(state.disposition).toBe('saved');
  expect(state.stateLabel).toBe('Inactive');
  const result = automationsEditorResult(state);
  expect(result).toEqual({
    disposition: 'saved',
    definition: {
      name: 'benny-triage',
      description: 'Slack triage draft',
      instructions: 'Triage top-level Slack messages.',
      operationalPath: '.pi/automations/benny',
      trigger: { type: 'slack.top_level', channelId: 'C0123456789' },
      tools: ['slack.thread.read', 'tracker'],
    },
  });
});

test('Cancel disposition leaves no definition to persist', () => {
  const cancelled = reduceAutomationsEditor(initialAutomationsEditorState(draft), 'escape');
  expect(cancelled).toMatchObject({ finished: true, disposition: 'cancelled', stateLabel: 'Inactive' });
  expect(automationsEditorResult(cancelled)).toEqual({ disposition: 'cancelled' });
});

test('editing instructions then Save returns the new instructions', () => {
  let state = initialAutomationsEditorState(draft);
  state = reduceAutomationsEditor(state, 'down'); // instructions
  state = reduceAutomationsEditor(state, 'enter');
  state = reduceAutomationsEditor(state, 'backspace');
  // clear fully then type
  while (state.buffer.length > 0) state = reduceAutomationsEditor(state, 'backspace');
  for (const char of 'Updated instructions.') state = reduceAutomationsEditor(state, { char });
  state = reduceAutomationsEditor(state, 'enter');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'enter');
  expect(automationsEditorResult(state).definition?.instructions).toBe('Updated instructions.');
});

test('invalid trigger JSON on Save keeps the editor open with an error', () => {
  let state = initialAutomationsEditorState(draft);
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down'); // trigger
  state = reduceAutomationsEditor(state, 'enter');
  while (state.buffer.length > 0) state = reduceAutomationsEditor(state, 'backspace');
  for (const char of 'not-json') state = reduceAutomationsEditor(state, { char });
  state = reduceAutomationsEditor(state, 'enter');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'down');
  state = reduceAutomationsEditor(state, 'enter');
  expect(state.finished).toBe(false);
  expect(state.error).toContain('Trigger must be JSON');
});

test('formatTriggerText round-trips slack and webhook shapes', () => {
  expect(formatTriggerText({ type: 'slack.top_level', channelId: 'C1' })).toBe(
    '{"type":"slack.top_level","channelId":"C1"}',
  );
  expect(formatTriggerText({ type: 'webhook', fields: ['x'], port: 8080 })).toBe(
    '{"type":"webhook","fields":["x"],"port":8080}',
  );
});
