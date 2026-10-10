import { basename as win32Basename } from 'node:path/win32';

import { expect, test } from 'vitest';
import { editBlockPrompts } from '../../src/edit/prompts/editblock.ts';
import { allMessages, type ChatChunksInput, formatChatChunks, getPlatformInfo, getUserLanguage, normalizeLanguage, type PromptModel } from '../../src/edit/prompts/format.ts';
import { unifiedDiffSimplePrompts } from '../../src/edit/prompts/udiff-simple.ts';
import { wholeFilePrompts } from '../../src/edit/prompts/wholefile.ts';
import { imageMimeType, isImageFile } from '../../src/support/image-files.ts';

const normalizeTest = { meta: { aider: ['test_coder/TestCoder.test_normalize_language'] } };
const userLanguageTest = { meta: { aider: ['test_coder/TestCoder.test_get_user_language'] } };

/** gpt-3.5-turbo's model settings, the model the Aider tests create coders with. */
const gpt35: PromptModel = {
  name: 'gpt-3.5-turbo',
  lazy: false,
  overeager: false,
  examplesAsSysMsg: false,
  reminder: 'sys',
  systemPromptPrefix: null,
  useSystemPrompt: true,
  maxInputTokens: 16385,
  supportsVision: false,
  supportsPdfInput: false,
  maxPdfSizeMb: null,
  tokenCount: (messages) => messages.length,
};

const chunkInput: ChatChunksInput = {
  prompts: wholeFilePrompts,
  model: gpt35,
  fence: ['```', '```'],
  suggestShellCommands: true,
  userLanguage: null,
  platform: '- Platform: Linux\n',
  done: [],
  repoMap: null,
  readOnlyFiles: [],
  chatFiles: [],
  cur: [],
};

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4//8/AAX+Av6n1qTHAAAAAElFTkSuQmCC';

test('C, POSIX, or nothing normalizes to no language', normalizeTest, () => {
  expect([null, '', 'C', 'POSIX'].map(normalizeLanguage)).toEqual([null, null, null, null]);
});

test('a language name stays as it is', normalizeTest, () => {
  expect(['English', 'French'].map(normalizeLanguage)).toEqual(['English', 'French']);
});

test('a locale code maps to its language name', normalizeTest, () => {
  expect(['en_US', 'fr_FR', 'es', 'de_DE.UTF-8', 'zh-CN', 'ja', 'fr-FR'].map(normalizeLanguage)).toEqual(['English', 'French', 'Spanish', 'German', 'Chinese', 'Japanese', 'French']);
});

test('an unknown locale code stays as it is', normalizeTest, () => {
  expect(normalizeLanguage('unknown_code')).toBe('unknown_code');
});

test('a chat language code normalizes to its language name', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: 'fr_CA', locale: null, env: {} })).toBe('French');
});

test('the chat language setting outranks the locale', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: 'it_IT', locale: 'en_US', env: { LANG: 'de_DE' } })).toBe('Italian');
});

test('the locale names the language without a chat language', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: null, locale: 'en_GB', env: { LANG: 'de_DE.UTF-8' } })).toBe('English');
});

test('LANG names the language when the locale has none', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: null, locale: null, env: { LANG: 'de_DE.UTF-8' } })).toBe('German');
});

test('LANGUAGE names the language when LANG is unset', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: null, locale: null, env: { LANGUAGE: 'es_ES' } })).toBe('Spanish');
});

test('no setting, locale, or environment yields no language', userLanguageTest, () => {
  expect(getUserLanguage({ chatLanguage: null, locale: null, env: {} })).toBeNull();
  expect(getUserLanguage({ chatLanguage: null, locale: null, env: { LANG: 'C' } })).toBeNull();
});

test('the system prompt prefix starts the system message', { meta: { aider: ['test_coder/TestCoder.test_system_prompt_prefix'] } }, () => {
  const { system } = formatChatChunks({ ...chunkInput, model: { ...gpt35, systemPromptPrefix: 'Test prefix. ' } });
  expect(system).toEqual([{ role: 'system', content: expect.stringMatching(/^Test prefix\. \nAct as an expert software developer\.\nTake requests/) }]);
});

test('the chat files message lists each file above its fenced content', { meta: { aider: ['test_coder/TestCoder.test_get_files_content'] } }, () => {
  const files = [
    { relPath: 'file1.txt', content: '' },
    { relPath: 'file2.txt', content: '' },
  ];
  const { chatFiles } = formatChatChunks({ ...chunkInput, prompts: editBlockPrompts, chatFiles: files });
  expect(chatFiles).toEqual([
    { role: 'user', content: `${editBlockPrompts.filesContentPrefix}\nfile1.txt\n\`\`\`\n\`\`\`\n\nfile2.txt\n\`\`\`\n\`\`\`\n` },
    { role: 'assistant', content: 'Ok, any changes I propose will be to those files.' },
  ]);
});

