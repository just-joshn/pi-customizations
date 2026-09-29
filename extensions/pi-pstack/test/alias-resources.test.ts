import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { fixture, lastRequest, packageRoot, prompt } from './session-fixture.ts';

function userRequestText(requests: Parameters<typeof lastRequest>[0]): string {
  const message = lastRequest(requests).messages.at(-1);
  if (message?.role !== 'user') throw new Error('Expected the actual user request');
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}

async function createUserPrompt(path: string) {
  await mkdir(path, { recursive: true });
  if (path.endsWith('/workspace')) {
    await mkdir(join(path, '.pi', 'prompts'), { recursive: true });
    await writeFile(join(path, '.pi', 'prompts', 'unslop.md'), 'USER_OWNED $ARGUMENTS\n');
  }
}

test('a real user template wins a package alias collision and keeps native argument grouping', async () => {
  const f = await fixture({ createDirectory: createUserPrompt, includeNativePromptTemplates: true });
  try {
    const { session, loader } = await f.open();
    expect(loader.getPrompts().prompts.find((template) => template.name === 'unslop')?.filePath).toBe(join(f.cwd, '.pi', 'prompts', 'unslop.md'));
    await prompt(session, '/unslop alpha "beta gamma" \'delta epsilon\'');
    expect(userRequestText(f.requests)).toBe('USER_OWNED alpha beta gamma delta epsilon\n');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a real package alias preserves literal task text in the model request', async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    expect(loader.getPrompts().prompts.find((template) => template.name === 'unslop')?.filePath).toBe(join(packageRoot, 'prompts', 'unslop.md'));
    const cases = [
      { input: '/unslop "double" \'single\'', suffix: '"double" \'single\'' },
      { input: "/unslop apostrophe's unmatched'", suffix: "apostrophe's unmatched'" },
      { input: '/unslop   leading and   trailing  ', suffix: '  leading and   trailing  ' },
      { input: '/unslop path\\with\\slashes', suffix: 'path\\with\\slashes' },
      { input: `/unslop $ARGUMENTS $1 \${@:-x}`, suffix: `$ARGUMENTS $1 \${@:-x}` },
      { input: '/unslop before\nmiddle\r\nafter', suffix: 'before\nmiddle\r\nafter' },
      { input: '/unslop \tbefore\nafter  ', suffix: '\tbefore\nafter  ' },
    ];
    for (const item of cases) {
      await prompt(session, item.input);
      expect(userRequestText(f.requests).endsWith(item.suffix)).toBe(true);
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('standalone bro retains native grouping while a package alias preserves literal quotes', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, '/bro "hello world"');
    expect(userRequestText(f.requests).endsWith('hello world')).toBe(true);
    expect(userRequestText(f.requests).endsWith('"hello world"')).toBe(false);
    await prompt(session, '/unslop "hello world"');
    expect(userRequestText(f.requests).endsWith('"hello world"')).toBe(true);
  } finally {
    await f.close();
  }
});

test('an unloaded alias remains ordinary input', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session, loader } = await f.open();
    expect(loader.getPrompts().prompts).toEqual([]);
    await prompt(session, '/how alpha "beta gamma"');
    expect(userRequestText(f.requests)).toBe('/how alpha "beta gamma"');
  } finally {
    await f.close();
  }
});

test('a template loaded without the package extension keeps native argument parsing', async () => {
  const f = await fixture({ extensionDisabled: true, includeNativePromptTemplates: true });
  try {
    const { session, loader } = await f.open();
    expect(loader.getPrompts().prompts.some((template) => template.name === 'unslop')).toBe(true);
    expect(session.extensionRunner.getRegisteredCommands().some((command) => command.name === 'pstack')).toBe(false);
    await prompt(session, '/unslop "hello world"');
    expect(userRequestText(f.requests).endsWith('hello world')).toBe(true);
    expect(userRequestText(f.requests).endsWith('"hello world"')).toBe(false);
  } finally {
    await f.close();
  }
});
