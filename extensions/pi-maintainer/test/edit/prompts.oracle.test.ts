import { type TSchema, Type } from 'typebox';
import { expect, test } from 'vitest';
import { architectPrompts } from '../../src/edit/prompts/architect.ts';
import { askPrompts } from '../../src/edit/prompts/ask.ts';
import { coderPrompts, type EditPrompts } from '../../src/edit/prompts/base.ts';
import { contextPrompts } from '../../src/edit/prompts/context.ts';
import { editBlockPrompts } from '../../src/edit/prompts/editblock.ts';
import { editBlockFencedPrompts } from '../../src/edit/prompts/editblock-fenced.ts';
import { editorDiffFencedPrompts } from '../../src/edit/prompts/editor-diff-fenced.ts';
import { editorEditBlockPrompts } from '../../src/edit/prompts/editor-editblock.ts';
import { editorWholeFilePrompts } from '../../src/edit/prompts/editor-whole.ts';
import { allMessages, type ChatChunks, fmtSystemPrompt, formatChatChunks, getPlatformInfo, getUserLanguage, normalizeLanguage, type TextMessage } from '../../src/edit/prompts/format.ts';
import { patchPrompts } from '../../src/edit/prompts/patch.ts';
import { shell } from '../../src/edit/prompts/shell.ts';
import { unifiedDiffPrompts } from '../../src/edit/prompts/udiff.ts';
import { unifiedDiffSimplePrompts } from '../../src/edit/prompts/udiff-simple.ts';
import { wholeFilePrompts } from '../../src/edit/prompts/wholefile.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';

/** Each runnable prompt record under its export name, the camelCased name of its Aider class. */
const editPrompts: Readonly<Record<string, EditPrompts>> = {
  editBlockPrompts,
  editBlockFencedPrompts,
  wholeFilePrompts,
  unifiedDiffPrompts,
  unifiedDiffSimplePrompts,
  patchPrompts,
  editorEditBlockPrompts,
  editorWholeFilePrompts,
  editorDiffFencedPrompts,
  architectPrompts,
  askPrompts,
  contextPrompts,
};

const records: Readonly<Record<string, object>> = { ...editPrompts, coderPrompts, shell };

function byPythonName<T>(table: Readonly<Record<string, T>>, pythonName: string): T {
  const name = pythonName.charAt(0).toLowerCase() + pythonName.slice(1);
  const found = Object.hasOwn(table, name) ? table[name] : undefined;
  if (found === undefined) throw new Error(`no prompt record named ${name}`);
  return found;
}

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const fence = Type.Tuple([Type.String(), Type.String()]);
const env = Type.Record(Type.String(), Type.String());
const message = Type.Object({ role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]), content: Type.String() });
const file = Type.Object({ path: Type.String(), content: Type.String() });

test.for(oracleCases('prompts', 'prompts.attributes', Type.Object({ name: Type.String() })))('prompt attributes $id', async ({ args, expected }) => {
  const attributes = () => Object.fromEntries(Object.entries(byPythonName(records, args.name)).map(([key, value]) => [snakeCase(key), value]));
  expect(await outcomeOf(attributes)).toEqual(expected);
});

test('prompt records reject writes at every level', () => {
  const targets: object[] = [...Object.values(records), ...Object.values(editPrompts).flatMap((prompts) => [prompts.exampleMessages, ...prompts.exampleMessages])];
  expect(new Set(targets.map((target) => Reflect.set(target, 'content', 'changed')))).toEqual(new Set([false]));
});

const fmtArgs = Type.Object({
  prompts: Type.String(),
  lazy: Type.Boolean(),
  overeager: Type.Boolean(),
  fence,
  suggest_shell_commands: Type.Boolean(),
  user_language: nullable(Type.String()),
  platform: Type.String(),
});

test.for(oracleCases('prompts', 'prompts.fmt_system_prompt', fmtArgs))('fmt_system_prompt $id', async ({ args, expected }) => {
  const prompts = byPythonName(editPrompts, args.prompts);
  const context = { prompts, model: args, fence: args.fence, suggestShellCommands: args.suggest_shell_commands, userLanguage: args.user_language, platform: args.platform };
  const fmt = (template: string): string => fmtSystemPrompt(template, context);
  const formatted = () => ({ main_system: fmt(prompts.mainSystem), system_reminder: fmt(prompts.systemReminder), example_messages: prompts.exampleMessages.map((example) => fmt(example.content)) });
  expect(await outcomeOf(formatted)).toEqual(expected);
});

const platformArgs = Type.Object({
  platform: nullable(Type.String()),
  os_name: Type.Union([Type.Literal('posix'), Type.Literal('nt')]),
  env,
  date: Type.String(),
  user_language: nullable(Type.String()),
  repo: Type.Boolean(),
  lint_cmds: nullable(Type.Array(Type.Tuple([nullable(Type.String()), Type.String()]))),
  auto_lint: Type.Boolean(),
  test_cmd: nullable(Type.String()),
  auto_test: Type.Boolean(),
});

