// biome-ignore-all lint/security/noSecrets: fixture prompts, not credentials
import { expect, test } from 'vitest';
import { buildCompressPrompt, buildFixPrompt, firstNonblankLine, isSmallerThanBody, maskCodeBlocks, notSmallerMessage, restoreCodeBlocks, splitFrontmatter, stripLlmWrapper } from '../../src/compress/text.ts';

const TREE = '# Tree\n\nProse before.\n\n```text\nroot\n├── src\n│   └── app.py\n```\n\n    indented()\n    code()\n\nProse after.\n';

test('splitFrontmatter separates an LF frontmatter block', () => {
  expect(splitFrontmatter('---\na: 1\n---\nbody\n')).toEqual({ frontmatter: '---\na: 1\n---\n', body: 'body\n' });
});
test('splitFrontmatter separates a CRLF frontmatter block', () => {
  expect(splitFrontmatter('---\r\na: 1\r\n---\r\nbody')).toEqual({ frontmatter: '---\r\na: 1\r\n---\r\n', body: 'body' });
});
test('splitFrontmatter ignores a dash rule not at the start', () => {
  expect(splitFrontmatter('no frontmatter\n---\n')).toEqual({ frontmatter: '', body: 'no frontmatter\n---\n' });
});
test('splitFrontmatter returns the empty string as body', () => {
  expect(splitFrontmatter('')).toEqual({ frontmatter: '', body: '' });
});

test('stripLlmWrapper leaves two separate blocks alone', () => {
  const text = '```bash\nnpm install\n```\n\nSome prose.\n\n```bash\nnpm test\n```';
  expect(stripLlmWrapper(text)).toBe(text);
});
test('stripLlmWrapper strips a real wrapper', () => {
  expect(stripLlmWrapper('```markdown\n# Title\n\nbody text\n```')).toBe('# Title\n\nbody text');
});
test('stripLlmWrapper strips a longer wrapper around inner fences', () => {
  expect(stripLlmWrapper('````markdown\n# Title\n\n```bash\nls\n```\n````')).toBe('# Title\n\n```bash\nls\n```');
});
test('stripLlmWrapper returns the empty string unchanged', () => {
  expect(stripLlmWrapper('')).toBe('');
});
test('stripLlmWrapper returns whitespace-only text unchanged', () => {
  expect(stripLlmWrapper('  \n \n')).toBe('  \n \n');
});
test('stripLlmWrapper keeps text whose last line is not a fence', () => {
  expect(stripLlmWrapper('```md\nbody\nend')).toBe('```md\nbody\nend');
});
test('stripLlmWrapper keeps mismatched fence characters', () => {
  expect(stripLlmWrapper('```md\nbody\n~~~')).toBe('```md\nbody\n~~~');
});
test('stripLlmWrapper keeps a closer with trailing text', () => {
  expect(stripLlmWrapper('```md\nbody\n``` tail')).toBe('```md\nbody\n``` tail');
});

