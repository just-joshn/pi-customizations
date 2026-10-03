import { describe, expect, test } from 'vitest';
import { loadParser } from '../src/parsers.ts';
import { renderTreeContext, treeContextExcerpt } from '../src/tree-context.ts';

describe('treeContextExcerpt', () => {
  test('marks the broken python line inside its enclosing scope', async () => {
    const parser = await loadParser('python');
    const code = 'def broken(\n    return 1\n';
    const excerpt = treeContextExcerpt({ code, lineNums: [0], parse: (source) => parser.parse(source) });
    expect(excerpt).toBe('  1█def broken(\n  2│    return 1\n');
  });

  test('shows the parent scope line above the marked line', async () => {
    const parser = await loadParser('python');
    const code = 'def ok():\n    return not_defined\n';
    const excerpt = treeContextExcerpt({ code, lineNums: [1], parse: (source) => parser.parse(source) });
    expect(excerpt).toBe('  1│def ok():\n  2█    return not_defined\n');
  });

  test('pads three context lines around a marked javascript line', async () => {
    const parser = await loadParser('javascript');
    const code = 'function broken( {\n  return 1;\n}\n';
    const excerpt = treeContextExcerpt({ code, lineNums: [0, 1], parse: (source) => parser.parse(source) });
    expect(excerpt).toBe('  1█function broken( {\n  2█  return 1;\n  3│}\n');
  });

  test('pads up to three lines around a deep marked line', async () => {
    const parser = await loadParser('javascript');
    const lines = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`);
    lines[10] = 'const broken = {;';
    const excerpt = treeContextExcerpt({ code: `${lines.join('\n')}\n`, lineNums: [10], parse: (source) => parser.parse(source) });
    const shown = excerpt.split('\n').filter((line) => line.length > 0);
    expect(shown[0]).toBe('...⋮...');
    expect(shown).toHaveLength(9);
    expect(excerpt).toContain(' 11█const broken = {;');
    expect(excerpt).toContain('  8│const v7 = 7;');
  });
});

describe('renderTreeContext', () => {
  test('uses the singular heading for one marked line', async () => {
    const parser = await loadParser('python');
    const code = 'def broken(\n    return 1\n';
    const output = renderTreeContext('syntax_err.py', code, [0], (source) => parser.parse(source));
    expect(output).toBe('## See relevant line below marked with █.\n\nsyntax_err.py:\n  1█def broken(\n  2│    return 1\n');
  });

  test('uses the plural heading for several marked lines', async () => {
    const parser = await loadParser('javascript');
    const code = 'function broken( {\n  return 1;\n}\n';
    const output = renderTreeContext('syntax_err.js', code, [0, 1], (source) => parser.parse(source));
    expect(output).toContain('## See relevant lines below marked with █.');
    expect(output).toContain('syntax_err.js:\n  1█function broken( {\n  2█  return 1;\n  3│}\n');
  });
});
