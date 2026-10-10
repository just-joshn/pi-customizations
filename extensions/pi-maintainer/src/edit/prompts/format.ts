import { getRepoMessages } from '../../map/prompt-insertion.ts';
import { imageMimeType, isImageFile } from '../../support/image-files.ts';
import { pyFormat } from '../../support/pyformat.ts';
import { strip } from '../../support/pystr.ts';
import type { CoderPrompts, EditPrompts } from './base.ts';

/** A fence pair, open then close, as Aider's `choose_fence` picks it. */
export type Fence = readonly [open: string, close: string];

export interface TextMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** One part of a multimodal user message, in the OpenAI shape that litellm accepts. */
export type ContentPart = { readonly type: 'text'; readonly text: string } | { readonly type: 'image_url'; readonly image_url: string | { readonly url: string; readonly detail: 'high' } };

export interface ImageMessage {
  readonly role: 'user';
  readonly content: readonly ContentPart[];
}

export type ChatMessage = TextMessage | ImageMessage;

/** What prompt assembly reads from Aider's `Model`: its settings, its litellm info, and its token counter. */
export interface PromptModel {
  readonly name: string;
  readonly lazy: boolean;
  readonly overeager: boolean;
  readonly examplesAsSysMsg: boolean;
  /** `sys` sends the reminder as the last message, `user` appends it to a final user message, null sends none. */
  readonly reminder: 'sys' | 'user' | null;
  readonly systemPromptPrefix: string | null;
  readonly useSystemPrompt: boolean;
  readonly maxInputTokens: number | null;
  readonly supportsVision: boolean;
  readonly supportsPdfInput: boolean;
  readonly maxPdfSizeMb: number | null;
  /** Tokens in a message list, or null when the model cannot count them. */
  readonly tokenCount: (messages: readonly ChatMessage[]) => number | null;
}

/** Everything `fmt_system_prompt` reads besides the template. */
export interface PromptContext {
  readonly prompts: CoderPrompts;
  readonly model: Pick<PromptModel, 'lazy' | 'overeager'>;
  readonly fence: Fence;
  readonly suggestShellCommands: boolean;
  /** `get_user_language()`. */
  readonly userLanguage: string | null;
  /** `get_platform_info()`. */
  readonly platform: string;
}

/** A file in the chat as Aider read it: decoded text, or base64 for an image or PDF. */
export interface ContextFile {
  readonly relPath: string;
  readonly content: string;
}

/** Everything `format_chat_chunks` reads. Files are the readable ones, in the order they are sent. */
export interface ChatChunksInput extends PromptContext {
  readonly prompts: EditPrompts;
  readonly model: PromptModel;
  readonly done: readonly TextMessage[];
  /** `get_repo_map()`, or null without a map. */
  readonly repoMap: string | null;
  readonly readOnlyFiles: readonly ContextFile[];
  readonly chatFiles: readonly ContextFile[];
  readonly cur: readonly TextMessage[];
  /** Basename used for image MIME (defaults to the host `path.basename`). Tests pass `path.win32.basename`. */
  readonly pathBasename?: (filePath: string) => string;
}

/** Aider's `ChatChunks`. */
export interface ChatChunks {
  readonly system: readonly TextMessage[];
  readonly examples: readonly TextMessage[];
  readonly done: readonly TextMessage[];
  readonly repo: readonly TextMessage[];
  readonly readonlyFiles: readonly ChatMessage[];
  readonly chatFiles: readonly ChatMessage[];
  readonly cur: readonly TextMessage[];
  readonly reminder: readonly TextMessage[];
}

