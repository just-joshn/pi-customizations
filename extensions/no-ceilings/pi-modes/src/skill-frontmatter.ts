import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { normalizeModeColorId, normalizeModeIcon } from './mode-colors.ts';
import { type ModeColorId, ONE, ZERO } from './types.ts';

const FRONTMATTER_FENCE = '---';
const FRONTMATTER_OPEN_LEN = 4;
const KEY_PATTERN_SUFFIX = '\\s*:';
const EMPTY_BLOCK_LINES = 1;
const SKILL_FILE_NAME = 'SKILL.md';
const MARKDOWN_EXT = '.md';
const BLOCK_SCALAR_HEADER = /^[>|][+-]?\d?\s*(?:#.*)?$/;
const FLOW_OPEN = '{';
const FLOW_CLOSE = '}';
const FLOW_KEY_SEPARATOR = ':';
const LIST_OPEN = '[';
const LIST_CLOSE = ']';
const FLOW_ENTRY_SEPARATOR = ',';
const TEMP_SUFFIX_SEPARATOR = '.pi-modes-';
const TEMP_SUFFIX_EXT = '.tmp';

export interface SkillAppearance {
  readonly icon: string | undefined;
  readonly colorId: ModeColorId;
}

export interface SkillDocument extends SkillAppearance {
  readonly name: string;
  readonly label: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly body: string;
}

export interface SkillAppearancePatch {
  readonly icon?: string;
  readonly color?: string;
}

function readMetadataValue(frontmatter: Readonly<Record<string, unknown>>, key: string): unknown {
  const metadata = frontmatter['metadata'];
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return undefined;
  }
  return (metadata as Readonly<Record<string, unknown>>)[key];
}

function readAppearanceValue(frontmatter: Readonly<Record<string, unknown>>, key: string): unknown {
  const direct = frontmatter[key];
  return direct === undefined ? readMetadataValue(frontmatter, key) : direct;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > ZERO ? trimmed : undefined;
}

function capitalizeLabel(raw: string): string {
  const head = raw.slice(ZERO, ONE).toUpperCase();
  return `${head}${raw.slice(ONE)}`;
}

function readLabel(frontmatter: Readonly<Record<string, unknown>>, fallbackName: string): string {
  return readTrimmedString(frontmatter['title']) ?? capitalizeLabel(readTrimmedString(frontmatter['name']) ?? fallbackName);
}

export function parseSkillAppearance(frontmatter: Readonly<Record<string, unknown>>): SkillAppearance {
  return {
    icon: normalizeModeIcon(readAppearanceValue(frontmatter, 'icon')),
    colorId: normalizeModeColorId(readAppearanceValue(frontmatter, 'color')),
  };
}

export async function readSkillDocument(filePath: string, fallbackName: string): Promise<SkillDocument> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
    return {
      name: readTrimmedString(frontmatter['name']) ?? fallbackName,
      label: readLabel(frontmatter, fallbackName),
      filePath,
      baseDir: dirname(filePath),
      body: body.trim(),
      ...parseSkillAppearance(frontmatter),
    };
  } catch (error) {
    throw new Error(`Unable to read the skill file at ${filePath}`, { cause: error });
  }
}

/**
 * Mirrors the block Pi expands for `/skill:<name>`, so injected skill content is indistinguishable
 * from a user-invoked skill.
 */
