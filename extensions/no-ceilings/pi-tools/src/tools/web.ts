import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { RESOURCE_MAX_BYTES, WEB_FETCH_MAX_BYTES } from '../constants.ts';
import { LayerError, layerError } from '../core/errors.ts';
import { displayPath, resolveToolPath } from '../core/paths.ts';
import { withFileQueue } from '../core/queue.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, guardEgress, isProtectedIgnoreFile, type LayerSession, subjectsFor } from '../core/session.ts';
import { decodeBase64, sha256Hex } from '../core/text.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

/** Shared pre-write checks for the two tools that write tool output to disk. */
async function assertWritableTarget(session: LayerSession, target: string, cwd: string): Promise<void> {
  const ignoreFile = await session.ignore.describe(target);
  if (ignoreFile !== undefined) {
    throw layerError('permission_denied', `Path ${displayPath(cwd, target)} is filtered out by ${path.basename(ignoreFile)}`, { path: target });
  }
  if (await isProtectedIgnoreFile(session, target)) {
    throw layerError('permission_denied', `Blocked: ${path.basename(target)} is protected and cannot be changed by the agent`, { path: target });
  }
}

export interface WebContext {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
  /** Injected so tests can replace the network. */
  readonly fetch: typeof globalThis.fetch;
}

/* ------------------------------------------------------------------ fetch */

export const webFetchParameters = Type.Object({
  url: Type.String({ description: 'Absolute URL to fetch' }),
  saveTo: Type.Optional(Type.String({ description: 'Write the fetched body to this path (relative or absolute)' })),
  timeoutMs: Type.Optional(Type.Number({ description: 'Request budget in milliseconds (default: 30000)' })),
});

interface WebFetchParams {
  url: string;
  saveTo?: string;
  timeoutMs?: number;
}

export interface WebFetchDetails {
  readonly url?: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly bytes?: number;
  readonly truncated?: boolean;
  readonly savedTo?: string;
  readonly failure?: ToolFailure;
}

/** Turn an HTML document into readable text. Scripts, styles, and comments are dropped. */
export function htmlToText(html: string): string {
  let text = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const [only] = present;
  if (only !== undefined && present.length === 1) {
    return only;
  }
  if (present.length === 0) {
    return new AbortController().signal;
  }
  return AbortSignal.any(present);
}

/** Read a body up to a byte cap, stopping as soon as the signal aborts, whatever the stream does. */
async function readBodyCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (response.body === null) {
    return { text: '', bytes: 0, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortRejection(signal)]);
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      const remaining = maxBytes - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8').decode(merged), bytes, truncated };
}

/**
 * Fetch a URL one hop at a time so every redirect target passes the same egress gate as the original.
 * The caller's signal and the timeout apply to the body read as well as the headers.
 */
async function fetchGated(
  session: LayerSession,
  url: URL,
  ctx: LayerContext,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  headers?: Readonly<Record<string, string>>,
): Promise<{ response: Response; finalUrl: URL; body: { text: string; bytes: number; truncated: boolean } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const combined = combineSignals([controller.signal, signal]);
  try {
    let current = url;
    let response: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await guardEgress(session, current.toString(), ctx);
      response = await fetchImpl(current, { signal: combined, redirect: 'manual', ...(headers === undefined ? {} : { headers }) });
      const location = response.headers.get('location');
      if (!REDIRECT_STATUS.has(response.status) || location === null) {
        break;
      }
      if (hop === MAX_REDIRECTS) {
        throw layerError('error', `Too many redirects starting at ${url.toString()}`);
      }
      current = new URL(location, current);
      assertHttpScheme(current);
    }
    if (response === undefined) {
      throw layerError('error', `Fetch failed: no response for ${url.toString()}`);
    }
    const body = await readBodyCapped(response, WEB_FETCH_MAX_BYTES, combined);
    return { response, finalUrl: current, body };
  } finally {
    clearTimeout(timer);
  }
}

function validateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw layerError('invalid_arguments', `Invalid URL: ${raw}`, { hint: 'Pass an absolute http or https URL.' });
  }
  assertHttpScheme(parsed);
  return parsed;
}