/** Where `get_user_language` looks for the user's language. */
export interface LanguageFacts {
  /** The `--chat-language` setting. */
  readonly chatLanguage: string | null;
  /** `locale.getlocale()[0]`, or null when it is None or raises. */
  readonly locale: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Everything `get_platform_info` reads. */
export interface PlatformInput {
  /** `platform.platform()`, or null when it raises KeyError. */
  readonly platform: string | null;
  /** Whether `os.name` is `nt`, where Aider reports COMSPEC instead of SHELL. */
  readonly windows: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The current time. Aider reports its local date. */
  readonly now: Date;
  readonly userLanguage: string | null;
  /** Whether the coder has a Git repository. */
  readonly repo: boolean;
  /** The parsed `--lint-cmd` values by language, with null for a command that names none. */
  readonly lintCmds: ReadonlyMap<string | null, string> | null;
  readonly autoLint: boolean;
  readonly testCmd: string | null;
  readonly autoTest: boolean;
}

const FALLBACK_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['en', 'English'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ru', 'Russian'],
]);

const LANGUAGE_VARIABLES: readonly string[] = ['LANG', 'LANGUAGE', 'LC_ALL', 'LC_MESSAGES'];

const QUAD_BACKTICK_REMINDER = '\nIMPORTANT: Use *quadruple* backticks ```` as fences, not triple backticks!\n';

const EXAMPLES_RESET: readonly TextMessage[] = [
  { role: 'user', content: "I switched to a new code base. Please don't consider the above files or try to edit them any longer." },
  { role: 'assistant', content: 'Ok.' },
];

/**
 * `normalize_language` as Aider runs it without Babel, which Aider does not depend on and the
 * pinned environment lacks. Without Babel, its already-a-name branch returns what this returns.
 */
export function normalizeLanguage(langCode: string | null): string | null {
  if (!langCode) return null;
  const upper = langCode.toUpperCase();
  if (upper === 'C' || upper === 'POSIX') return null;
  const primary = (langCode.replaceAll('-', '_').split('_')[0] ?? '').toLowerCase();
  return FALLBACK_LANGUAGES.get(primary) ?? langCode;
}

