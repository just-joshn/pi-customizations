import { basename as win32Basename } from 'node:path/win32';

import { expect, test } from 'vitest';
import { editBlockPrompts } from '../../src/edit/prompts/editblock.ts';
import { type ChatChunksInput, formatChatChunks, getPlatformInfo, getUserLanguage, normalizeLanguage, type PromptModel } from '../../src/edit/prompts/format.ts';
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
