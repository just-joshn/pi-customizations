import { createHash } from 'node:crypto';

import { countOccurrences, pyLen, pySplitlines, pySplitlinesKeepends, pyStrip, replaceFirst, S } from './py.ts';

const FENCE_LINE_REGEX = new RegExp(`^${S}{0,3}(\`{3,}|~{3,})`, 'u');
const FRONTMATTER_REGEX = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/;

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = FRONTMATTER_REGEX.exec(text);
  if (m === null) return { frontmatter: '', body: text };
  return { frontmatter: m[1] ?? '', body: m[2] ?? '' };
}

function sameFenceKind(fence: string, opener: string): boolean {
  return fence.charAt(0) === opener.charAt(0) && fence.length >= opener.length;
}

/** Strip an outer fence only when the first and last fence lines are one block. */
export function stripLlmWrapper(text: string): string {
  const lines = text.split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first < lines.length && pyStrip(lines[first] ?? '') === '') first++;
  while (last > first && pyStrip(lines[last] ?? '') === '') last--;
  if (first >= last) return text;
  const opener = FENCE_LINE_REGEX.exec(lines[first] ?? '')?.[1];
  const closer = FENCE_LINE_REGEX.exec(lines[last] ?? '')?.[1];
  if (opener === undefined || closer === undefined) return text;
  if (!sameFenceKind(closer, opener)) return text;
  if (pyStrip(lines[last] ?? '') !== closer) return text;
  const inner = lines.slice(first + 1, last);
  const nested = inner.some((line) => {
    const fence = FENCE_LINE_REGEX.exec(line)?.[1];
    return fence !== undefined && sameFenceKind(fence, opener);
  });
  return nested ? text : inner.join('\n');
}

export function buildCompressPrompt(original: string): string {
  return `
Compress this markdown into caveman format.

STRICT RULES:
- Do NOT modify anything inside \`\`\` code blocks
- Do NOT modify anything inside a 4-space-indented code block either — those are code too, and they are validated
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve file paths and commands
- Return ONLY the compressed markdown body — do NOT wrap the entire output in a \`\`\`markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.

Only compress natural language.

TEXT:
${original}
`;
}

export function buildFixPrompt(original: string, compressed: string, errors: readonly string[]): string {
  const errorsStr = errors.map((e) => `- ${e}`).join('\n');
  return `You are fixing a caveman-compressed markdown file. Specific validation errors were found.

CRITICAL RULES:
- DO NOT recompress or rephrase the file
- ONLY fix the listed errors — leave everything else exactly as-is
- The ORIGINAL is provided as reference only (to restore missing content)
- Preserve caveman style in all untouched sections

ERRORS TO FIX:
${errorsStr}

HOW TO FIX:
- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED
- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED
- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED
- Do not touch any section not mentioned in the errors

ORIGINAL (reference only):
${original}

COMPRESSED (fix this):
${compressed}

Return ONLY the fixed compressed file. No explanation.
`;
}

export const CODE_MARKER_PREFIX = '@@CAVEMAN_PRESERVED_CODE_';
const FENCE_OPEN_RE = /^[ ]{0,3}(`{3,}|~{3,})(?:[^\r\n]*)$/;

export type CodeBlock = { marker: string; block: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isIndentedLine(line: string): boolean {
  return line.startsWith('    ') || line.startsWith('\t');
}

function stripEol(line: string): string {
  return line.replace(/[\r\n]+$/, '');
}

/** Index just past the code block that opens at `start`. */
function codeBlockEnd(lines: readonly string[], start: number, fence: string | undefined): number {
  let i = start + 1;
  if (fence !== undefined) {
    const closeRe = new RegExp(`^[ ]{0,3}${escapeRegExp(fence.charAt(0))}{${fence.length},}[ \\t]*$`);
    while (i < lines.length) {
      const matched = closeRe.test(stripEol(lines[i] ?? ''));
      i++;
      if (matched) return i;
    }
    return i;
  }
  while (i < lines.length) {
    const candidate = stripEol(lines[i] ?? '');
    if (candidate !== '' && !isIndentedLine(candidate)) return i;
    i++;
  }
  return i;
}

function markerFor(block: string, index: number): string {
  const digest = createHash('sha256').update(block, 'utf8').digest('hex').slice(0, 16);
  return `${CODE_MARKER_PREFIX}${index}_${digest}@@`;
}

function trailingNewline(block: string): string {
  if (block.endsWith('\r\n')) return '\r\n';
  return block.endsWith('\n') ? '\n' : '';
}

/** Replace fenced and four-space-indented code with opaque line markers. */
export function maskCodeBlocks(text: string): { masked: string; blocks: CodeBlock[] } {
  if (text.includes(CODE_MARKER_PREFIX)) throw new Error('Input contains reserved Caveman code-preservation marker');
  const lines = pySplitlinesKeepends(text);
  const out: string[] = [];
  const blocks: CodeBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = stripEol(lines[i] ?? '');
    const fence = FENCE_OPEN_RE.exec(current)?.[1];
    if (fence === undefined && (current === '' || !isIndentedLine(current))) {
      out.push(lines[i] ?? '');
      i++;
      continue;
    }
    const end = codeBlockEnd(lines, i, fence);
    const block = lines.slice(i, end).join('');
    const marker = markerFor(block, blocks.length);
    blocks.push({ marker, block });
    out.push(marker + trailingNewline(block));
    i = end;
  }
  return { masked: out.join(''), blocks };
}

function restoreOne(text: string, { marker, block }: CodeBlock): string {
  if (countOccurrences(text, marker) !== 1) {
    throw new Error(`Claude changed preserved code marker ${marker}; refusing to write`);
  }
  // The marker carries its own transport newline; consume it so a block
  // that already ends in a newline does not gain a blank line.
  if (text.includes(`${marker}\r\n`)) return replaceFirst(text, `${marker}\r\n`, block);
  if (text.includes(`${marker}\n`)) return replaceFirst(text, `${marker}\n`, block);
  return replaceFirst(text, marker, block);
}

/** Restore markers exactly; fail closed if the model removed, copied, or altered one. */
export function restoreCodeBlocks(text: string, blocks: readonly CodeBlock[]): string {
  const restored = blocks.reduce(restoreOne, text);
  if (restored.includes(CODE_MARKER_PREFIX)) throw new Error('the model returned an unknown Caveman code-preservation marker');
  return restored;
}

/** Non-expansion invariant; must hold for every candidate, retries included. */
export function isSmallerThanBody(candidateBody: string, body: string): boolean {
  return pyLen(pyStrip(candidateBody)) < pyLen(pyStrip(body));
}

export function notSmallerMessage(candidateBody: string, body: string): string {
  return `Compression aborted: output is not smaller than input (${pyLen(pyStrip(candidateBody))} >= ${pyLen(pyStrip(body))} chars).`;
}

export function firstNonblankLine(text: string): string {
  return (
    pySplitlines(text)
      .map(pyStrip)
      .find((line) => line !== '') ?? ''
  );
}
