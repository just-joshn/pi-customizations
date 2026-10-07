import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import { pySplitlines, pyStrip, pySuffix, S, W } from './py.ts';

export type FileType = 'natural_language' | 'code' | 'config' | 'unknown';

// `.mdc` is a Cursor rule: prose with YAML frontmatter. Content sniffing runs
// only for extensionless files, so an unlisted extension is never compressed.
export const COMPRESSIBLE_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.mdc', '.txt', '.markdown', '.rst', '.typ', '.typst', '.tex']);

export const SKIP_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.env',
  '.lock',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.lua',
  '.dockerfile',
  '.makefile',
  '.csv',
  '.ini',
  '.cfg',
]);

const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env']);

// Checked before extensions: `Dockerfile` has no suffix and `CMakeLists.txt`
// would otherwise ride the compressible `.txt` rule.
export const KNOWN_CODE_FILENAMES: ReadonlySet<string> = new Set([
  'dockerfile',
  'containerfile',
  'makefile',
  'gnumakefile',
  'jenkinsfile',
  'vagrantfile',
  'rakefile',
  'gemfile',
  'justfile',
  'procfile',
  'brewfile',
  'earthfile',
  'fastfile',
  'podfile',
  'cmakelists.txt',
]);

const CODE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^${S}*(import |from [^\\n]+ import |require\\(|const |let |var )`, 'u'),
  new RegExp(`^${S}*(def |class |function |async function |export )`, 'u'),
  new RegExp(`^${S}*(if${S}*\\(|for${S}*\\(|while${S}*\\(|switch${S}*\\(|try${S}*\\{)`, 'u'),
  new RegExp(`^${S}*[}\\]);]+${S}*$`, 'u'),
  new RegExp(`^${S}*@${W}+`, 'u'),
  new RegExp(`^${S}*"[^"]+"${S}*:${S}*`, 'u'),
  new RegExp(`^${S}*${W}+${S}*=${S}*[{\\[("']`, 'u'),
];

const YAML_KEY = new RegExp(`^${W}[\\p{L}\\p{N}_${S.slice(1, -1)}]*:${S}`, 'u');

function isCodeLine(line: string): boolean {
  return CODE_PATTERNS.some((p) => p.test(line));
}

function isJsonContent(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isYamlContent(lines: readonly string[]): boolean {
  const head = lines.slice(0, 30);
  let indicators = 0;
  for (const line of head) {
    const stripped = pyStrip(line);
    if (stripped.startsWith('---')) indicators++;
    else if (YAML_KEY.test(stripped)) indicators++;
    else if (stripped.startsWith('- ') && stripped.includes(':')) indicators++;
  }
  const nonEmpty = head.filter((l) => pyStrip(l) !== '').length;
  return nonEmpty > 0 && indicators / nonEmpty > 0.6;
}

function readTextLossy(path: string): string | undefined {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(path)).replaceAll('\ufffd', '');
  } catch {
    return undefined;
  }
}

/**
 * Classify a file. `text` is only consulted for extensionless files; when
 * omitted it is read from disk (failures yield `unknown`).
 */
export function detectFileType(path: string, text?: string): FileType {
  const name = basename(path);
  const ext = pySuffix(name).toLowerCase();

  if (KNOWN_CODE_FILENAMES.has(name.toLowerCase())) return 'code';
  if (COMPRESSIBLE_EXTENSIONS.has(ext)) return 'natural_language';
  if (SKIP_EXTENSIONS.has(ext)) return CONFIG_EXTENSIONS.has(ext) ? 'config' : 'code';

  if (ext !== '') return 'unknown';

  const content = text ?? readTextLossy(path);
  if (content === undefined) return 'unknown';

  const lines = pySplitlines(content).slice(0, 50);
  if (content.startsWith('#!')) return 'code';
  if (isJsonContent(Array.from(content).slice(0, 10000).join(''))) return 'config';
  if (isYamlContent(lines)) return 'config';

  const nonEmptyLines = lines.filter((l) => pyStrip(l) !== '');
  const codeLines = nonEmptyLines.filter(isCodeLine).length;
  if (nonEmptyLines.length > 0 && codeLines / nonEmptyLines.length > 0.4) return 'code';
  return 'natural_language';
}

export function shouldCompress(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  if (basename(path).endsWith('.original.md')) return false;
  return detectFileType(path) === 'natural_language';
}