export function formatSkillBlock(skill: Pick<SkillDocument, 'name' | 'filePath' | 'baseDir' | 'body'>): string {
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${skill.body}\n</skill>`;
}

export function isSkillFile(filePath: string): boolean {
  return basename(filePath) === SKILL_FILE_NAME;
}

function splitFrontmatterBlock(content: string): { readonly lines: readonly string[]; readonly tail: string } | undefined {
  if (!content.startsWith(FRONTMATTER_FENCE)) {
    return undefined;
  }
  const closingIndex = content.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_FENCE.length);
  if (closingIndex < ZERO) {
    return undefined;
  }
  const block = content.slice(FRONTMATTER_OPEN_LEN, closingIndex);
  const lines = block.split('\n');
  return { lines: lines.length === EMPTY_BLOCK_LINES && lines[ZERO] === '' ? [] : lines, tail: content.slice(closingIndex) };
}

function splitFlowEntries(inner: string): readonly string[] {
  const entries: string[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = ZERO;
  for (let index = ZERO; index < inner.length; index += ONE) {
    const char = inner[index] ?? '';
    if (quote !== undefined) {
      current += char;
      if (char === '\\') {
        const next = inner[index + ONE];
        if (next !== undefined) {
          current += next;
          index += ONE;
        }
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === FLOW_OPEN || char === LIST_OPEN) {
      depth += ONE;
    } else if (char === FLOW_CLOSE || char === LIST_CLOSE) {
      depth -= ONE;
    } else if (char === FLOW_ENTRY_SEPARATOR && depth === ZERO) {
      entries.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > ZERO) {
    entries.push(current.trim());
  }
  return entries;
}

function expandFlowFrontmatter(lines: readonly string[]): readonly string[] {
  if (lines.length !== EMPTY_BLOCK_LINES) {
    return lines;
  }
  const line = (lines[ZERO] ?? '').trim();
  if (!line.startsWith(FLOW_OPEN) || !line.endsWith(FLOW_CLOSE)) {
    return lines;
  }
  const inner = line.slice(ONE, -ONE).trim();
  if (inner.length === ZERO) {
    return [];
  }
  return splitFlowEntries(inner).map((entry) => {
    const colon = entry.indexOf(FLOW_KEY_SEPARATOR);
    return colon < ZERO ? entry : `${entry.slice(ZERO, colon).trim()}: ${entry.slice(colon + ONE).trim()}`;
  });
}

function rewriteFrontmatter(content: string, mutate: (lines: readonly string[]) => readonly string[]): string {
  const lineEnding = content.includes('\r\n') ? '\r\n' : content.includes('\r') ? '\r' : '\n';
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const split = splitFrontmatterBlock(normalized);
  const updated = !split ? `${FRONTMATTER_FENCE}\n${mutate([]).join('\n')}\n${FRONTMATTER_FENCE}\n\n${normalized}` : `${FRONTMATTER_FENCE}\n${mutate(expandFlowFrontmatter(split.lines)).join('\n')}${split.tail}`;
  return updated.replace(/\n/g, lineEnding);
}

function keyPattern(key: string): RegExp {
  return new RegExp(`^${key}${KEY_PATTERN_SUFFIX}`);
}

function lineIndent(line: string): number {
  let index = ZERO;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) {
    index += ONE;
  }
  return index;
}

function valueAfterColon(line: string): string {
  const colon = line.indexOf(':');
  return colon < ZERO ? '' : line.slice(colon + ONE).trim();
}

function scalarSpanEnd(lines: readonly string[], index: number): number {
  if (!BLOCK_SCALAR_HEADER.test(valueAfterColon(lines[index] ?? ''))) {
    return index + ONE;
  }
  const keyIndent = lineIndent(lines[index] ?? '');
  let end = index + ONE;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (line.trim().length === ZERO || lineIndent(line) > keyIndent) {
      end += ONE;
      continue;
    }
    break;
  }
  return end;
}

function replaceFrontmatterKey(lines: readonly string[], key: string, replacement: readonly string[] | undefined): readonly string[] {
  const pattern = keyPattern(key);
  const next: string[] = [];
  let index = ZERO;
  let wrote = false;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!pattern.test(line)) {
      next.push(line);
      index += ONE;
      continue;
    }
    if (!wrote && replacement !== undefined) {
      next.push(...replacement);
      wrote = true;
    }
    index = scalarSpanEnd(lines, index);
  }
  return !wrote && replacement !== undefined ? [...replacement, ...lines] : next;
}

function setFrontmatterString(content: string, key: string, value: string): string {
  const entry = `${key}: ${JSON.stringify(value)}`;
  return rewriteFrontmatter(content, (lines) => replaceFrontmatterKey(lines, key, [entry]));
}

function removeFrontmatterKey(content: string, key: string): string {
  return rewriteFrontmatter(content, (lines) => replaceFrontmatterKey(lines, key, undefined));
}

function applyPatch(content: string, patch: SkillAppearancePatch): string {
  const withIcon = patch.icon === undefined ? content : patch.icon.length > ZERO ? setFrontmatterString(content, 'icon', patch.icon) : removeFrontmatterKey(content, 'icon');
  if (patch.color === undefined) {
    return withIcon;
  }
  return patch.color.length > ZERO ? setFrontmatterString(withIcon, 'color', patch.color) : removeFrontmatterKey(withIcon, 'color');
}

export async function writeSkillAppearance(filePath: string, patch: SkillAppearancePatch, discoveredPath?: string): Promise<void> {
  if (!isSkillFile(filePath) && !(filePath.endsWith(MARKDOWN_EXT) && filePath === discoveredPath)) {
    throw new Error(`Refusing to write mode appearance outside a ${SKILL_FILE_NAME} file or a skill Pi discovered: ${filePath}`);
  }
  const tempPath = `${filePath}${TEMP_SUFFIX_SEPARATOR}${process.pid}${TEMP_SUFFIX_EXT}`;
  try {
    const raw = await readFile(filePath, 'utf-8');
    const updated = applyPatch(raw, patch);
    parseFrontmatter(updated);
    await writeFile(tempPath, updated, 'utf-8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error(`Unable to update the mode appearance in ${filePath}`, { cause: error });
  }
}
