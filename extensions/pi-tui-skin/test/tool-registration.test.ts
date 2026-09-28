import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerToolRenderers } from '../src/tools/register-tool-renderers.ts';

const OVERRIDES_ENV = 'PI_TUI_SKIN_TOOL_OVERRIDES';

function registeredToolNames(): string[] {
  const names: string[] = [];
  const fakePi = {
    registerTool: (definition: ToolDefinition) => {
      names.push(definition.name);
    },
  } as unknown as ExtensionAPI;
  registerToolRenderers(fakePi);
  return names;
}

describe('tool renderer registration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('registers only the four default active tools when the override is unset', () => {
    vi.stubEnv(OVERRIDES_ENV, undefined);

    expect(registeredToolNames().sort()).toEqual(['bash', 'edit', 'read', 'write']);
  });

  test('registers every optional renderer named by the override', () => {
    vi.stubEnv(OVERRIDES_ENV, 'grep,find,ls,powershell');

    expect(registeredToolNames().sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'powershell', 'read', 'write']);
  });

  test('filters a padded override string to known tool names', () => {
    vi.stubEnv(OVERRIDES_ENV, ' grep , nope ,');

    expect(registeredToolNames().sort()).toEqual(['bash', 'edit', 'grep', 'read', 'write']);
  });
});
