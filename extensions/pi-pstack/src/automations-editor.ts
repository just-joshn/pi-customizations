// Automations editor chrome: Pi-native reviewed handoff for disabled drafts.
// Pattern mirrors questions-panel.ts (pure reducer + renderer; ctx.ui.custom hosts it).

import { matchesKey } from '@earendil-works/pi-tui';

/** Probe and journey marker for real in-PTY Automations editor chrome (not ctx.ui.editor stub). */
export const AUTOMATIONS_EDITOR_CHROME = 'pi-automations-editor-v1' as const;

export type AutomationsEditorTrigger =
  | { readonly type: 'slack.top_level'; readonly channelId: string }
  | { readonly type: 'webhook'; readonly fields: readonly string[]; readonly port: number };

export interface AutomationsEditorDraft {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly operationalPath?: string;
  readonly trigger: AutomationsEditorTrigger;
  readonly tools: readonly string[];
  readonly revision: string;
}

export type AutomationsEditorInput =
  | 'up'
  | 'down'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'space'
  | { readonly char: string };

export type AutomationsEditorFieldId = 'description' | 'instructions' | 'trigger' | 'tools' | 'save' | 'cancel';

export interface AutomationsEditorState {
  readonly title: string;
  readonly stateLabel: 'Inactive';
  readonly chrome: typeof AUTOMATIONS_EDITOR_CHROME;
  readonly draft: AutomationsEditorDraft;
  readonly fields: {
    readonly description: string;
    readonly instructions: string;
    readonly triggerText: string;
    readonly toolsText: string;
  };
  readonly focus: number;
  readonly editing: boolean;
  readonly buffer: string;
  readonly finished: boolean;
  readonly disposition: 'none' | 'saved' | 'cancelled';
  readonly error: string | undefined;
}

export interface AutomationsEditorResult {
  readonly disposition: 'saved' | 'cancelled';
  readonly definition?: {
    readonly name: string;
    readonly description: string;
    readonly instructions: string;
    readonly operationalPath?: string;
    readonly trigger: AutomationsEditorTrigger;
    readonly tools: readonly string[];
  };
}

const FIELD_IDS: readonly AutomationsEditorFieldId[] = [
  'description',
  'instructions',
  'trigger',
  'tools',
  'save',
  'cancel',
] as const;

export function formatTriggerText(trigger: AutomationsEditorTrigger): string {
  if (trigger.type === 'slack.top_level') {
    return JSON.stringify({ type: 'slack.top_level', channelId: trigger.channelId });
  }
  return JSON.stringify({ type: 'webhook', fields: [...trigger.fields], port: trigger.port });
}

export function formatToolsText(tools: readonly string[]): string {
  return tools.join(', ');
}

export function parseTriggerText(text: string): AutomationsEditorTrigger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Trigger must be JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Trigger must be a JSON object.');
  const record = parsed as Record<string, unknown>;
  if (record['type'] === 'slack.top_level') {
    if (typeof record['channelId'] !== 'string' || !record['channelId'].trim()) {
      throw new Error('slack.top_level trigger needs a channelId.');
    }
    return { type: 'slack.top_level', channelId: record['channelId'].trim() };
  }
  if (record['type'] === 'webhook') {
    if (!Array.isArray(record['fields']) || !record['fields'].every((field) => typeof field === 'string')) {
      throw new Error('webhook trigger needs string fields.');
    }
    if (typeof record['port'] !== 'number' || !Number.isInteger(record['port'])) {
      throw new Error('webhook trigger needs an integer port.');
    }
    return { type: 'webhook', fields: record['fields'], port: record['port'] };
  }
  throw new Error('Trigger type must be slack.top_level or webhook.');
}