test('maskCodeBlocks hides every code block', () => {
  const { masked, blocks } = maskCodeBlocks(TREE);
  expect([masked.includes('├── src'), masked.includes('indented()')]).toEqual([false, false]);
  expect(blocks.map((b) => b.block)).toEqual(['```text\nroot\n├── src\n│   └── app.py\n```\n', '    indented()\n    code()\n\n']);
});
test('restoreCodeBlocks round-trips masked text byte-exact', () => {
  const { masked, blocks } = maskCodeBlocks(TREE);
  expect(restoreCodeBlocks(masked, blocks)).toBe(TREE);
});
test('restoreCodeBlocks keeps prose edits around restored code', () => {
  const { masked, blocks } = maskCodeBlocks(TREE);
  const compressed = masked.replace('Prose before.', 'Before.').replace('Prose after.', 'After.');
  expect(restoreCodeBlocks(compressed, blocks)).toBe('# Tree\n\nBefore.\n\n```text\nroot\n├── src\n│   └── app.py\n```\n\n    indented()\n    code()\n\nAfter.\n');
});
test('maskCodeBlocks emits a hashed marker line', () => {
  const { masked, blocks } = maskCodeBlocks('```sh\necho safe\n```\n');
  expect(blocks.length).toBe(1);
  expect(/^@@CAVEMAN_PRESERVED_CODE_0_[0-9a-f]{16}@@\n$/.test(masked)).toBe(true);
});
test('maskCodeBlocks masks an unclosed fence to end of text', () => {
  const { masked, blocks } = maskCodeBlocks('intro\n```sh\necho');
  expect(blocks.map((b) => b.block)).toEqual(['```sh\necho']);
  expect(masked).toBe(`intro\n${blocks[0]?.marker}`);
});
test('maskCodeBlocks preserves a CRLF terminator on the marker', () => {
  const { masked, blocks } = maskCodeBlocks('```\r\nx\r\n```\r\n');
  expect(masked).toBe(`${blocks[0]?.marker}\r\n`);
  expect(restoreCodeBlocks(masked, blocks)).toBe('```\r\nx\r\n```\r\n');
});
test('maskCodeBlocks returns empty input unchanged', () => {
  expect(maskCodeBlocks('')).toEqual({ masked: '', blocks: [] });
});
test('maskCodeBlocks rejects input containing the reserved marker', () => {
  expect(() => maskCodeBlocks('x @@CAVEMAN_PRESERVED_CODE_ y')).toThrow('Input contains reserved Caveman code-preservation marker');
});
test('restoreCodeBlocks fails closed on a missing marker', () => {
  const { masked, blocks } = maskCodeBlocks('```sh\necho safe\n```\n');
  const marker = blocks[0]?.marker ?? '';
  expect(() => restoreCodeBlocks(masked.replace(marker, ''), blocks)).toThrow(`Claude changed preserved code marker ${marker}; refusing to write`);
});
test('restoreCodeBlocks fails closed on a duplicated marker', () => {
  const { masked, blocks } = maskCodeBlocks('```sh\necho safe\n```\n');
  const marker = blocks[0]?.marker ?? '';
  expect(() => restoreCodeBlocks(masked + marker, blocks)).toThrow(`Claude changed preserved code marker ${marker}; refusing to write`);
});
test('restoreCodeBlocks rejects an unknown marker', () => {
  expect(() => restoreCodeBlocks('@@CAVEMAN_PRESERVED_CODE_9_x@@', [])).toThrow('the model returned an unknown Caveman code-preservation marker');
});

test('isSmallerThanBody is true for a shorter stripped candidate', () => {
  expect(isSmallerThanBody('abc', '  abcd \n')).toBe(true);
});
test('isSmallerThanBody is false at equal length', () => {
  expect(isSmallerThanBody('abcd', 'abcd')).toBe(false);
});
test('isSmallerThanBody counts code points, not UTF-16 units', () => {
  expect(isSmallerThanBody('😀', 'ab')).toBe(true);
});
test('isSmallerThanBody is false when both are empty', () => {
  expect(isSmallerThanBody('', '   ')).toBe(false);
});
test('notSmallerMessage reports stripped lengths', () => {
  expect(notSmallerMessage(' abc ', 'ab')).toBe('Compression aborted: output is not smaller than input (3 >= 2 chars).');
});

test('firstNonblankLine returns the first stripped content line', () => {
  expect(firstNonblankLine('\n  \n  # Title  \nrest')).toBe('# Title');
});
test('firstNonblankLine returns empty for whitespace-only text', () => {
  expect(firstNonblankLine(' \n\t\n')).toBe('');
});

test('buildCompressPrompt is verbatim', () => {
  expect(buildCompressPrompt('BODY')).toBe(
    '\nCompress this markdown into caveman format.\n\nSTRICT RULES:\n- Do NOT modify anything inside ``` code blocks\n- Do NOT modify anything inside a 4-space-indented code block either — those are code too, and they are validated\n- Do NOT modify anything inside inline backticks\n- Preserve ALL URLs exactly\n- Preserve ALL headings exactly\n- Preserve file paths and commands\n- Return ONLY the compressed markdown body — do NOT wrap the entire output in a ```markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.\n\nOnly compress natural language.\n\nTEXT:\nBODY\n',
  );
});
test('buildFixPrompt is verbatim', () => {
  expect(buildFixPrompt('O', 'C', ['e1', 'e2'])).toBe(
    'You are fixing a caveman-compressed markdown file. Specific validation errors were found.\n\nCRITICAL RULES:\n- DO NOT recompress or rephrase the file\n- ONLY fix the listed errors — leave everything else exactly as-is\n- The ORIGINAL is provided as reference only (to restore missing content)\n- Preserve caveman style in all untouched sections\n\nERRORS TO FIX:\n- e1\n- e2\n\nHOW TO FIX:\n- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED\n- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED\n- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED\n- Do not touch any section not mentioned in the errors\n\nORIGINAL (reference only):\nO\n\nCOMPRESSED (fix this):\nC\n\nReturn ONLY the fixed compressed file. No explanation.\n',
  );
});
