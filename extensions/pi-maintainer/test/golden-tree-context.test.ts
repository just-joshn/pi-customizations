import { describe, expect, test } from 'vitest';
import { loadParser } from '../src/parsers.ts';
import { renderTreeContext } from '../src/tree-context.ts';
import { GOLDEN_SOURCES, goldenText } from './helpers/golden-fixtures.ts';

describe('renderTreeContext golden parity', () => {
  test('matches the recorded excerpt for the broken python file', async () => {
    const parser = await loadParser('python');
    const output = renderTreeContext('syntax_err.py', GOLDEN_SOURCES['syntax_err.py'], [0], (source) => parser.parse(source));
    expect(output).toBe(goldenText('tree-context-syntax-err-py.txt'));
  });

  test('matches the recorded excerpt for the undefined-name python file', async () => {
    const parser = await loadParser('python');
    const output = renderTreeContext('undef_name.py', GOLDEN_SOURCES['undef_name.py'], [1], (source) => parser.parse(source));
    expect(output).toBe(goldenText('tree-context-undef-name-py.txt'));
  });

  test('matches the recorded excerpt for the broken javascript file', async () => {
    const parser = await loadParser('javascript');
    const output = renderTreeContext('syntax_err.js', GOLDEN_SOURCES['syntax_err.js'], [0, 1], (source) => parser.parse(source));
    expect(output).toBe(goldenText('tree-context-syntax-err-js.txt'));
  });

  test('matches the recorded excerpt when no line numbers were found', async () => {
    const parser = await loadParser('python');
    const output = renderTreeContext('case.py', 'def broken(\n', [], (source) => parser.parse(source));
    expect(output).toBe(goldenText('tree-context-empty-lois.txt'));
  });

  test('matches the recorded excerpt for two distant marked lines', async () => {
    const parser = await loadParser('python');
    const code = `${Array.from({ length: 12 }, (_, index) => `line${index + 1} = ${index + 1}`).join('\n')}\n`;
    const output = renderTreeContext('case.py', code, [1, 10], (source) => parser.parse(source));
    expect(output).toBe(goldenText('tree-context-gap.txt'));
  });
});
