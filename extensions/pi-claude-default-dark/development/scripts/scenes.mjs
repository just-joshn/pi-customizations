export const FILES = {
  'src/client.ts': [
    'export async function request(url: string) {',
    '  const maxAttempts = 3;',
    '  for (let i = 0; i < maxAttempts; i++) {',
    '    try {',
    '      return await fetchWithTimeout(url);',
    '    } catch (error) {',
    '      if (i === maxAttempts - 1) throw error;',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
  'notes.txt': 'alpha\nbeta\ngamma\n',
};

const MARKDOWN = [
  '## Implementation',
  '',
  'Here is the **smallest safe** refactor with *one* helper and a [link](https://example.com).',
  '',
  '1. Preserve the public `request()` signature.',
  '2. Share retry logic through a private helper.',
  '',
  '- bounded retries',
  '- current backoff',
  '',
  '> Keep the API stable.',
  '',
  '```ts',
  'export async function request(url: string): Promise<Response> {',
  '  const attempts = 3; // retries',
  '  return withRetry(() => fetch(url), attempts);',
  '}',
  '```',
  '',
  '---',
  '',
  '| file | change |',
  '| --- | --- |',
  '| src/client.ts | refactor |',
].join('\n');

const UNICODE = 'Wide text: 日本語のテキスト 中文 한국어 · emoji 🚀✅🔥 · combining é ñ ü · arrows → ← ↑';

const isClaude = (body) => (body?.tools ?? []).some((t) => t.name === 'Read');
let toolSeq = 0;
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${String(++toolSeq).padStart(6, '0')}`, name, input });
const TOOLS = {
  read: (body, path) => (isClaude(body) ? toolUse('Read', { file_path: `${process.env.CAPTURE_WORK}/${path}` }) : toolUse('read', { path })),
  bash: (body, command) => (isClaude(body) ? toolUse('Bash', { command, description: 'Run the command' }) : toolUse('bash', { command })),
  edit: (body, path, oldText, newText) => (isClaude(body) ? toolUse('Edit', { file_path: `${process.env.CAPTURE_WORK}/${path}`, old_string: oldText, new_string: newText }) : toolUse('edit', { path, edits: [{ oldText, newText }] })),
};

const submit = async (ctx, text) => {
  ctx.type(text);
  await ctx.sleep(200);
  ctx.keys('Enter');
};

const reset = async (ctx) => {
  await submit(ctx, ctx.product === 'claude' ? '/clear' : '/new');
  await ctx.sleep(1000);
};

const clearInput = async (ctx) => {
  ctx.keys('Escape');
  await ctx.sleep(200);
  ctx.keys('C-u');
  await ctx.sleep(300);
};

const ask = (name, replies, needle, extra = {}) => ({
  name,
  replies: { [`SCENE:${name}`]: replies },
  ...extra,
  async run(ctx) {
    await reset(ctx);
    await submit(ctx, `SCENE:${name}`);
    await ctx.waitFor((p) => (typeof needle === 'function' ? needle(p) : p.includes(needle)), name);
    ctx.capture(name, await ctx.settle());
    if (extra.expand) {
      ctx.keys('C-o');
      await ctx.sleep(800);
      ctx.capture(`${name}-expanded`, await ctx.settle());
      ctx.keys('C-o');
      await ctx.sleep(500);
    }
  },
});

const typed = (name, text, waitNeedle) => ({
  name,
  async run(ctx) {
    await reset(ctx);
    ctx.type(text);
    if (waitNeedle) await ctx.waitFor((p) => p.includes(waitNeedle), name);
    ctx.capture(name, await ctx.settle());
    await clearInput(ctx);
  },
});

export const SCENES = [
  {
    name: 'idle',
    async run(ctx) {
      ctx.capture('idle', await ctx.settle());
    },
  },
  typed('prompt-typed', 'Refactor the HTTP client and run the existing tests'),
  ask('assistant-text', 'Here is the smallest safe refactor.', 'smallest safe refactor'),
  ask('markdown', MARKDOWN, 'src/client.ts'),
  ask('unicode', UNICODE, 'arrows'),
  ask(
    'thinking',
    [
      [
        { type: 'thinking', thinking: 'Weighing whether retries should share one helper.', signature: 'c2lnbmF0dXJl' },
        { type: 'text', text: 'Decided on one shared helper.' },
      ],
    ],
    'shared helper',
  ),
  ask('api-error', { error: { status: 400, type: 'invalid_request_error', message: 'Synthetic capture error for SCENE api-error' } }, (p) => /error/i.test(p) && p.includes('Synthetic'), { expand: true }),
  ask('tool-read', [(b) => [TOOLS.read(b, 'notes.txt')], 'Read the notes file.'], 'Read the notes file.', { expand: true }),
  ask('tool-bash-ok', [(b) => [TOOLS.bash(b, "printf '42 passed\\n'")], 'Tests passed.'], 'Tests passed.', { expand: true }),
  ask('tool-bash-fail', [(b) => [TOOLS.bash(b, "printf 'FAIL tests/client.test.ts\\n' && false")], 'The test run failed.'], 'The test run failed.', { expand: true }),
  ask(
    'tool-edit',
    [(b) => [TOOLS.edit(b, 'src/client.ts', '  const maxAttempts = 3;\n  for (let i = 0; i < maxAttempts; i++) {', '  const maxAttempts = 5;\n  for (let attempt = 0; attempt < maxAttempts; attempt++) {')], 'Edited the retry loop.'],
    'Edited the retry loop.',
    { expand: true },
  ),
  {
    name: 'working',
    animated: true,
    replies: { 'SCENE:working': { delayMs: 6000, blocks: [{ type: 'text', text: 'Finished working.' }] } },
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, 'SCENE:working');
      for (const ms of [800, 1600, 2400, 3200]) {
        await ctx.sleep(ms === 800 ? 800 : 800);
        ctx.capture(`working-${ms}ms`);
      }
      await ctx.waitFor((p) => p.includes('Finished working.'), 'working-done', 20_000);
    },
  },
  ask(
    'code-tokens',
    [
      '```js',
      'const label = "capture";',
      'const ready = (1 + 2) === 3;',
      'console.log({ label, ready });',
      '```',
      '',
      '```sql',
      'SELECT name FROM captures WHERE count >= 3 AND ready != 0;',
      '```',
      '',
      '```html',
      '<section class="capture">Measured text</section>',
      '```',
      '',
      '```',
      'plain code without a language',
      '```',
    ].join('\n'),
    'plain code without',
  ),
  {
    name: 'tool-pending',
    animated: true,
    replies: { 'SCENE:tool-pending': [(b) => [TOOLS.bash(b, "sleep 4; printf 'pending tool finished\\n'")], 'Pending tool completed.'] },
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, 'SCENE:tool-pending');
      await ctx.waitFor((p) => p.includes('sleep 4'), 'tool-pending');
      ctx.capture('tool-pending');
      await ctx.waitFor((p) => p.includes('Pending tool completed.'), 'tool-pending-done');
    },
  },
  ...['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({
    name: `thinking-level-${level}`,
    only: 'pi',
    comparable: false,
    async run(ctx) {
      await reset(ctx);
      if (level === 'xhigh' || level === 'max') {
        await submit(ctx, '/model anthropic/claude-opus-4-8');
        await ctx.sleep(400);
        ctx.keys('Enter');
        await ctx.sleep(500);
      }
      await submit(ctx, `/thinking ${level}`);
      await ctx.sleep(400);
      ctx.keys('Enter');
      await ctx.sleep(400);
      ctx.capture(`thinking-level-${level}`, await ctx.settle());
      if (level === 'max') {
        await submit(ctx, '/model anthropic/claude-opus-4-5');
        await ctx.sleep(400);
        ctx.keys('Enter');
        await ctx.sleep(500);
      }
    },
  })),
  {
    name: 'compaction',
    replies: { 'SCENE:compaction': `${'A synthetic conversation about bounded retries and a shared helper. '.repeat(1500)}\nCompaction input complete.` },
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, 'SCENE:compaction');
      await ctx.waitFor((p) => p.includes('Compaction input complete.'), 'compaction-input');
      await submit(ctx, '/compact');
      await ctx.sleep(2500);
      ctx.capture('compaction', await ctx.settle());
      ctx.keys('C-o');
      ctx.capture('compaction-expanded', await ctx.settle());
      ctx.keys('C-o');
      if (ctx.product === 'pi') {
        await submit(ctx, '/tree');
        ctx.capture('compaction-tree', await ctx.settle());
        ctx.keys('Escape');
        await ctx.sleep(300);
      }
    },
  },
  {
    name: 'session-tree',
    only: 'pi',
    comparable: false,
    replies: { 'SCENE:session-tree': 'A branch for the session tree.' },
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, 'SCENE:session-tree');
      await ctx.waitFor((p) => p.includes('A branch'), 'session-tree-input');
      await submit(ctx, '/tree');
      ctx.capture('session-tree', await ctx.settle());
      ctx.keys('Escape');
      await ctx.sleep(300);
    },
  },
  ask('mermaid', '```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```', 'Finish'),
  {
    name: 'login-picker',
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, '/login');
      ctx.capture('login-picker', await ctx.settle());
      ctx.keys('Escape');
      await ctx.sleep(300);
    },
  },
  {
    name: 'fullscreen-search',
    replies: { 'SCENE:fullscreen-search': Array.from({ length: 90 }, (_, i) => `Capture paragraph ${i + 1}. Searchable bounded retries.`).join('\n\n') },
    async run(ctx) {
      await reset(ctx);
      if (ctx.product === 'pi') {
        await submit(ctx, '/settings');
        await ctx.sleep(600);
        ctx.type('Fullscreen scrollbar');
        await ctx.sleep(300);
        ctx.keys('Enter');
        await ctx.sleep(300);
        ctx.keys('Escape');
        await ctx.sleep(300);
      }
      await submit(ctx, 'SCENE:fullscreen-search');
      await ctx.waitFor((p) => p.includes('paragraph 90'), 'fullscreen-long');
      if (ctx.product === 'claude') {
        ctx.keys('C-o');
        await ctx.sleep(500);
      }
      ctx.keys('PPage');
      await ctx.sleep(500);
      ctx.capture('fullscreen-scrollbar', await ctx.settle());
      if (ctx.product === 'pi') ctx.keys('Escape', '[27;6;102~');
      else ctx.keys('/');
      await ctx.sleep(300);
      ctx.type('bounded');
      await ctx.sleep(500);
      ctx.capture('fullscreen-search', await ctx.settle());
      ctx.keys('Escape');
      if (ctx.product === 'claude') ctx.keys('C-o');
      await clearInput(ctx);
    },
  },
  typed('slash-autocomplete', '/', null),
  typed('shell-mode', '!ls', null),
  {
    name: 'shell-run',
    async run(ctx) {
      await reset(ctx);
      ctx.type('!');
      await ctx.sleep(300);
      ctx.type('ls');
      await ctx.sleep(200);
      ctx.keys('Enter');
      await ctx.waitFor((p) => p.includes('notes.txt'), 'shell-run');
      ctx.capture('shell-run', await ctx.settle());
    },
  },
  {
    name: 'model-picker',
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, '/model');
      await ctx.sleep(1500);
      ctx.capture('model-picker', await ctx.settle());
      ctx.keys('Escape');
      await ctx.sleep(500);
    },
  },
  ...['low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({
    name: `effort-${level}`,
    only: 'claude',
    async run(ctx) {
      await reset(ctx);
      await submit(ctx, `/effort ${level}`);
      await ctx.sleep(1200);
      ctx.capture(`effort-${level}`, await ctx.settle());
      if (level === 'max') {
        await submit(ctx, '/effort medium');
        await ctx.sleep(1200);
      }
    },
  })),
];

export function resolveReply(reply, body) {
  return typeof reply === 'function' ? reply(body) : reply;
}

export const ANIMATED_SCENES = SCENES.filter((scene) => scene.animated).map((scene) => scene.name);
