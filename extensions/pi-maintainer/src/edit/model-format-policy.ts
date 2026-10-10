import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PromptPolicy } from '../core/prompts.ts';
import { type EditFormatName, isEditFormatName } from '../feature.ts';

/** Format, editor format, example placement, and reminder from Aider model settings. */
export interface ModelFormatPolicy {
  readonly editFormat: EditFormatName;
  readonly editorEditFormat: EditFormatName | null;
  readonly examplesAsSystemMessage: boolean;
  readonly reminder: 'sys' | 'user';
}

export interface PackagedFormatSettings {
  readonly name: string;
  readonly edit_format?: string;
  readonly editor_edit_format?: string;
  readonly examples_as_sys_msg?: boolean;
  readonly reminder?: string;
}

const defaultPolicy: ModelFormatPolicy = {
  editFormat: 'whole',
  editorEditFormat: null,
  examplesAsSystemMessage: false,
  reminder: 'user',
};

const settingsPath = join(dirname(fileURLToPath(import.meta.url)), 'model-format-settings.json');
const packagedSettings: readonly PackagedFormatSettings[] = JSON.parse(readFileSync(settingsPath, 'utf8')) as PackagedFormatSettings[];

function asEditFormat(value: string | undefined): EditFormatName | null {
  return value !== undefined && isEditFormatName(value) ? value : null;
}

function asReminder(value: string | undefined): 'sys' | 'user' | null {
  if (value === 'sys' || value === 'user') return value;
  return null;
}

function fromPackaged(entry: PackagedFormatSettings): ModelFormatPolicy {
  return {
    editFormat: asEditFormat(entry.edit_format) ?? defaultPolicy.editFormat,
    editorEditFormat: asEditFormat(entry.editor_edit_format),
    examplesAsSystemMessage: entry.examples_as_sys_msg ?? defaultPolicy.examplesAsSystemMessage,
    reminder: asReminder(entry.reminder) ?? defaultPolicy.reminder,
  };
}

/** Aider `apply_generic_model_settings` fields that affect edit format policy. */
function applyGenericHeuristics(model: string, base: ModelFormatPolicy): ModelFormatPolicy {
  const set = (patch: Partial<ModelFormatPolicy>): ModelFormatPolicy => ({ ...base, ...patch });

  if (model.includes('/o3-mini')) return set({ editFormat: 'diff' });
  if (model.includes('gpt-4.1-mini')) return set({ editFormat: 'diff', reminder: 'sys', examplesAsSystemMessage: false });
  if (model.includes('gpt-4.1')) return set({ editFormat: 'diff', reminder: 'sys', examplesAsSystemMessage: false });

  const lastSegment = model.split('/').at(-1) ?? model;
  if (lastSegment === 'gpt-5' || lastSegment === 'gpt-5-2025-08-07') return set({ editFormat: 'diff' });

  if (model.includes('/o1-mini')) return base;
  if (model.includes('/o1-preview')) return set({ editFormat: 'diff' });
  if (model.includes('/o1')) return set({ editFormat: 'diff' });

  if (model.includes('deepseek') && model.includes('v3')) {
    return set({ editFormat: 'diff', reminder: 'sys', examplesAsSystemMessage: true });
  }
  if (model.includes('deepseek') && (model.includes('r1') || model.includes('reasoning'))) {
    return set({ editFormat: 'diff', examplesAsSystemMessage: true });
  }
  if ((model.includes('llama3') || model.includes('llama-3')) && model.includes('70b')) {
    return set({ editFormat: 'diff', examplesAsSystemMessage: true });
  }
  if (model.includes('gpt-4-turbo') || (model.includes('gpt-4-') && model.includes('-preview'))) {
    return set({ editFormat: 'udiff' });
  }
  if (model.includes('gpt-4') || model.includes('claude-3-opus')) return set({ editFormat: 'diff' });
  if (model.includes('gpt-3.5') || model.includes('gpt-4')) return set({ reminder: 'sys' });

  if (model.includes('sonnet-4-') || model.includes('opus-4-') || model.includes('haiku-4-')) {
    return set({ editFormat: 'diff', examplesAsSystemMessage: false });
  }
  if (model.includes('3-7-sonnet')) return set({ editFormat: 'diff', examplesAsSystemMessage: true, reminder: 'user' });
  if (model.includes('3.5-sonnet') || model.includes('3-5-sonnet')) {
    return set({ editFormat: 'diff', examplesAsSystemMessage: true, reminder: 'user' });
  }
  if (model.startsWith('o1-') || model.includes('/o1-')) return base;

  if (model.includes('qwen') && model.includes('coder') && (model.includes('2.5') || model.includes('2-5')) && model.includes('32b')) {
    return set({ editFormat: 'diff', editorEditFormat: 'editor-diff' });
  }
  if (model.includes('qwq') && model.includes('32b') && !model.includes('preview')) {
    return set({ editFormat: 'diff', editorEditFormat: 'editor-diff', examplesAsSystemMessage: true });
  }
  if (model.includes('qwen3') && model.includes('235b')) return set({ editFormat: 'diff' });

  return base;
}

/**
 * Resolve Aider's model edit-format policy for a model id.
 * Exact packaged settings win; otherwise name heuristics; otherwise whole-file defaults.
 */
export function resolveModelFormatPolicy(modelName: string, packaged: readonly PackagedFormatSettings[] = packagedSettings): ModelFormatPolicy {
  const exact = packaged.find((entry) => entry.name === modelName);
  if (exact) return fromPackaged(exact);
  return applyGenericHeuristics(modelName.toLowerCase(), defaultPolicy);
}

/** Prefer exact packaged `provider/id` or bare `id`, else heuristics on the qualified name. */
export function resolveModelFormatPolicyForRef(model: { readonly provider: string; readonly id: string }, packaged: readonly PackagedFormatSettings[] = packagedSettings): ModelFormatPolicy {
  const qualified = `${model.provider}/${model.id}`;
  if (packaged.some((entry) => entry.name === qualified)) return resolveModelFormatPolicy(qualified, packaged);
  if (packaged.some((entry) => entry.name === model.id)) return resolveModelFormatPolicy(model.id, packaged);
  return resolveModelFormatPolicy(qualified, packaged);
}

/** PromptPolicy fields driven by the model format policy. */
export function promptPolicyFromModelFormat(policy: ModelFormatPolicy): PromptPolicy {
  return {
    useSystemPrompt: true,
    examplesAsSystemMessage: policy.examplesAsSystemMessage,
    systemPromptPrefix: '',
    reminder: policy.reminder,
  };
}
