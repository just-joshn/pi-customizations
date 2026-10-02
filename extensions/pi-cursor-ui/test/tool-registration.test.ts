import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Theme } from '@earendil-works/pi-coding-agent';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerToolRenderers } from '../src/tools/register-tool-renderers.ts';

const OVERRIDES_ENV = 'PI_CURSOR_UI_TOOL_OVERRIDES';

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

function registeredDefinitions(): Map<string, ToolDefinition> {
  const definitions = new Map<string, ToolDefinition>();
  const fakePi = {
    registerTool: (definition: ToolDefinition) => {
      definitions.set(definition.name, definition);
    },
  } as unknown as ExtensionAPI;
  registerToolRenderers(fakePi);
  return definitions;
}

/** Every registered definition renders its own row, so a copy-paste mix-up cannot hide. */
const EXPECTED_CALL_ROWS: Record<string, string> = {
  read: '◇ Read README.md',
  bash: '◇ Bash echo hi',
  powershell: '◇ PowerShell Get-ChildItem',
  edit: '◇ Edit note.txt',
  write: '◇ Write note.txt (1 line)',
  grep: '◇ Search "CURSOR_UI"',
  find: '◇ Find "*.ts"',
  ls: '◇ List src',
};

const CALL_ARGS: Record<string, unknown> = {
  read: { path: 'README.md' },
  bash: { command: 'echo hi' },
  powershell: { command: 'Get-ChildItem' },
  edit: { path: 'note.txt' },
  write: { path: 'note.txt', content: 'one line\n' },
  grep: { pattern: 'CURSOR_UI' },
  find: { pattern: '*.ts' },
  ls: { path: 'src' },
};

/** The package's own theme, with `vars` resolved the way pi's loader resolves them. */
function makeTheme(): Theme {
  const document: { vars: Record<string, string | number>; colors: Record<string, string | number> } = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/cursor-ui.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  const colors = Object.fromEntries(Object.entries(document.colors).map(([role, value]) => [role, resolve(value)]));
  return new Theme(colors as never, colors as never, 'truecolor', { name: 'cursor-ui' });
}

function restoreEnvironment(): void {
  vi.unstubAllEnvs();
}

describe('tool renderer registration', () => {
  afterEach(restoreEnvironment);

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

describe('tool renderer registration rows', () => {
  afterEach(restoreEnvironment);

  test('every registered definition renders its own call row', () => {
    vi.stubEnv(OVERRIDES_ENV, 'grep,find,ls,powershell');
    const definitions = registeredDefinitions();
    const theme = makeTheme();
    const context = { executionStarted: true, isPartial: false, isError: false };

    const actual: Record<string, string> = {};
    for (const [name, definition] of definitions) {
      if (!definition.renderCall) throw new Error(`${name} has no renderCall`);
      const lines = definition.renderCall(CALL_ARGS[name], theme, context as never).render(80);
      actual[name] = stripTerminalSequences(lines[0] ?? '').trimEnd();
    }

    expect(actual).toEqual(EXPECTED_CALL_ROWS);
  });

  test('every registered definition renders a result row the same way', () => {
    vi.stubEnv(OVERRIDES_ENV, 'grep,find,ls,powershell');
    const definitions = registeredDefinitions();
    const theme = makeTheme();
    const context = { executionStarted: true, isPartial: false, isError: false };
    const result = { content: [{ type: 'text', text: 'row body' }], details: undefined };

    const actual: Record<string, string[]> = {};
    for (const [name, definition] of definitions) {
      if (!definition.renderResult) throw new Error(`${name} has no renderResult`);
      const lines = definition.renderResult(result as never, { expanded: true, isPartial: false }, theme, context as never).render(80);
      actual[name] = lines.map((line) => stripTerminalSequences(line).trimEnd());
    }

    expect(actual).toEqual({
      read: ['row body'],
      bash: ['row body'],
      powershell: ['row body'],
      edit: ['row body'],
      write: ['row body'],
      grep: ['row body'],
      find: ['row body'],
      ls: ['row body'],
    });
  });
});
