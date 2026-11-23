import { readFile } from 'node:fs/promises';

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createSearchToolsTool } from '../src/tools/catalog.ts';
import { htmlToText } from '../src/tools/web.ts';
import { createHarness, textOf } from './harness.ts';

type FetchLike = typeof globalThis.fetch;
type FetchInput = Parameters<FetchLike>[0];
type FetchInit = Parameters<FetchLike>[1];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

const stubFetch = (handler: (url: string) => Response): FetchLike => (async (input: FetchInput) => handler(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)) as FetchLike;

describe('htmlToText', () => {
  it('drops scripts, styles, and tags and decodes entities', () => {
    const html = '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>Title &amp; more</h1><p>First</p><p>Second &lt;tag&gt;</p></body></html>';
    const text = htmlToText(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Title & more');
    expect(text).toContain('First\nSecond <tag>');
  });
});

describe('web_fetch', () => {
  it('fetches JSON and pretty-prints it', async () => {
    const harness = await createHarness({ fetch: stubFetch(() => jsonResponse({ a: 1 })) });
    try {
      const result = await harness.call('web_fetch', { url: 'https://example.com/data' }, { hasUI: true });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('"a": 1');
      const details = result.details as { status?: number; contentType?: string };
      expect(details.status).toBe(200);
      expect(details.contentType).toContain('json');
    } finally {
      await harness.cleanup();
    }
  });

  it('reduces HTML to text and saves the body when asked', async () => {
    const harness = await createHarness({ fetch: stubFetch(() => textResponse('<p>Hello <b>world</b></p>', 'text/html')) });
    try {
      const result = await harness.call('web_fetch', { url: 'https://example.com/', saveTo: 'notes/page.txt' }, { hasUI: true });
      expect(textOf(result)).toContain('Hello');
      expect(await readFile(harness.file('notes/page.txt'), 'utf-8')).toBe('Hello world');
    } finally {
      await harness.cleanup();
    }
  });

  it('keeps a non-2xx response as a successful fetch with its status', async () => {
    const harness = await createHarness({ fetch: stubFetch(() => textResponse('missing', 'text/plain', 404)) });
    try {
      const result = await harness.call('web_fetch', { url: 'https://example.com/nope' }, { hasUI: true });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('404');
      expect((result.details as { status?: number }).status).toBe(404);
    } finally {
      await harness.cleanup();
    }
  });

  it('rejects an invalid URL and an unsupported scheme', async () => {
    const harness = await createHarness({ fetch: stubFetch(() => textResponse('x', 'text/plain')) });
    try {
      const invalid = await harness.call('web_fetch', { url: 'not a url' });
      expect(invalid.isError).toBe(true);
      expect(textOf(invalid)).toContain('Invalid URL');
      const scheme = await harness.call('web_fetch', { url: 'file:///etc/passwd' });
      expect(scheme.isError).toBe(true);
      expect(textOf(scheme)).toContain('Unsupported URL scheme');
    } finally {
      await harness.cleanup();
    }
  });

  it('applies deny rules, allowlist mode, and the approval prompt', async () => {
    const denied = await createHarness({ config: { rules: [{ kind: 'read', action: 'deny', pattern: 'https://blocked.example/**' }] }, fetch: stubFetch(() => textResponse('x', 'text/plain')) });
    try {
      const result = await denied.call('web_fetch', { url: 'https://blocked.example/page' }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Blocked by permissions configuration');
    } finally {
      await denied.cleanup();
    }

    const strict = await createHarness({ config: { mode: 'allowlist', rules: [{ kind: 'read', action: 'allow', pattern: 'https://allowed.example/**' }] }, fetch: stubFetch(() => textResponse('ok', 'text/plain')) });
    try {
      const allowed = await strict.call('web_fetch', { url: 'https://allowed.example/page' });
      expect(allowed.isError).toBeUndefined();
      const blocked = await strict.call('web_fetch', { url: 'https://other.example/page' });
      expect(blocked.isError).toBe(true);
    } finally {
      await strict.cleanup();
    }

    const prompted = await createHarness({ fetch: stubFetch(() => textResponse('ok', 'text/plain')) });
    try {
      const refused = await prompted.call('web_fetch', { url: 'https://example.com/x' });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('rejected');
      const approved = await prompted.call('web_fetch', { url: 'https://example.com/x' }, { hasUI: true });
      expect(approved.isError).toBeUndefined();
      expect(prompted.confirmations).toHaveLength(1);
    } finally {
      await prompted.cleanup();
    }
  });

  it('truncates only when the body exceeds the cap', async () => {
    const exact = new Uint8Array(2 * 1024 * 1024).fill(65);
    const atCap = await createHarness({ fetch: (async () => new Response(exact, { headers: { 'content-type': 'text/plain' } })) as FetchLike });
    try {
      const result = await atCap.call('web_fetch', { url: 'https://example.com/big' }, { hasUI: true });
      expect((result.details as { truncated?: boolean }).truncated).toBeUndefined();
    } finally {
      await atCap.cleanup();
    }

    const over = new Uint8Array(2 * 1024 * 1024 + 1).fill(65);
    const pastCap = await createHarness({ fetch: (async () => new Response(over, { headers: { 'content-type': 'text/plain' } })) as FetchLike });
    try {
      const result = await pastCap.call('web_fetch', { url: 'https://example.com/big' }, { hasUI: true });
      expect((result.details as { truncated?: boolean }).truncated).toBe(true);
      expect(textOf(result)).toContain('body truncated at');
    } finally {
      await pastCap.cleanup();
    }
  });

  it('reports a transport failure and a timeout', async () => {
    const failing = await createHarness({
      fetch: (async () => {
        throw new Error('network down');
      }) as FetchLike,
    });
    try {
      const result = await failing.call('web_fetch', { url: 'https://example.com/' }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('network down');
    } finally {
      await failing.cleanup();
    }

    const hanging = await createHarness({
      fetch: ((_input: FetchInput, init?: FetchInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as FetchLike,
    });
    try {
      const result = await hanging.call('web_fetch', { url: 'https://example.com/', timeoutMs: 1000 }, { hasUI: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('timed out');
    } finally {
      await hanging.cleanup();
    }
  });
});

describe('web_search', () => {
  it('reports how to configure a missing endpoint', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('web_search', { query: 'anything' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('web_search is not configured');
    } finally {
      await harness.cleanup();
    }
  });

  it('queries the configured endpoint, sends env headers, and normalizes results', async () => {
    const seen: { url?: string; headers?: unknown } = {};
    vi.stubEnv('PI_TOOLS_SEARCH_KEY', 'secret-token');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const harness = await createHarness({
      config: {
        rules: [{ kind: 'read', action: 'allow', pattern: 'https://search.example/**' }],
        web: { search: { url: 'https://search.example/find?q={query}', headers: { authorization: '$PI_TOOLS_SEARCH_KEY' } } },
      },
      env: { PI_TOOLS_SEARCH_KEY: 'secret-token' },
      fetch: (async (input: FetchInput, init?: FetchInit) => {
        seen.url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        seen.headers = init?.headers;
        return jsonResponse({
          results: [
            { title: 'One', url: 'https://one.example', snippet: 'first' },
            { title: 'Two', link: 'https://two.example', description: 'second' },
          ],
        });
      }) as FetchLike,
    });
    try {
      const result = await harness.call('web_search', { query: 'pi tools', limit: 1 });
      expect(result.isError).toBeUndefined();
      expect(seen.url).toBe('https://search.example/find?q=pi%20tools');
      expect(JSON.stringify(seen.headers)).toContain('secret-token');
      expect(textOf(result)).toContain('One');
      expect(textOf(result)).not.toContain('Two');
    } finally {
      await harness.cleanup();
    }
  });

  it('reads a references array and reports an empty result set', async () => {
    const harness = await createHarness({
      config: { rules: [{ kind: 'read', action: 'allow', pattern: 'https://search.example/**' }], web: { search: { url: 'https://search.example/find?q={query}', resultsPath: 'references' } } },
      fetch: stubFetch(() => jsonResponse({ references: [{ title: 'Ref', url: 'https://ref.example', chunk: 'body' }] })),
    });
    try {
      const result = await harness.call('web_search', { query: 'x' });
      expect(textOf(result)).toContain('Ref');
      expect(textOf(result)).toContain('body');
    } finally {
      await harness.cleanup();
    }

    const empty = await createHarness({
      config: { rules: [{ kind: 'read', action: 'allow', pattern: 'https://search.example/**' }], web: { search: { url: 'https://search.example/find?q={query}' } } },
      fetch: stubFetch(() => jsonResponse({ results: [] })),
    });
    try {
      const result = await empty.call('web_search', { query: 'nothing' });
      expect(textOf(result)).toContain('No results for nothing');
    } finally {
      await empty.cleanup();
    }
  });

  it('reports a failing endpoint and a non-JSON body', async () => {
    const failing = await createHarness({
      config: { rules: [{ kind: 'read', action: 'allow', pattern: 'https://search.example/**' }], web: { search: { url: 'https://search.example/?q={query}' } } },
      fetch: stubFetch(() => textResponse('down', 'text/plain', 503)),
    });
    try {
      const result = await failing.call('web_search', { query: 'x' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('503');
    } finally {
      await failing.cleanup();
    }

    const notJson = await createHarness({
      config: { rules: [{ kind: 'read', action: 'allow', pattern: 'https://search.example/**' }], web: { search: { url: 'https://search.example/?q={query}' } } },
      fetch: stubFetch(() => textResponse('<html>', 'text/html')),
    });
    try {
      const result = await notJson.call('web_search', { query: 'x' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('did not return JSON');
    } finally {
      await notJson.cleanup();
    }
  });
});

describe('save_resource', () => {
  it('writes a resource and reports its digest', async () => {
    const harness = await createHarness();
    try {
      const result = await harness.call('save_resource', { path: 'out/data.txt', content: 'payload' });
      expect(result.isError).toBeUndefined();
      expect(await readFile(harness.file('out/data.txt'), 'utf-8')).toBe('payload');
      expect((result.details as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await harness.cleanup();
    }
  });

  it('refuses to overwrite unless asked, writes base64, and honors permissions', async () => {
    const harness = await createHarness({ config: { rules: [{ kind: 'write', action: 'deny', pattern: '**/denied.bin' }] } });
    try {
      await harness.write('existing.txt', 'old');
      const refused = await harness.call('save_resource', { path: 'existing.txt', content: 'new' });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('already exists');
      const replaced = await harness.call('save_resource', { path: 'existing.txt', content: 'new', overwrite: true });
      expect(replaced.isError).toBeUndefined();
      expect(await readFile(harness.file('existing.txt'), 'utf-8')).toBe('new');

      const binary = await harness.call('save_resource', { path: 'out/bytes.bin', content: Buffer.from([1, 2, 3]).toString('base64'), encoding: 'base64' });
      expect(binary.isError).toBeUndefined();
      expect([...(await readFile(harness.file('out/bytes.bin')))]).toEqual([1, 2, 3]);

      const denied = await harness.call('save_resource', { path: 'denied.bin', content: 'x' });
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toContain('Blocked by permissions configuration');
    } finally {
      await harness.cleanup();
    }
  });
});

describe('search_tools', () => {
  const entries = [
    { name: 'apply_patch', description: 'Apply a multi-file patch with strict validation', parameters: { type: 'object', properties: { patch: { type: 'string' } } } },
    { name: 'git', description: 'Run a git subcommand through the local git executable', parameters: { type: 'object', properties: { subcommand: { type: 'string' } } } },
    { name: 'web_fetch', description: 'Fetch an absolute http(s) URL and return its text', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
  ];

  it('finds a tool, prints its schema, and activates it', async () => {
    const activated: string[][] = [];
    const tool = createSearchToolsTool({ entries: () => entries, active: () => ['read'], activate: (names) => activated.push([...names]) });
    const result = await tool.execute('call', { query: 'patch' }, undefined, undefined, {} as never);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Loaded tools: apply_patch');
    expect(text).toContain('"patch"');
    expect(activated).toEqual([['apply_patch']]);
  });

  it('reports already active matches, empty queries, and unknown queries', async () => {
    const tool = createSearchToolsTool({ entries: () => entries, active: () => entries.map((entry) => entry.name), activate: () => undefined });
    const active = await tool.execute('call', { query: 'git' }, undefined, undefined, {} as never);
    expect(active.content[0]?.type === 'text' ? active.content[0].text : '').toContain('already active');

    const blank = await tool.execute('call', { query: '  ' }, undefined, undefined, {} as never);
    expect(blank.content[0]?.type === 'text' ? blank.content[0].text : '').toContain('at least one word');

    const unknown = await tool.execute('call', { query: 'quantum' }, undefined, undefined, {} as never);
    expect(unknown.content[0]?.type === 'text' ? unknown.content[0].text : '').toContain('No tool matches');
  });
});