function assertHttpScheme(parsed: URL): void {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw layerError('invalid_arguments', `Unsupported URL scheme: ${parsed.protocol}`, { hint: 'Only http and https are fetched.' });
  }
}

export function createWebFetchLayerTool(options: WebContext) {
  return {
    name: 'web_fetch',
    label: 'web_fetch',
    description:
      'Fetch an absolute http(s) URL and return its text. HTML is reduced to readable text, JSON is pretty-printed, and the body is capped at 2MB. The permission policy can deny a host, and the user is asked before egress in the default mode. Optionally saves the body to a file.',
    promptSnippet: 'Fetch a URL and return readable text, subject to permissions',
    promptGuidelines: ['Use web_fetch for a specific URL; save large bodies with saveTo instead of printing them.'],
    prepareArguments: prepareWith({ aliases: { link: 'url' }, numbers: ['timeoutMs'] }),
    parameters: webFetchParameters,
    defaultActive: false,
    execute: guarded<WebFetchParams, WebFetchDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx, signal }): Promise<ToolOutcome<WebFetchDetails>> => {
        const session = await options.session(ctx);
        const url = validateUrl(params.url);

        const timeoutMs = Math.max(1000, Math.min(120_000, Math.floor(params.timeoutMs ?? 30_000)));
        const timeoutController = new AbortController();
        const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
        timer.unref?.();
        let fetched: Awaited<ReturnType<typeof fetchGated>>;
        try {
          fetched = await fetchGated(session, url, ctx, options.fetch, signal, timeoutMs);
        } catch (error) {
          if (error instanceof LayerError) {
            throw error;
          }
          if (signal?.aborted === true) {
            throw layerError('rejected', 'Operation aborted');
          }
          if (timeoutController.signal.aborted) {
            throw layerError('timeout', `Request timed out after ${timeoutMs}ms: ${url.toString()}`);
          }
          throw layerError('error', `Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          clearTimeout(timer);
        }
        const { response, finalUrl, body } = fetched;

        const contentType = response.headers.get('content-type') ?? 'text/plain';
        const text = contentType.includes('html') ? htmlToText(body.text) : contentType.includes('json') ? prettyJson(body.text) : body.text;
        let savedTo: string | undefined;
        if (params.saveTo !== undefined) {
          const target = resolveToolPath(params.saveTo, ctx.cwd, session.home);
          await guard(session, { kind: 'write', subjects: await subjectsFor(target), action: 'save fetched body', ctx });
          await assertWritableTarget(session, target, ctx.cwd);
          await mkdir(path.dirname(target), { recursive: true });
          await withFileQueue(target, async () => {
            await writeFile(target, text, 'utf-8');
            const after = await readFile(target);
            if (sha256Hex(after) !== sha256Hex(Buffer.from(text, 'utf-8'))) {
              throw layerError('error', `Save verification failed: ${displayPath(ctx.cwd, target)} does not contain the fetched body.`, { path: target });
            }
          });
          savedTo = displayPath(ctx.cwd, target);
        }

        const notices: string[] = [];
        if (body.truncated) {
          notices.push(`body truncated at ${WEB_FETCH_MAX_BYTES} bytes`);
        }
        if (savedTo !== undefined) {
          notices.push(`saved to ${savedTo}`);
        }
        const head = `${finalUrl.toString()} returned ${response.status} ${response.statusText}`.trim();
        const footer = notices.length === 0 ? '' : `\n\n[${notices.join('. ')}]`;
        return {
          content: [{ type: 'text', text: `${head} (${contentType})\n\n${text}${footer}` }],
          details: { url: finalUrl.toString(), status: response.status, contentType, bytes: body.bytes, ...(body.truncated ? { truncated: true } : {}), ...(savedTo === undefined ? {} : { savedTo }) },
          structuredContent: { url: finalUrl.toString(), status: response.status, contentType, text, truncated: body.truncated },
        };
      },
      (params) => params.saveTo,
    ),
  };
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* ----------------------------------------------------------------- search */

export const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Search terms' }),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of references to return (default: 8)' })),
});

interface WebSearchParams {
  query: string;
  limit?: number;
}

export interface WebSearchReference {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebSearchDetails {
  readonly query?: string;
  readonly references?: readonly WebSearchReference[];
  readonly endpoint?: string;
  readonly failure?: ToolFailure;
}

function resolveEnvHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const resolved: Record<string, string> = { accept: 'application/json' };
  for (const [name, value] of Object.entries(headers ?? {})) {
    const match = /^\$([A-Z0-9_]+)$/.exec(value);
    const fromEnv = match?.[1] === undefined ? undefined : process.env[match[1]];
    resolved[name] = fromEnv ?? value;
  }
  return resolved;
}

function readPath(value: unknown, dotted: string | undefined): unknown {
  if (dotted === undefined || dotted === '') {
    return value;
  }
  return dotted.split('.').reduce<unknown>((current, key) => (current !== null && typeof current === 'object' && key in current ? (current as Record<string, unknown>)[key] : undefined), value);
}

function normalizeReferences(payload: unknown, resultsPath?: string): WebSearchReference[] {
  const candidate = resultsPath === undefined ? (readPath(payload, 'results') ?? readPath(payload, 'references') ?? payload) : readPath(payload, resultsPath);
  if (!Array.isArray(candidate)) {
    return [];
  }
  const references: WebSearchReference[] = [];
  for (const entry of candidate) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const url = typeof record['url'] === 'string' ? record['url'] : typeof record['link'] === 'string' ? record['link'] : '';
    if (url === '') {
      continue;
    }
    const title = typeof record['title'] === 'string' ? record['title'] : url;
    const snippet = typeof record['snippet'] === 'string' ? record['snippet'] : typeof record['chunk'] === 'string' ? record['chunk'] : typeof record['description'] === 'string' ? record['description'] : '';
    references.push({ title, url, snippet });
  }
  return references;
}

export function createWebSearchLayerTool(options: WebContext) {
  return {
    name: 'web_search',
    label: 'web_search',
    description:
      'Search the web through the endpoint configured in .pi/pi-tools.json under web.search. Returns references with a title, URL, and snippet. The permission policy can deny the host, and the user is asked before egress in the default mode. Without a configured endpoint the tool reports how to configure one.',
    promptSnippet: 'Search the web through a configured endpoint, subject to permissions',
    promptGuidelines: ['Use web_search for discovery and web_fetch to read a specific result.'],
    prepareArguments: prepareWith({ aliases: { q: 'query', search_term: 'query' }, numbers: ['limit'], strings: ['query'] }),
    parameters: webSearchParameters,
    defaultActive: false,
    execute: guarded<WebSearchParams, WebSearchDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<WebSearchDetails>> => {
        const session = await options.session(ctx);
        const configured = session.config.web?.search;
        if (configured === undefined) {
          throw layerError('error', 'web_search is not configured. Add web.search.url (and optional headers) to .pi/pi-tools.json.', {
            hint: 'The URL template receives {query}, for example https://api.example.com/search?q={query}.',
          });
        }
        const template = configured.url;
        const endpoint = template.includes('{query}') ? template.replaceAll('{query}', encodeURIComponent(params.query)) : `${template}${template.includes('?') ? '&' : '?'}q=${encodeURIComponent(params.query)}`;
        const url = validateUrl(endpoint);

        let fetched: Awaited<ReturnType<typeof fetchGated>>;
        try {
          fetched = await fetchGated(session, url, ctx, options.fetch, undefined, 15_000, resolveEnvHeaders(configured.headers));
        } catch (error) {
          if (error instanceof LayerError) {
            throw error;
          }
          throw layerError('error', `Search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { response, body } = fetched;
        if (!response.ok) {
          throw layerError('error', `Search endpoint returned ${response.status} ${response.statusText}: ${body.text.slice(0, 300)}`);
        }
        let payload: unknown;
        try {
          payload = JSON.parse(body.text);
        } catch {
          throw layerError('error', 'Search endpoint did not return JSON', { hint: 'Point web.search.url at a JSON endpoint returning results or references.' });
        }
        const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 8)));
        const references = normalizeReferences(payload, configured.resultsPath).slice(0, limit);
        if (references.length === 0) {
          return { content: [{ type: 'text', text: `No results for ${params.query}` }], details: { query: params.query, references: [], endpoint: url.origin } };
        }
        const text = references.map((reference, index) => `${index + 1}. ${reference.title}\n${reference.url}${reference.snippet === '' ? '' : `\n${reference.snippet}`}`).join('\n\n');
        return {
          content: [{ type: 'text', text }],
          details: { query: params.query, references, endpoint: url.origin },
          structuredContent: { query: params.query, references: references.map((reference) => ({ title: reference.title, url: reference.url, snippet: reference.snippet })) },
        };
      },
      () => undefined,
    ),
  };
}