test.for(oracleCases('prompts', 'prompts.get_platform_info', platformArgs))('get_platform_info $id', async ({ args, expected }) => {
  const info = () =>
    getPlatformInfo({
      platform: args.platform,
      windows: args.os_name === 'nt',
      env: args.env,
      now: new Date(`${args.date}T12:00:00`),
      userLanguage: args.user_language,
      repo: args.repo,
      lintCmds: args.lint_cmds === null ? null : new Map(args.lint_cmds),
      autoLint: args.auto_lint,
      testCmd: args.test_cmd,
      autoTest: args.auto_test,
    });
  expect(await outcomeOf(info)).toEqual(expected);
});

const languageArgs = Type.Object({ chat_language: nullable(Type.String()), locale: nullable(Type.String()), locale_raises: Type.Boolean(), env });

test.for(oracleCases('prompts', 'prompts.get_user_language', languageArgs))('get_user_language $id', async ({ args, expected }) => {
  const language = () => getUserLanguage({ chatLanguage: args.chat_language, locale: args.locale_raises ? null : args.locale, env: args.env });
  expect(await outcomeOf(language)).toEqual(expected);
});

test.for(oracleCases('prompts', 'prompts.normalize_language', Type.Object({ code: nullable(Type.String()) })))('normalize_language $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => normalizeLanguage(args.code))).toEqual(expected);
});

const chunksArgs = Type.Object({
  prompts: Type.String(),
  model: Type.Object({
    name: Type.String(),
    lazy: Type.Boolean(),
    overeager: Type.Boolean(),
    examples_as_sys_msg: Type.Boolean(),
    reminder: nullable(Type.Union([Type.Literal('sys'), Type.Literal('user')])),
    system_prompt_prefix: nullable(Type.String()),
    use_system_prompt: Type.Boolean(),
    max_input_tokens: nullable(Type.Integer()),
    supports_vision: Type.Boolean(),
    supports_pdf_input: Type.Boolean(),
    max_pdf_size_mb: nullable(Type.Number()),
    tokens_per_message: nullable(Type.Integer()),
  }),
  fence,
  suggest_shell_commands: Type.Boolean(),
  user_language: nullable(Type.String()),
  platform: Type.String(),
  done: Type.Array(message),
  repo_map: nullable(Type.String()),
  read_only_files: Type.Array(file),
  chat_files: Type.Array(file),
  cur: Type.Array(message),
});

test.for(oracleCases('prompts', 'prompts.format_chat_chunks', chunksArgs))('format_chat_chunks $id', async ({ args, expected }) => {
  const { model } = args;
  const perMessage = model.tokens_per_message;
  const chunks = () =>
    formatChatChunks({
      prompts: byPythonName(editPrompts, args.prompts),
      model: {
        name: model.name,
        lazy: model.lazy,
        overeager: model.overeager,
        examplesAsSysMsg: model.examples_as_sys_msg,
        reminder: model.reminder,
        systemPromptPrefix: model.system_prompt_prefix,
        useSystemPrompt: model.use_system_prompt,
        maxInputTokens: model.max_input_tokens,
        supportsVision: model.supports_vision,
        supportsPdfInput: model.supports_pdf_input,
        maxPdfSizeMb: model.max_pdf_size_mb,
        tokenCount: (messages) => (perMessage === null ? null : perMessage * messages.length),
      },
      fence: args.fence,
      suggestShellCommands: args.suggest_shell_commands,
      userLanguage: args.user_language,
      platform: args.platform,
      done: args.done,
      repoMap: args.repo_map,
      readOnlyFiles: args.read_only_files.map(({ path, content }) => ({ relPath: path, content })),
      chatFiles: args.chat_files.map(({ path, content }) => ({ relPath: path, content })),
      cur: args.cur,
    });
  const asPython = ({ readonlyFiles, chatFiles, ...rest }: ChatChunks) => ({ ...rest, readonly_files: readonlyFiles, chat_files: chatFiles });
  expect(await outcomeOf(() => asPython(chunks()))).toEqual(expected);
});

const count = Type.Integer({ minimum: 0 });
const countsArgs = Type.Object({
  counts: Type.Object({ system: count, examples: count, done: count, repo: count, readonly_files: count, chat_files: count, cur: count, reminder: count }),
});

test.for(oracleCases('prompts', 'prompts.all_messages', countsArgs))('all_messages $id', async ({ args, expected }) => {
  const marked = (field: string, total: number): TextMessage[] => Array.from({ length: total }, (_, index) => ({ role: 'user', content: `${field} ${index}` }));
  const { counts } = args;
  const chunks: ChatChunks = {
    system: marked('system', counts.system),
    examples: marked('examples', counts.examples),
    done: marked('done', counts.done),
    repo: marked('repo', counts.repo),
    readonlyFiles: marked('readonly_files', counts.readonly_files),
    chatFiles: marked('chat_files', counts.chat_files),
    cur: marked('cur', counts.cur),
    reminder: marked('reminder', counts.reminder),
  };
  expect(await outcomeOf(() => allMessages(chunks))).toEqual(expected);
});
