import { describe, expect, test } from 'vitest';
import { type AvailableModel, resolveSubagentModel } from '../src/task/models.ts';

const FULL = ['low', 'medium', 'high', 'xhigh', 'max'];
const available: AvailableModel[] = [
  { provider: 'claude-subscription', id: 'claude-opus-5-5', reasoning: true, levels: FULL },
  { provider: 'claude-subscription', id: 'claude-haiku-4-5', reasoning: true, levels: FULL },
  { provider: 'grok-build', id: 'grok-4.7', reasoning: true, levels: ['low', 'medium', 'high', 'xhigh'] },
  { provider: 'deepseek', id: 'deepseek-flash', reasoning: true, levels: ['off', 'low', 'high', 'max'] },
  { provider: 'other', id: 'deepseek-flash', reasoning: false, levels: ['off'] },
];
const parent = { provider: 'claude-subscription', id: 'claude-haiku-4-5', thinking: 'low' as const };

describe('resolveSubagentModel (TASK-007)', () => {
  test.for([undefined, '', 'inherit', 'inherit-parent', 'auto', 'default'])('%s runs on the parent model and thinking level', (value) => {
    expect(resolveSubagentModel(value, available, parent)).toEqual({ provider: 'claude-subscription', id: 'claude-haiku-4-5', thinking: 'low' });
  });

  test('inherit with no parent model leaves the choice to the child', () => {
    expect([resolveSubagentModel('inherit', available, undefined), resolveSubagentModel('inherit', available, parent)]).toEqual([undefined, parent]);
  });

  test.for([
    { value: 'claude-opus-5-5-xhigh', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'xhigh' } },
    { value: 'claude-opus-5-5-max-fast', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'max' } },
    { value: 'grok-4.7-xhigh-fast', expected: { provider: 'grok-build', id: 'grok-4.7', thinking: 'xhigh' } },
    { value: 'claude-opus-5-5-thinking-high', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'high' } },
    { value: 'claude-opus-5-5', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5' } },
  ])('maps the Cursor slug $value (TASK-007, RULE-003)', ({ value, expected }) => {
    expect(resolveSubagentModel(value, available, parent)).toEqual(expected);
  });

  test('maps Cursor slugs with none, minimal, or a bare -fast suffix (Cursor CLI 2026.10.22 model list)', () => {
    const local = [...available, { provider: 'openai', id: 'gpt-5.3-codex', reasoning: true, levels: ['minimal', 'low', 'high'] }];
    expect([
      resolveSubagentModel('grok-4.7-fast', local, parent),
      resolveSubagentModel('deepseek/deepseek-flash-none', local, parent),
      resolveSubagentModel('gpt-5.3-codex-minimal', local, parent),
      resolveSubagentModel('gpt-5.3-codex-minimal-fast', local, parent),
    ]).toEqual([
      { provider: 'grok-build', id: 'grok-4.7' },
      { provider: 'deepseek', id: 'deepseek-flash', thinking: 'off' },
      { provider: 'openai', id: 'gpt-5.3-codex', thinking: 'minimal' },
      { provider: 'openai', id: 'gpt-5.3-codex', thinking: 'minimal' },
    ]);
  });

  test.for([
    { value: 'deepseek/deepseek-flash', expected: { provider: 'deepseek', id: 'deepseek-flash' } },
    { value: 'deepseek/deepseek-flash:high', expected: { provider: 'deepseek', id: 'deepseek-flash', thinking: 'high' } },
    { value: 'claude-opus-5-5:medium', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'medium' } },
  ])('maps the Pi spec $value', ({ value, expected }) => {
    expect(resolveSubagentModel(value, available, parent)).toEqual(expected);
  });

  test('selects model ids that contain a colon, with or without a thinking level (review: security 5)', () => {
    const local = [...available, { provider: 'ollama', id: 'llama3:8b', reasoning: true, levels: ['off', 'high'] }];
    expect([resolveSubagentModel('ollama/llama3:8b', local, parent), resolveSubagentModel('llama3:8b', local, parent), resolveSubagentModel('llama3:8b:high', local, parent)]).toEqual([
      { provider: 'ollama', id: 'llama3:8b' },
      { provider: 'ollama', id: 'llama3:8b' },
      { provider: 'ollama', id: 'llama3:8b', thinking: 'high' },
    ]);
  });

  test('prefers a model whose own id ends in -fast for a -fast slug (review: parity)', () => {
    const fast = [...available, { provider: 'grok-build', id: 'grok-4.7-fast', reasoning: true, levels: ['low', 'xhigh'] }];
    expect(resolveSubagentModel('grok-4.7-xhigh-fast', fast, parent)).toEqual({ provider: 'grok-build', id: 'grok-4.7-fast', thinking: 'xhigh' });
  });

  test.for([
    { value: 'claude-opus-5-5[effort=high]', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'high' } },
    { value: 'claude-opus-5-5[]', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5' } },
    { value: 'claude-opus-5-5[effort=high,context=300k]', expected: { provider: 'claude-subscription', id: 'claude-opus-5-5', thinking: 'high' } },
    { value: 'grok-4.7[fast=false]', expected: { provider: 'grok-build', id: 'grok-4.7' } },
    { value: 'grok-4.7[fast=true, effort=low]', expected: { provider: 'grok-build', id: 'grok-4.7', thinking: 'low' } },
    { value: 'deepseek/deepseek-flash[effort=max]', expected: { provider: 'deepseek', id: 'deepseek-flash', thinking: 'max' } },
  ])('maps the Cursor model parameters in $value', ({ value, expected }) => {
    expect(resolveSubagentModel(value, available, parent)).toEqual(expected);
  });

  test('fast=true picks a model whose own id ends in -fast, and fast=false keeps the standard one', () => {
    const fast = [...available, { provider: 'grok-build', id: 'grok-4.7-fast', reasoning: true, levels: ['low', 'xhigh'] }];
    expect([resolveSubagentModel('grok-4.7[fast=true,effort=xhigh]', fast, parent), resolveSubagentModel('grok-4.7[fast=false]', fast, parent)]).toEqual([
      { provider: 'grok-build', id: 'grok-4.7-fast', thinking: 'xhigh' },
      { provider: 'grok-build', id: 'grok-4.7' },
    ]);
  });

  test.for(['claude-opus-5-5[speed=1]', 'claude-opus-5-5[effort=turbo]', 'claude-opus-5-5[fast=maybe]', 'claude-opus-5-5[effort]', 'claude-opus-5-5-high[effort=low]'])('rejects the model parameters in %s with the allowed list', (value) => {
    expect(() => resolveSubagentModel(value, available, parent)).toThrow(`Invalid model selection "${value}".`);
  });

  test('rejects an effort parameter the model does not support', () => {
    expect(() => resolveSubagentModel('grok-4.7[effort=max]', available, parent)).toThrow('grok-build/grok-4.7 does not support thinking level max; it supports low, medium, high, xhigh.');
  });

  test('rejects an id that two providers share, naming both', () => {
    expect(() => resolveSubagentModel('deepseek-flash', available, parent)).toThrow('Model "deepseek-flash" matches more than one provider: deepseek/deepseek-flash, other/deepseek-flash. Use <provider>/<model-id>.');
  });

  test('rejects an unknown model with the allowed list in Cursor format', () => {
    expect(() => resolveSubagentModel('no-such-model-xyz', available, parent)).toThrow(
      [
        'Invalid model selection "no-such-model-xyz". Model could not be resolved to a valid subagent model.',
        'Allowed model slugs:',
        '- inherit',
        '- claude-subscription/claude-opus-5-5 (thinking: low, medium, high, xhigh, max)',
        '- claude-subscription/claude-haiku-4-5 (thinking: low, medium, high, xhigh, max)',
        '- grok-build/grok-4.7 (thinking: low, medium, high, xhigh)',
        '- deepseek/deepseek-flash (thinking: off, low, high, max)',
        '- other/deepseek-flash',
        '',
        'Cursor-style slugs such as claude-opus-5-5-xhigh resolve to these models with a thinking level.',
        'The `model` parameter is optional. If omitted, the subagent uses the same model as the parent agent.',
      ].join('\n'),
    );
  });

  test.for([
    { value: 'grok-4.7-max-fast', reason: 'grok-build/grok-4.7 does not support thinking level max; it supports low, medium, high, xhigh.' },
    { value: 'deepseek/deepseek-flash:xhigh', reason: 'deepseek/deepseek-flash does not support thinking level xhigh; it supports off, low, high, max.' },
    { value: 'other/deepseek-flash:high', reason: 'other/deepseek-flash does not support thinking level high; it supports off.' },
  ])('rejects $value, a thinking level the model does not support, as Cursor rejects an unlisted slug (review r2: parity 3)', ({ value, reason }) => {
    expect(() => resolveSubagentModel(value, available, parent)).toThrow(`Invalid model selection "${value}". ${reason}\nAllowed model slugs:`);
  });

  test('rejects an unknown effort suffix rather than guessing', () => {
    expect(() => resolveSubagentModel('claude-opus-5-5-turbo', available, parent)).toThrow('Invalid model selection "claude-opus-5-5-turbo".');
  });
});