/* ---------------------------------------------------------------- resource */

export const saveResourceParameters = Type.Object({
  path: Type.String({ description: 'Where to write the resource (relative or absolute)' }),
  content: Type.String({ description: 'Resource body. Text unless encoding is base64.' }),
  encoding: Type.Optional(Type.Union([Type.Literal('utf8'), Type.Literal('base64')], { description: 'How to decode content (default: utf8)' })),
  overwrite: Type.Optional(Type.Boolean({ description: 'Replace an existing file (default: false)' })),
});

interface SaveResourceParams {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  overwrite?: boolean;
}

export interface SaveResourceDetails {
  readonly path?: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly failure?: ToolFailure;
}

export function createSaveResourceLayerTool(options: WebContext) {
  return {
    name: 'save_resource',
    label: 'save_resource',
    description:
      'Save tool-produced content to a permitted local file. Refuses to overwrite an existing file unless overwrite is true, refuses paths the ignore files or permission policy exclude, verifies the bytes on disk, and reports the digest.',
    promptSnippet: 'Save generated content to a local file with permission checks',
    promptGuidelines: ['Use save_resource for output you want to keep; it refuses to clobber an existing file unless overwrite is true.'],
    prepareArguments: prepareWith({ aliases: PATH_ALIASES, booleans: ['overwrite'], strings: ['content'] }),
    parameters: saveResourceParameters,
    defaultActive: false,
    execute: guarded<SaveResourceParams, SaveResourceDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<SaveResourceDetails>> => {
        const session = await options.session(ctx);
        const target = resolveToolPath(params.path, ctx.cwd, session.home);
        await guard(session, { kind: 'write', subjects: await subjectsFor(target), action: 'save resource', ctx });
        await assertWritableTarget(session, target, ctx.cwd);
        const buffer = params.encoding === 'base64' ? decodeBase64(params.content) : Buffer.from(params.content, 'utf-8');
        if (buffer.byteLength > RESOURCE_MAX_BYTES) {
          throw layerError('error', `Resource is ${buffer.byteLength} bytes, above the ${RESOURCE_MAX_BYTES} byte cap. Nothing was written.`, { path: target });
        }
        const digest = sha256Hex(buffer);
        await withFileQueue(target, async () => {
          const existing = await stat(target).catch(() => undefined);
          if (existing !== undefined && params.overwrite !== true) {
            throw layerError('error', `${displayPath(ctx.cwd, target)} already exists. Nothing was written.`, { path: target, hint: 'Set overwrite to true to replace it.' });
          }
          await writeFile(target, buffer);
          const after = await readFile(target);
          if (sha256Hex(after) !== digest) {
            throw layerError('error', `Save verification failed: ${displayPath(ctx.cwd, target)} does not contain the resource bytes.`, { path: target });
          }
        });
        return {
          content: [{ type: 'text', text: `Saved ${buffer.byteLength} bytes to ${displayPath(ctx.cwd, target)}` }],
          details: { path: target, bytes: buffer.byteLength, sha256: digest },
          structuredContent: { path: target, bytes: buffer.byteLength, sha256: digest },
        };
      },
      (params) => params.path,
    ),
  };
}