test('platform info reports a resolved chat language', () => {
  const userLanguage = getUserLanguage({ chatLanguage: 'Spanish', locale: 'en_US', env: {} });
  const info = getPlatformInfo({
    platform: 'Linux-6.1',
    windows: false,
    env: { SHELL: '/bin/bash' },
    now: new Date(2026, 9, 10, 12),
    userLanguage,
    repo: true,
    lintCmds: null,
    autoLint: true,
    testCmd: null,
    autoTest: false,
  });
  expect(info).toBe('- Platform: Linux-6.1\n- Shell: SHELL=/bin/bash\n- Language: Spanish\n- Current date: 2026-10-10\n- The user is operating inside a git repository\n');
});

test('image MIME uses native path basename semantics', () => {
  expect(isImageFile('SHOT.PNG')).toBe(false);
  expect(imageMimeType('dir/shot.png')).toBe('image/png');
  expect(imageMimeType('images\\.png')).toBe(process.platform === 'win32' ? null : 'image/png');
  expect(imageMimeType('.png')).toBeNull();
});

test('Windows path rules drop MIME for nested dot-only image names', () => {
  expect(imageMimeType(String.raw`dir\nested\.png`, win32Basename)).toBeNull();
  expect(imageMimeType(String.raw`C:\dir\nested\.png`, win32Basename)).toBeNull();
  expect(imageMimeType(String.raw`dir\nested\..png`, win32Basename)).toBeNull();
  expect(imageMimeType(String.raw`dir\shot.png`, win32Basename)).toBe('image/png');
  expect(imageMimeType(String.raw`dir\doc.pdf`, win32Basename)).toBe('application/pdf');
});

test('all_messages follows system, examples, read-only, repo, done, chat files, current, reminder', () => {
  const chunks = formatChatChunks({
    ...chunkInput,
    prompts: editBlockPrompts,
    repoMap: 'REPO MAP',
    readOnlyFiles: [{ relPath: 'ro.txt', content: 'ref' }],
    chatFiles: [{ relPath: 'app.py', content: 'print(1)' }],
    done: [{ role: 'user', content: 'earlier' }],
    cur: [{ role: 'user', content: 'now' }],
  });
  const roles = allMessages(chunks).map((message) => message.role);
  const texts = allMessages(chunks).map((message) => (typeof message.content === 'string' ? message.content : message.content.map((part) => ('text' in part ? part.text : '')).join('')));
  expect(roles[0]).toBe('system');
  expect(texts.some((text) => text.includes('REPO MAP'))).toBe(true);
  expect(texts.some((text) => text.includes('ro.txt'))).toBe(true);
  expect(texts.some((text) => text.includes('app.py'))).toBe(true);
  expect(texts.indexOf('earlier')).toBeLessThan(texts.indexOf('now'));
  expect(texts.indexOf('now')).toBeLessThan(texts.length - 1);
  expect(chunks.reminder).toHaveLength(1);
  expect(allMessages(chunks).at(-1)).toEqual(chunks.reminder[0]);
});

test('examples as system text use the Example conversations heading, otherwise messages plus codebase reset', () => {
  const asSystem = formatChatChunks({
    ...chunkInput,
    prompts: editBlockPrompts,
    model: { ...gpt35, examplesAsSysMsg: true },
  });
  expect(asSystem.examples).toEqual([]);
  expect(asSystem.system[0]?.content).toContain('# Example conversations:');
  expect(asSystem.system[0]?.content).toContain('## USER:');

  const asMessages = formatChatChunks({
    ...chunkInput,
    prompts: editBlockPrompts,
    model: { ...gpt35, examplesAsSysMsg: false },
  });
  expect(asMessages.examples.at(-2)).toEqual({
    role: 'user',
    content: "I switched to a new code base. Please don't consider the above files or try to edit them any longer.",
  });
  expect(asMessages.examples.at(-1)).toEqual({ role: 'assistant', content: 'Ok.' });
  expect(asMessages.system[0]?.content).not.toContain('# Example conversations:');
});

test('sys reminder is a final system message and user reminder appends to the last user turn when budget allows', () => {
  const sys = formatChatChunks({
    ...chunkInput,
    prompts: unifiedDiffSimplePrompts,
    model: { ...gpt35, reminder: 'sys', maxInputTokens: null, tokenCount: () => null },
    chatFiles: [{ relPath: 'app.py', content: 'x' }],
    cur: [{ role: 'user', content: 'edit' }],
  });
  expect(sys.reminder).toEqual([{ role: 'system', content: expect.stringContaining('File editing rules') }]);

  const user = formatChatChunks({
    ...chunkInput,
    prompts: unifiedDiffSimplePrompts,
    model: { ...gpt35, reminder: 'user', maxInputTokens: null, tokenCount: () => null },
    chatFiles: [{ relPath: 'app.py', content: 'x' }],
    cur: [{ role: 'user', content: 'edit' }],
  });
  expect(user.reminder).toEqual([]);
  expect(user.cur.at(-1)?.content).toContain('edit\n\n# File editing rules:');
});

