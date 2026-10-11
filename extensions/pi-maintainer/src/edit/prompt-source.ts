import { platform as osPlatform, release, type as osType } from 'node:os';
import type { PromptSet, PromptSource, PromptVariables } from '../core/prompts.ts';
import type { EditFormatName } from '../feature.ts';
import { architectPrompts } from './prompts/architect.ts';
import { askPrompts } from './prompts/ask.ts';
import type { EditPrompts } from './prompts/base.ts';
import { contextPrompts } from './prompts/context.ts';
import { editBlockFencedPrompts } from './prompts/editblock-fenced.ts';
import { editBlockPrompts } from './prompts/editblock.ts';
import { editorDiffFencedPrompts } from './prompts/editor-diff-fenced.ts';
import { editorEditBlockPrompts } from './prompts/editor-editblock.ts';
import { editorWholeFilePrompts } from './prompts/editor-whole.ts';
import { fmtSystemPrompt, getPlatformInfo, getUserLanguage, type PromptContext } from './prompts/format.ts';
import { patchPrompts } from './prompts/patch.ts';
import { unifiedDiffSimplePrompts } from './prompts/udiff-simple.ts';
import { unifiedDiffPrompts } from './prompts/udiff.ts';
import { wholeFilePrompts } from './prompts/wholefile.ts';

export interface EditPromptSourceOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly chatLanguage?: () => string | null;
  readonly now?: () => Date;
  readonly platform?: () => string | null;
  readonly windows?: () => boolean;
  readonly lazy?: () => boolean;
  readonly overeager?: () => boolean;
}

const EDIT_PROMPT_REGISTRY: Partial<Record<EditFormatName, EditPrompts>> = {
  whole: wholeFilePrompts,
  diff: editBlockPrompts,
  'diff-fenced': editBlockFencedPrompts,
  udiff: unifiedDiffPrompts,
  'udiff-simple': unifiedDiffSimplePrompts,
  patch: patchPrompts,
  'editor-diff': editorEditBlockPrompts,
  'editor-diff-fenced': editorDiffFencedPrompts,
  'editor-whole': editorWholeFilePrompts,
  architect: architectPrompts,
  ask: askPrompts,
  context: contextPrompts,
};

function defaultPlatform(): string {
  return `${osType()}-${release()}-${osPlatform()}`;
}

function promptsFor(format: EditFormatName): EditPrompts {
  const prompts = EDIT_PROMPT_REGISTRY[format];
  if (prompts === undefined) throw new Error(`Unknown edit format for PromptSource: ${format}`);
  return prompts;
}

function formatPromptSet(prompts: EditPrompts, context: PromptContext): PromptSet {
  const fmt = (template: string): string => fmtSystemPrompt(template, context);
  return {
    mainSystem: fmt(prompts.mainSystem),
    systemReminder: prompts.systemReminder ? fmt(prompts.systemReminder) : '',
    exampleMessages: prompts.exampleMessages.map((message) => ({ role: message.role, content: fmt(message.content) })),
    filesContentPrefix: prompts.filesContentPrefix,
    filesContentAssistantReply: prompts.filesContentAssistantReply,
    filesNoFullFiles: prompts.filesNoFullFiles,
    filesNoFullFilesWithRepoMap: prompts.filesNoFullFilesWithRepoMap,
    filesNoFullFilesWithRepoMapReply: prompts.filesNoFullFilesWithRepoMapReply,
    readOnlyFilesPrefix: prompts.readOnlyFilesPrefix,
    filesContentGptEditsNoRepo: prompts.filesContentGptEditsNoRepo,
  };
}

export function createEditPromptSource(options: EditPromptSourceOptions = {}): PromptSource {
  return {
    get(format, variables: PromptVariables): PromptSet {
      variables.signal?.throwIfAborted();
      const prompts = promptsFor(format);
      const env = options.env ?? process.env;
      const userLanguage = getUserLanguage({ chatLanguage: options.chatLanguage?.() ?? null, locale: null, env });
      const platform = getPlatformInfo({
        platform: options.platform?.() ?? defaultPlatform(),
        windows: options.windows?.() ?? process.platform === 'win32',
        env,
        now: options.now?.() ?? new Date(),
        userLanguage,
        repo: false,
        lintCmds: null,
        autoLint: false,
        testCmd: null,
        autoTest: false,
      });
      const context: PromptContext = {
        prompts,
        model: { lazy: options.lazy?.() ?? false, overeager: options.overeager?.() ?? false },
        fence: variables.fence,
        suggestShellCommands: variables.suggestShellCommands,
        userLanguage,
        platform,
      };
      const set = formatPromptSet(prompts, context);
      variables.signal?.throwIfAborted();
      return set;
    },
  };
}