export function getUserLanguage(facts: LanguageFacts): string | null {
  if (facts.chatLanguage) return normalizeLanguage(facts.chatLanguage);
  const fromLocale = normalizeLanguage(facts.locale);
  if (fromLocale) return fromLocale;
  const value = LANGUAGE_VARIABLES.map((name) => facts.env[name]).find((found) => found);
  return value ? normalizeLanguage(value.split('.')[0] ?? '') : null;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

function lintText(lintCmds: ReadonlyMap<string | null, string> | null, autoLint: boolean): string {
  if (!lintCmds?.size) return '';
  const heading = autoLint ? "- The user's pre-commit runs these lint commands, don't suggest running them:\n" : '- The user prefers these lint commands:\n';
  return heading + [...lintCmds].map(([lang, cmd]) => (lang === null ? `  - ${cmd}\n` : `  - ${lang}: ${cmd}\n`)).join('');
}

function testText(testCmd: string | null, autoTest: boolean): string {
  if (!testCmd) return '';
  const heading = autoTest ? "- The user's pre-commit runs this test command, don't suggest running them: " : '- The user prefers this test command: ';
  return `${heading}${testCmd}\n`;
}

export function getPlatformInfo(input: PlatformInput): string {
  const shellVar = input.windows ? 'COMSPEC' : 'SHELL';
  const { now } = input;
  return [
    input.platform === null ? '- Platform information unavailable\n' : `- Platform: ${input.platform}\n`,
    `- Shell: ${shellVar}=${input.env[shellVar] ?? 'None'}\n`,
    input.userLanguage ? `- Language: ${input.userLanguage}\n` : '',
    `- Current date: ${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}\n`,
    input.repo ? '- The user is operating inside a git repository\n' : '',
    lintText(input.lintCmds, input.autoLint),
    testText(input.testCmd, input.autoTest),
  ].join('');
}

export function fmtSystemPrompt(prompt: string, context: PromptContext): string {
  const { prompts, model, fence, userLanguage, platform } = context;
  const finalReminders = [model.lazy ? [prompts.lazyPrompt] : [], model.overeager ? [prompts.overeagerPrompt] : [], userLanguage ? [`Reply in ${userLanguage}.\n`] : []].flat();
  const shell = context.suggestShellCommands ? { prompt: prompts.shellCmdPrompt, reminder: prompts.shellCmdReminder, rename: prompts.renameWithShell } : { prompt: prompts.noShellCmdPrompt, reminder: prompts.noShellCmdReminder, rename: '' };
  return pyFormat(prompt, {
    fence,
    quad_backtick_reminder: fence[0] === '````' ? QUAD_BACKTICK_REMINDER : '',
    final_reminders: finalReminders.join('\n\n'),
    platform,
    shell_cmd_prompt: pyFormat(shell.prompt, { platform }),
    rename_with_shell: shell.rename,
    shell_cmd_reminder: pyFormat(shell.reminder, { platform }),
    go_ahead_tip: prompts.goAheadTip,
    language: userLanguage || 'the same language they are using',
  });
}

function systemAndExamples(input: ChatChunksInput): { readonly mainSys: string; readonly examples: readonly TextMessage[] } {
  const fmt = (template: string): string => fmtSystemPrompt(template, input);
  const { prompts, model } = input;
  const mainSystem = fmt(prompts.mainSystem);
  const prefixed = model.systemPromptPrefix ? `${model.systemPromptPrefix}\n${mainSystem}` : mainSystem;
  const examples = prompts.exampleMessages.map((message) => ({ role: message.role, content: fmt(message.content) }));
  const reminder = prompts.systemReminder ? `\n${fmt(prompts.systemReminder)}` : '';
  if (model.examplesAsSysMsg) {
    const heading = examples.length > 0 ? '\n# Example conversations:\n\n' : '';
    const conversations = examples.map((message) => `## ${message.role.toUpperCase()}: ${message.content}\n\n`).join('');
    return { mainSys: strip(prefixed + heading + conversations) + reminder, examples: [] };
  }
  return { mainSys: prefixed + reminder, examples: examples.length > 0 ? [...examples, ...EXAMPLES_RESET] : [] };
}

function getFilesContent(files: readonly ContextFile[], fence: Fence): string {
  return files
    .filter((file) => !isImageFile(file.relPath))
    .map((file) => `\n${file.relPath}\n${fence[0]}\n${file.content}${fence[1]}\n`)
    .join('');
}

function imageParts(file: ContextFile, supportsImages: boolean, supportsPdfs: boolean, pathBasename: ((filePath: string) => string) | undefined): readonly ContentPart[] {
  const mimeType = isImageFile(file.relPath) ? imageMimeType(file.relPath, pathBasename) : null;
  if (mimeType === null) return [];
  const url = `data:${mimeType};base64,${file.content}`;
  if (mimeType.startsWith('image/') && supportsImages) {
    return [
      { type: 'text', text: `Image file: ${file.relPath}` },
      { type: 'image_url', image_url: { url, detail: 'high' } },
    ];
  }
  if (mimeType === 'application/pdf' && supportsPdfs) {
    return [
      { type: 'text', text: `PDF file: ${file.relPath}` },
      { type: 'image_url', image_url: url },
    ];
  }
  return [];
}

function getImagesMessage(files: readonly ContextFile[], model: PromptModel, pathBasename: ((filePath: string) => string) | undefined): ImageMessage | null {
  const supportsImages = model.supportsVision;
  const supportsPdfs = model.supportsPdfInput || Boolean(model.maxPdfSizeMb) || model.name.includes('claude-3-5-sonnet-20241022');
  if (!(supportsImages || supportsPdfs)) return null;
  const content = files.flatMap((file) => imageParts(file, supportsImages, supportsPdfs, pathBasename));
  return content.length > 0 ? { role: 'user', content } : null;
}

function getReadonlyFilesMessages(input: ChatChunksInput): readonly ChatMessage[] {
  const content = getFilesContent(input.readOnlyFiles, input.fence);
  const text: readonly ChatMessage[] = content
    ? [
        { role: 'user', content: input.prompts.readOnlyFilesPrefix + content },
        { role: 'assistant', content: 'Ok, I will use these files as references.' },
      ]
    : [];
  const images = getImagesMessage(input.readOnlyFiles, input.model, input.pathBasename);
  return images ? [...text, images, { role: 'assistant', content: 'Ok, I will use these images as references.' }] : text;
}

function chatFilesText(input: ChatChunksInput): readonly [content: string, reply: string] {
  const { prompts } = input;
  if (input.chatFiles.length > 0) return [prompts.filesContentPrefix + getFilesContent(input.chatFiles, input.fence), prompts.filesContentAssistantReply];
  if (input.repoMap && prompts.filesNoFullFilesWithRepoMap) return [prompts.filesNoFullFilesWithRepoMap, prompts.filesNoFullFilesWithRepoMapReply];
  return [prompts.filesNoFullFiles, 'Ok.'];
}

function getChatFilesMessages(input: ChatChunksInput): readonly ChatMessage[] {
  const [content, reply] = chatFilesText(input);
  const text: readonly ChatMessage[] = content
    ? [
        { role: 'user', content },
        { role: 'assistant', content: reply },
      ]
    : [];
  const images = getImagesMessage(input.chatFiles, input.model, input.pathBasename);
  return images ? [...text, images, { role: 'assistant', content: 'Ok.' }] : text;
}

/** Aider's `ChatChunks.all_messages` order, which differs from the field order. */
export function allMessages(chunks: ChatChunks): readonly ChatMessage[] {
  return [...chunks.system, ...chunks.examples, ...chunks.readonlyFiles, ...chunks.repo, ...chunks.done, ...chunks.chatFiles, ...chunks.cur, ...chunks.reminder];
}

/** The tail of `format_chat_chunks`: the reminder goes last or into the final user message while it fits. */
function placeReminder(input: ChatChunksInput, chunks: ChatChunks): ChatChunks {
  const { prompts, model } = input;
  const reminder = fmtSystemPrompt(prompts.systemReminder, input);
  const reminderMessage: readonly TextMessage[] = prompts.systemReminder ? [{ role: 'system', content: reminder }] : [];
  // Aider adds `cur` again even though `all_messages` already includes it (base_coder.py:1298-1303).
  const messagesTokens = model.tokenCount(allMessages(chunks));
  const reminderTokens = model.tokenCount(reminderMessage);
  const curTokens = model.tokenCount(chunks.cur);
  const totalTokens =
    messagesTokens !== null && reminderTokens !== null && curTokens !== null ? messagesTokens + reminderTokens + curTokens : 0;
  const maxInputTokens = model.maxInputTokens || 0;
  if (maxInputTokens && !(totalTokens < maxInputTokens && prompts.systemReminder)) return chunks;
  if (model.reminder === 'sys') return { ...chunks, reminder: reminderMessage };
  const final = chunks.cur.at(-1);
  if (model.reminder !== 'user' || final?.role !== 'user') return chunks;
  return { ...chunks, cur: [...chunks.cur.slice(0, -1), { role: final.role, content: `${final.content}\n\n${reminder}` }] };
}

export function formatChatChunks(input: ChatChunksInput): ChatChunks {
  const { mainSys, examples } = systemAndExamples(input);
  const system: readonly TextMessage[] = input.model.useSystemPrompt
    ? [{ role: 'system', content: mainSys }]
    : [
        { role: 'user', content: mainSys },
        { role: 'assistant', content: 'Ok.' },
      ];
  return placeReminder(input, {
    system,
    examples,
    done: input.done,
    repo: getRepoMessages(input.repoMap),
    readonlyFiles: getReadonlyFilesMessages(input),
    chatFiles: getChatFilesMessages(input),
    cur: input.cur,
    reminder: [],
  });
}