test('reminder admission double-counts cur tokens like Aider against the input budget', () => {
  const perMessage = 10;
  const model: PromptModel = {
    ...gpt35,
    reminder: 'sys',
    maxInputTokens: 60,
    tokenCount: (messages) => perMessage * messages.length,
  };
  const input: ChatChunksInput = {
    ...chunkInput,
    prompts: unifiedDiffSimplePrompts,
    model,
    chatFiles: [{ relPath: 'src/app.py', content: "def main():\n    print('hi')\n" }],
    cur: [{ role: 'user', content: 'Add a greeting.' }],
  };
  const withoutReminder = { ...formatChatChunks({ ...input, model: { ...model, maxInputTokens: 1 } }), reminder: [] };
  const assembled = allMessages(withoutReminder).length;
  const cur = withoutReminder.cur.length;
  // messages + reminder + cur again (Aider base_coder.py:1298-1303)
  expect(perMessage * assembled + perMessage + perMessage * cur).toBe(60);
  expect(formatChatChunks(input).reminder).toEqual([]);
});

test('a resolved chat language appears in platform info and as a Reply in instruction', () => {
  const userLanguage = getUserLanguage({ chatLanguage: 'Spanish', locale: 'en_US', env: {} });
  expect(userLanguage).toBe('Spanish');
  const platform = getPlatformInfo({
    platform: 'Linux-6.1',
    windows: false,
    env: { SHELL: '/bin/bash' },
    now: new Date(2026, 9, 10, 12),
    userLanguage,
    repo: false,
    lintCmds: null,
    autoLint: true,
    testCmd: null,
    autoTest: false,
  });
  expect(platform).toContain('- Language: Spanish\n');
  const { system } = formatChatChunks({ ...chunkInput, prompts: editBlockPrompts, userLanguage, platform });
  expect(system[0]?.content).toContain('Reply in Spanish.');
});

test('vision models send image and PDF data URLs with Image file or PDF file labels', { meta: { aider: ['test_commands/TestCommands.test_cmd_read_only_with_image_file'] } }, () => {
  const model: PromptModel = { ...gpt35, supportsVision: true, supportsPdfInput: true };
  const chunks = formatChatChunks({
    ...chunkInput,
    prompts: editBlockPrompts,
    model,
    readOnlyFiles: [
      { relPath: 'ro.png', content: tinyPng },
      { relPath: 'notes.txt', content: 'text' },
    ],
    chatFiles: [
      { relPath: 'doc.pdf', content: 'JVBERi0xLjQ=' },
      { relPath: 'app.py', content: 'print(1)' },
    ],
  });
  const readonlyImage = chunks.readonlyFiles.find((message) => Array.isArray(message.content));
  expect(readonlyImage).toEqual({
    role: 'user',
    content: [
      { type: 'text', text: 'Image file: ro.png' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}`, detail: 'high' } },
    ],
  });
  expect(chunks.readonlyFiles.at(-1)).toEqual({ role: 'assistant', content: 'Ok, I will use these images as references.' });
  const chatPdf = chunks.chatFiles.find((message) => Array.isArray(message.content));
  expect(chatPdf).toEqual({
    role: 'user',
    content: [
      { type: 'text', text: 'PDF file: doc.pdf' },
      { type: 'image_url', image_url: `data:application/pdf;base64,JVBERi0xLjQ=` },
    ],
  });
});

test('Windows nested dot-only paths produce no image message while ordinary image and PDF paths do', () => {
  const model: PromptModel = { ...gpt35, supportsVision: true, supportsPdfInput: true };
  const chunks = formatChatChunks({
    ...chunkInput,
    prompts: editBlockPrompts,
    model,
    pathBasename: win32Basename,
    chatFiles: [
      { relPath: String.raw`dir\nested\.png`, content: tinyPng },
      { relPath: String.raw`C:\dir\nested\.png`, content: tinyPng },
      { relPath: String.raw`dir\nested\..png`, content: tinyPng },
      { relPath: String.raw`dir\shot.png`, content: tinyPng },
      { relPath: String.raw`dir\doc.pdf`, content: 'JVBERi0xLjQ=' },
    ],
  });
  const imageMessages = chunks.chatFiles.filter((message) => Array.isArray(message.content));
  expect(imageMessages).toHaveLength(1);
  expect(imageMessages[0]).toEqual({
    role: 'user',
    content: [
      { type: 'text', text: String.raw`Image file: dir\shot.png` },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}`, detail: 'high' } },
      { type: 'text', text: String.raw`PDF file: dir\doc.pdf` },
      { type: 'image_url', image_url: 'data:application/pdf;base64,JVBERi0xLjQ=' },
    ],
  });
});
