import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const contentExclusionMessage = 'blocked by the content exclusion policy';
const Patterns = Type.Array(Type.String({ minLength: 1 }));
const gated = new Set(['read', 'grep', 'find', 'edit', 'write']);

/** Converts one glob with *, ** and ? into a regular expression over posix paths. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\0', '.*');
  return new RegExp(`(?:^|/)${escaped}$`, 'i');
}

export type ContentExclusionParse = Readonly<{ patterns: readonly string[]; problems: readonly string[] }>;

function settingsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

/**
 * Reads the exclusions a user can set at the top level of settings or under `subagents`. A present but malformed list is
 * reported instead of treated as empty, because an empty list would silently read the files the user meant to protect.
 */
export function parseContentExclusions(settings: unknown): ContentExclusionParse {
  const source = settingsOf(settings);
  const nested = settingsOf(source['subagents']);
  const patterns: string[] = [];
  const problems: string[] = [];
  const add = (owner: string, value: unknown) => {
    if (value === undefined) return;
    if (!Check(Patterns, value)) {
      problems.push(`${owner} must be an array of non-empty strings`);
      return;
    }
    for (const pattern of value) if (!patterns.includes(pattern)) patterns.push(pattern);
  };
  add('contentExclusions', source['contentExclusions']);
  add('subagents.contentExclusions', nested['contentExclusions']);
  return { patterns, problems };
}

export function isExcluded(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function excludedPath(patterns: readonly string[], toolName: string, input: unknown): string | undefined {
  if (!gated.has(toolName) || typeof input !== 'object' || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const candidates = ['path', 'file_path', 'pattern'].map((key) => record[key]).filter((value): value is string => typeof value === 'string');
  return candidates.find((value) => isExcluded(patterns, value));
}

/** The parent's content exclusion service is shared with the child: gated tools refuse excluded paths. */
export function contentExclusionExtension(patterns: readonly string[]): ExtensionFactory {
  return (pi) => {
    if (patterns.length === 0) return;
    pi.on('tool_call', (event) => {
      const path = excludedPath(patterns, event.toolName, event.input);
      return path ? { block: true, reason: `${path} ${contentExclusionMessage}` } : undefined;
    });
  };
}