export function parseToolsText(text: string): readonly string[] {
  return text
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

export function initialAutomationsEditorState(draft: AutomationsEditorDraft): AutomationsEditorState {
  return {
    title: draft.name,
    stateLabel: 'Inactive',
    chrome: AUTOMATIONS_EDITOR_CHROME,
    draft,
    fields: {
      description: draft.description,
      instructions: draft.instructions,
      triggerText: formatTriggerText(draft.trigger),
      toolsText: formatToolsText(draft.tools),
    },
    focus: 0,
    editing: false,
    buffer: '',
    finished: false,
    disposition: 'none',
    error: undefined,
  };
}

const withState = (state: AutomationsEditorState, patch: Partial<AutomationsEditorState>): AutomationsEditorState => ({
  ...state,
  ...patch,
});

function commitEdit(state: AutomationsEditorState): AutomationsEditorState {
  const id = FIELD_IDS[state.focus];
  if (!id || id === 'save' || id === 'cancel') return withState(state, { editing: false, buffer: '' });
  const value = state.buffer;
  const fields =
    id === 'description'
      ? { ...state.fields, description: value }
      : id === 'instructions'
        ? { ...state.fields, instructions: value }
        : id === 'trigger'
          ? { ...state.fields, triggerText: value }
          : { ...state.fields, toolsText: value };
  return withState(state, { fields, editing: false, buffer: '', error: undefined });
}

function buildDefinition(state: AutomationsEditorState): AutomationsEditorResult['definition'] {
  const trigger = parseTriggerText(state.fields.triggerText);
  const tools = parseToolsText(state.fields.toolsText);
  if (!state.fields.instructions.trim()) throw new Error('Instructions cannot be empty.');
  return {
    name: state.draft.name,
    description: state.fields.description,
    instructions: state.fields.instructions.trim(),
    ...(state.draft.operationalPath !== undefined ? { operationalPath: state.draft.operationalPath } : {}),
    trigger,
    tools,
  };
}

function finishSaved(state: AutomationsEditorState): AutomationsEditorState {
  try {
    buildDefinition(state);
    return withState(state, { finished: true, disposition: 'saved', error: undefined });
  } catch (error) {
    return withState(state, {
      error: error instanceof Error ? error.message : 'Invalid draft fields.',
      editing: false,
      buffer: '',
    });
  }
}

export function reduceAutomationsEditor(state: AutomationsEditorState, input: AutomationsEditorInput): AutomationsEditorState {
  if (state.finished) return state;
  if (state.editing) {
    if (input === 'escape') return withState(state, { editing: false, buffer: '', error: undefined });
    if (input === 'enter') return commitEdit(state);
    if (input === 'backspace') return withState(state, { buffer: [...state.buffer].slice(0, -1).join('') });
    if (input === 'space') return withState(state, { buffer: `${state.buffer} ` });
    if (typeof input === 'object' && 'char' in input) return withState(state, { buffer: state.buffer + input.char });
    return state;
  }
  switch (input) {
    case 'up':
      return withState(state, { focus: Math.max(0, state.focus - 1), error: undefined });
    case 'down':
      return withState(state, { focus: Math.min(FIELD_IDS.length - 1, state.focus + 1), error: undefined });
    case 'escape':
      return withState(state, { finished: true, disposition: 'cancelled', error: undefined });
    case 'enter': {
      const id = FIELD_IDS[state.focus];
      if (id === 'save') return finishSaved(state);
      if (id === 'cancel') return withState(state, { finished: true, disposition: 'cancelled', error: undefined });
      if (id === 'description' || id === 'instructions' || id === 'trigger' || id === 'tools') {
        const buffer =
          id === 'description'
            ? state.fields.description
            : id === 'instructions'
              ? state.fields.instructions
              : id === 'trigger'
                ? state.fields.triggerText
                : state.fields.toolsText;
        return withState(state, { editing: true, buffer, error: undefined });
      }
      return state;
    }
    default:
      return state;
  }
}

export function automationsEditorResult(state: AutomationsEditorState): AutomationsEditorResult {
  if (state.disposition === 'saved') {
    const definition = buildDefinition(state);
    if (!definition) throw new Error('Saved editor state is missing a definition.');
    return { disposition: 'saved', definition };
  }
  return { disposition: 'cancelled' };
}

const padInner = (text: string, innerWidth: number): string => `${text}${' '.repeat(Math.max(0, innerWidth - text.length))}`;
const row = (text: string, innerWidth: number): string => ` │ ${padInner(text, innerWidth)} │`;
const wrapParagraph = (text: string, width: number): string[] => {
  const words = text.split(' ').filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};
const wrap = (text: string, width: number): string[] =>
  text.split(/\r?\n/).flatMap((paragraph) => (paragraph.length === 0 ? [''] : wrapParagraph(paragraph, width)));

function fieldValue(state: AutomationsEditorState, id: AutomationsEditorFieldId): string {
  if (state.editing && FIELD_IDS[state.focus] === id) return `${state.buffer}▏`;
  if (id === 'description') return state.fields.description || '(empty)';
  if (id === 'instructions') return state.fields.instructions || '(empty)';
  if (id === 'trigger') return state.fields.triggerText;
  if (id === 'tools') return state.fields.toolsText || '(none)';
  if (id === 'save') return 'Save (keeps Inactive / disabled)';
  return 'Cancel';
}

function fieldLabel(id: AutomationsEditorFieldId): string {
  if (id === 'description') return 'Description';
  if (id === 'instructions') return 'Instructions';
  if (id === 'trigger') return 'Trigger';
  if (id === 'tools') return 'Tools';
  if (id === 'save') return 'Action';
  return 'Action';
}

export function renderAutomationsEditor(state: AutomationsEditorState, width: number): string[] {
  const boxWidth = Math.max(40, width - 2);
  const innerWidth = boxWidth - 4;
  const lines: string[] = [];
  lines.push(` ┌${'─'.repeat(boxWidth - 2)}┐`);
  lines.push(row(state.title, innerWidth));
  lines.push(row(`State: ${state.stateLabel}`, innerWidth));
  lines.push(row('', innerWidth));
  FIELD_IDS.forEach((id, index) => {
    const focused = index === state.focus;
    const marker = focused ? '›' : ' ';
    const label = fieldLabel(id);
    const value = fieldValue(state, id);
    const prefix = `${marker} ${label}: `;
    const bodyWidth = Math.max(8, innerWidth - prefix.length);
    const wrapped = wrap(value, bodyWidth);
    wrapped.forEach((line, lineIndex) => {
      const content = lineIndex === 0 ? `${prefix}${line}` : `${' '.repeat(prefix.length)}${line}`;
      lines.push(row(content, innerWidth));
    });
  });
  if (state.error) {
    lines.push(row('', innerWidth));
    for (const line of wrap(`Error: ${state.error}`, innerWidth)) lines.push(row(line, innerWidth));
  }
  lines.push(row('', innerWidth));
  lines.push(row('↑/↓ field · Enter edit/save · Esc cancel', innerWidth));
  lines.push(row(`chrome:${state.chrome}`, innerWidth));
  lines.push(` └${'─'.repeat(boxWidth - 2)}┘`);
  return lines;
}

export function toAutomationsEditorInput(data: string): AutomationsEditorInput | undefined {
  if (matchesKey(data, 'up')) return 'up';
  if (matchesKey(data, 'down')) return 'down';
  if (matchesKey(data, 'escape')) return 'escape';
  if (matchesKey(data, 'enter')) return 'enter';
  if (matchesKey(data, 'backspace')) return 'backspace';
  if (data === ' ') return 'space';
  if (data.length === 1 && data.charCodeAt(0) >= 32) return { char: data };
  return undefined;
}
