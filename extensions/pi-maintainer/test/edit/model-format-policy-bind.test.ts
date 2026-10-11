import { expect, test } from 'vitest';
import { selectEditFormat } from '../../src/edit/factory.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { promptPolicyFromModelFormat, resolveModelFormatPolicy } from '../../src/edit/model-format-policy.ts';
import { defaultEditorFormat } from '../../src/edit/modes.ts';
import type { ResolvedSettings } from '../../src/settings/spec.ts';

const configureMeta = { meta: { aider: ['test_models/TestModels.test_configure_model_settings'] } };
const preservesMeta = { meta: { aider: ['test_commands/TestCommands.test_cmd_model_preserves_explicit_edit_format'] } };
const updatesMeta = { meta: { aider: ['test_commands/TestCommands.test_cmd_model_updates_default_edit_format'] } };

function formats() {
  const settings: ResolvedSettings = {
    value: (option) => option.defaultValue,
    source: () => 'default',
  };
  return editFeature.create({
    settings,
    host: { output() {}, warning() {}, error() {}, confirm: async () => true, select: async () => undefined, exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }) },
    cwd: '/tmp',
  }).formats;
}

test('unrecognized model names default to whole-file editing', configureMeta, () => {
  expect(resolveModelFormatPolicy('totally-unknown-model-xyz')).toEqual({
    editFormat: 'whole',
    editorEditFormat: null,
    examplesAsSystemMessage: false,
    reminder: 'user',
  });
});

test('packaged gpt-3.5-turbo keeps whole format and sys reminder', configureMeta, () => {
  expect(resolveModelFormatPolicy('gpt-3.5-turbo')).toEqual({
    editFormat: 'whole',
    editorEditFormat: null,
    examplesAsSystemMessage: false,
    reminder: 'sys',
  });
});

test('packaged gpt-4o selects diff, editor-diff, examples, and sys reminder', configureMeta, () => {
  expect(resolveModelFormatPolicy('gpt-4o')).toEqual({
    editFormat: 'diff',
    editorEditFormat: 'editor-diff',
    examplesAsSystemMessage: true,
    reminder: 'sys',
  });
});

test('generic name heuristics select documented format fields', configureMeta, () => {
  expect(resolveModelFormatPolicy('something/o3-mini').editFormat).toBe('diff');
  expect(resolveModelFormatPolicy('deepseek-v3')).toMatchObject({
    editFormat: 'diff',
    reminder: 'sys',
    examplesAsSystemMessage: true,
  });
  expect(resolveModelFormatPolicy('deepseek-r1')).toMatchObject({
    editFormat: 'diff',
    examplesAsSystemMessage: true,
  });
  expect(resolveModelFormatPolicy('llama3-70b')).toMatchObject({
    editFormat: 'diff',
    examplesAsSystemMessage: true,
  });
  expect(resolveModelFormatPolicy('gpt-4').editFormat).toBe('diff');
  expect(resolveModelFormatPolicy('gpt-3.5').reminder).toBe('sys');
  expect(resolveModelFormatPolicy('claude-3.5-sonnet')).toMatchObject({
    editFormat: 'diff',
    examplesAsSystemMessage: true,
    reminder: 'user',
  });
  expect(resolveModelFormatPolicy('qwen-coder-2.5-32b')).toMatchObject({
    editFormat: 'diff',
    editorEditFormat: 'editor-diff',
  });
});

test('selectEditFormat uses the model policy as modelDefault when request is unset', updatesMeta, () => {
  const registry = formats();
  const policy = resolveModelFormatPolicy('gpt-4');
  expect(selectEditFormat(registry, null, { modelDefault: policy.editFormat }).name).toBe('diff');
  expect(selectEditFormat(registry, null, { modelDefault: resolveModelFormatPolicy('unknown-x').editFormat }).name).toBe('whole');
});

test('explicit edit format outranks the model default', preservesMeta, () => {
  const registry = formats();
  const policy = resolveModelFormatPolicy('gpt-4');
  expect(selectEditFormat(registry, 'udiff', { modelDefault: policy.editFormat }).name).toBe('udiff');
});

test('prompt and editor policy map from the resolved model format', configureMeta, () => {
  const packaged = resolveModelFormatPolicy('gpt-4o');
  expect(promptPolicyFromModelFormat(packaged)).toEqual({
    useSystemPrompt: true,
    examplesAsSystemMessage: true,
    systemPromptPrefix: '',
    reminder: 'sys',
  });
  expect(defaultEditorFormat(packaged.editorEditFormat)).toBe('editor-diff');
  const unknown = resolveModelFormatPolicy('unknown-y');
  expect(promptPolicyFromModelFormat(unknown).reminder).toBe('user');
  expect(defaultEditorFormat(unknown.editorEditFormat)).toBe('editor-diff');
});
