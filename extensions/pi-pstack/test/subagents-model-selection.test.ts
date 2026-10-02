import { expect, test } from 'vitest';
import { chooseChildModel } from '../src/subagents/models.ts';

const available = ['claude-sonnet-4', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-haiku-4', 'gpt-x'];
const pick = (input: Partial<Parameters<typeof chooseChildModel>[0]>) => chooseChildModel({ fork: false, env: {}, available, ...input });

test('an inherit cap steps a higher-ranked parent down to the newest capped family member', () => {
  expect(pick({ inheritCap: 'sonnet', parent: 'claude-opus-5' })).toEqual({ request: 'claude-sonnet-5-5' });
  expect(pick({ inheritCap: 'haiku', parent: 'claude-sonnet-5-5' })).toEqual({ request: 'claude-haiku-4' });
});

test.for([
  { title: 'a parent at the cap', input: { inheritCap: 'sonnet', parent: 'claude-sonnet-4' } },
  { title: 'a parent below the cap', input: { inheritCap: 'opus', parent: 'claude-haiku-4' } },
  { title: 'no parent', input: { inheritCap: 'sonnet' } },
  { title: 'a parent outside the known families', input: { inheritCap: 'sonnet', parent: 'gpt-x' } },
  { title: 'an unknown cap family', input: { inheritCap: 'mystery', parent: 'claude-opus-5' } },
])('an inherit cap leaves the parent model alone for $title', ({ input }) => {
  expect(pick(input)).toEqual({ request: undefined });
});

test('an explicit tool model bypasses the inherit cap', () => {
  expect(pick({ inheritCap: 'haiku', parent: 'claude-opus-5', toolModel: 'opus' })).toEqual({ request: 'claude-opus-5', steppedFrom: 'opus' });
});

test('the PI_ force variable forces the configured environment model over tool and definition models', () => {
  const env = { PI_SUBAGENT_MODEL_FORCE: ' yes ', PI_SUBAGENT_MODEL: 'gpt-x' };
  expect(pick({ toolModel: 'opus', definitionModel: 'sonnet', env })).toEqual({ request: 'gpt-x', ignoredOverride: 'opus' });
  expect(pick({ definitionModel: 'haiku', env })).toEqual({ request: 'gpt-x', ignoredOverride: 'haiku' });
  expect(pick({ definitionModel: 'inherit', env })).toEqual({ request: 'gpt-x' });
  expect(pick({ env })).toEqual({ request: 'gpt-x' });
});

test('a blank force variable does not force anything', () => {
  expect(pick({ toolModel: 'opus', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '  ', CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-x' } })).toEqual({ request: 'claude-opus-5', steppedFrom: 'opus' });
});

test('forcing without a configured model applies the inherit cap', () => {
  expect(pick({ inheritCap: 'sonnet', parent: 'claude-opus-5', env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } })).toEqual({ request: 'claude-sonnet-5-5' });
  expect(pick({ env: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } })).toEqual({ request: undefined });
});

test('coordinator mode with forced worker inheritance discards the tool model', () => {
  const env = { CLAUDE_CODE_COORDINATOR_MODE: 'true', CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL: '1' };
  expect(pick({ toolModel: 'opus', definitionModel: 'sonnet', env })).toEqual({ request: 'claude-sonnet-5-5', steppedFrom: 'sonnet' });
  expect(pick({ toolModel: 'opus', env: { CLAUDE_CODE_COORDINATOR_MODE: 'true' } })).toEqual({ request: 'claude-opus-5', steppedFrom: 'opus' });
});

test('provider-qualified requests step to a member on the parent provider', () => {
  const models = ['anthropic/claude-opus-5', 'bedrock/claude-opus-6', 'anthropic/claude-opus-5-1'];
  expect(pick({ toolModel: 'opus', available: models, parent: 'anthropic/claude-sonnet-5' })).toEqual({ request: 'anthropic/claude-opus-5-1', steppedFrom: 'opus' });
  expect(pick({ toolModel: 'opus', available: models, parent: 'vertex/claude-sonnet-5' })).toEqual({ request: 'bedrock/claude-opus-6', steppedFrom: 'opus' });
});

test('decorated model ids prefer the parent prefix and opus follows the parent long-context variant', () => {
  const decorated = ['us.claude-opus-5', 'claude-opus-6'];
  expect(pick({ toolModel: 'opus', available: decorated, parent: 'us.claude-sonnet-5' })).toEqual({ request: 'us.claude-opus-5', steppedFrom: 'opus' });
  const context = ['claude-opus-5', 'claude-opus-5[1m]'];
  expect(pick({ toolModel: 'opus', available: context, parent: 'claude-opus-5[1m]' })).toEqual({ request: 'claude-opus-5[1m]', steppedFrom: 'opus' });
  expect(pick({ toolModel: 'opus', available: context, parent: 'claude-opus-5' })).toEqual({ request: 'claude-opus-5', steppedFrom: 'opus' });
});

test('family detection accepts provider-qualified Claude ids and family names in any case', () => {
  expect(pick({ toolModel: 'Anthropic/claude-haiku-9' })).toEqual({ request: 'claude-haiku-4', steppedFrom: 'Anthropic/claude-haiku-9' });
  expect(pick({ toolModel: 'SONNET' })).toEqual({ request: 'claude-sonnet-5-5', steppedFrom: 'SONNET' });
});

test('numeric ordering picks claude-sonnet-10 over claude-sonnet-9', () => {
  expect(pick({ toolModel: 'sonnet', available: ['claude-sonnet-9', 'claude-sonnet-10'] })).toEqual({ request: 'claude-sonnet-10', steppedFrom: 'sonnet' });
});
