import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { diffFormat } from '../../src/edit/feature.ts';
import { editOptions } from '../../src/edit/options.ts';
import { editBlockPrompts } from '../../src/edit/prompts/editblock.ts';
import { type ChatChunksInput, fmtSystemPrompt } from '../../src/edit/prompts/format.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation, type Validation } from '../../src/feature.ts';
import { loadSettings } from '../../src/settings/load.ts';

const BASH_REPLY = `Here's a shell command to run:

\`\`\`bash
echo "Hello, World!"
\`\`\`

This command will print 'Hello, World!' to the console.`;

const DUP_BASH_REPLY = `${BASH_REPLY}

And again:

\`\`\`bash
echo "Hello, World!"
\`\`\`
`;

const SEARCH_SHELL_REPLY = `\`\`\`bash
script.sh
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
\`\`\`
`;

function snapshot(root: string, editable: string[] = []): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'diff',
    phase: { kind: 'main' },
    files: { editable, readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
  };
}

async function harness(options: { readonly suggestShellCommands?: boolean; readonly lint?: Partial<Validation>; readonly editable?: string[] } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shell-bind-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const shellCalls: string[][] = [];
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const tree = createWorkingTree({ notices: host });
  const lint: Validation = {
    ...disabledValidation,
    ...options.lint,
    runSuggestedShell: async (commands, signal) => {
      shellCalls.push([...commands]);
      return options.lint?.runSuggestedShell?.(commands, signal) ?? { kind: 'disabled' };
    },
  };
  const editable = (options.editable ?? []).map((path) => absRootPath(root, path));
  for (const path of editable) await writeFile(path, 'before\n');
  const controller = new ExchangeController(snapshot(root, editable), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: false,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-diff',
        tree,
      },
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint,
    },
    host,
    source: {
      get: async () => ({
        mainSystem: 'MAIN',
        systemReminder: 'REMINDER',
        exampleMessages: [] as const,
        filesContentPrefix: 'EDITABLE',
        filesContentAssistantReply: 'Ok.',
        filesNoFullFiles: 'NONE',
        filesNoFullFilesWithRepoMap: '',
        filesNoFullFilesWithRepoMapReply: '',
        readOnlyFilesPrefix: 'READ ONLY',
        filesContentGptEditsNoRepo: 'I updated the files.',
      }),
    },
    append: () => {},
    suggestShellCommands: options.suggestShellCommands ?? true,
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'run', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { root, controller, shellCalls, tree };
}

test(
  'suggest-shell-commands defaults to true and --no-suggest-shell-commands disables it',
  {
    meta: {
      aider: [
        'test_main/TestMain.test_suggest_shell_commands_default',
        'test_main/TestMain.test_suggest_shell_commands_disabled',
        'test_main/TestMain.test_suggest_shell_commands_enabled',
      ],
    },
  },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'shell-opt-')));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const home = join(root, 'home');
    const cwd = join(root, 'cwd');
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const defaults = await loadSettings({ specs: [editOptions.suggestShellCommands], getFlag: () => undefined, processEnvironment: {}, cwd, home });
    expect(defaults.settings.value(editOptions.suggestShellCommands)).toBe(true);
    const disabled = await loadSettings({
      specs: [editOptions.suggestShellCommands],
      getFlag: (name) => (name === 'no-suggest-shell-commands' ? true : undefined),
      processEnvironment: {},
      cwd,
      home,
    });
    expect(disabled.settings.value(editOptions.suggestShellCommands)).toBe(false);
    const enabled = await loadSettings({
      specs: [editOptions.suggestShellCommands],
      getFlag: (name) => (name === 'suggest-shell-commands' ? true : undefined),
      processEnvironment: {},
      cwd,
      home,
    });
    expect(enabled.settings.value(editOptions.suggestShellCommands)).toBe(true);
  },
);

test(
  'disabling suggest-shell-commands swaps to the no-shell prompt text',
  {
    meta: {
      aider: ['aider/coders/base_coder.py:1187-1196', 'test_coder/TestCoder.test_no_suggest_shell_commands'],
    },
  },
  () => {
    const model = {
      name: 'gpt-3.5-turbo',
      lazy: false,
      overeager: false,
      examplesAsSysMsg: false,
      reminder: 'sys' as const,
      systemPromptPrefix: null,
      useSystemPrompt: true,
      maxInputTokens: 16385,
      supportsVision: false,
      supportsPdfInput: false,
      maxPdfSizeMb: null,
      tokenCount: () => 0,
    };
    const base: Omit<ChatChunksInput, 'suggestShellCommands'> = {
      prompts: editBlockPrompts,
      model,
      fence: ['```', '```'],
      userLanguage: null,
      platform: '- Platform: Linux\n',
      done: [],
      repoMap: null,
      readOnlyFiles: [],
      chatFiles: [],
      cur: [],
    };
    const withShell = fmtSystemPrompt(editBlockPrompts.mainSystem, { ...base, suggestShellCommands: true });
    const withoutShell = fmtSystemPrompt(editBlockPrompts.mainSystem, { ...base, suggestShellCommands: false });
    expect(withShell).toContain('suggest any shell commands');
    expect(withoutShell).not.toContain('suggest any shell commands');
    expect(withoutShell).toContain("Keep in mind these details about the user's platform");
  },
);

test(
  'a bare bash fence forwards one distinct block to the validation shell port',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_suggest_shell_commands', 'aider/coders/base_coder.py:2434-2448'],
    },
  },
  async () => {
    const h = await harness({ suggestShellCommands: true });
    await h.controller.completeReply({ kind: 'complete', id: 'reply-shell', text: BASH_REPLY });
    expect(h.shellCalls).toHaveLength(1);
    expect(h.shellCalls[0]?.[0]?.trim()).toBe('echo "Hello, World!"');
  },
);

test(
  'duplicate identical bash fences forward once',
  {
    meta: {
      aider: ['aider/coders/base_coder.py:2434-2448'],
    },
  },
  async () => {
    const h = await harness({ suggestShellCommands: true });
    await h.controller.completeReply({ kind: 'complete', id: 'reply-dup', text: DUP_BASH_REPLY });
    expect(h.shellCalls).toHaveLength(1);
    expect(h.shellCalls[0]).toHaveLength(1);
    expect(h.shellCalls[0]?.[0]?.trim()).toBe('echo "Hello, World!"');
  },
);

test(
  'suggest-shell-commands false skips the shell port even when the reply has bash fences',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_no_suggest_shell_commands', 'aider/coders/base_coder.py:2434-2436'],
    },
  },
  async () => {
    const h = await harness({ suggestShellCommands: false });
    await h.controller.completeReply({ kind: 'complete', id: 'reply-off', text: BASH_REPLY });
    expect(h.shellCalls).toEqual([]);
  },
);

test(
  'a SEARCH-bearing shell fence stays a file edit and does not reach the shell port',
  {
    meta: {
      aider: ['aider/coders/editblock_coder.py:21-36'],
    },
  },
  async () => {
    const h = await harness({ suggestShellCommands: true, editable: ['script.sh'] });
    await writeFile(join(h.root, 'script.sh'), 'old\n');
    await h.controller.completeReply({ kind: 'complete', id: 'reply-sr', text: SEARCH_SHELL_REPLY });
    expect(h.shellCalls).toEqual([]);
    expect(await h.tree.read(absRootPath(h.root, 'script.sh'))).toBe('new\n');
  },
);

test('disabledValidation.runSuggestedShell is a no-op disabled outcome', async () => {
  expect(await disabledValidation.runSuggestedShell(['echo hi'])).toEqual({ kind: 'disabled' });
});
