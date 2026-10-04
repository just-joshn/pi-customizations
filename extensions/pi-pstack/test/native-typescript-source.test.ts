import { isJsxElement, isVariableStatement } from 'typescript/unstable/ast';
import { expect, onTestFinished, test } from 'vitest';
import { expectDefined } from './support/expect-defined.ts';
import { createTypeScriptSources } from './support/native-typescript-source.ts';

test.for(['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'tsx', 'jsx'])('native parsing preserves source text and syntax for %s', (extension) => {
  const sources = createTypeScriptSources();
  onTestFinished(sources.close);
  const jsx = extension.endsWith('x');
  const text = jsx ? 'const view = <div>hello</div>;' : 'const value = 1;';
  sources.withSource(text, `fixture.${extension}`, (source) => {
    expect(source.text).toBe(text);
    const statement = expectDefined(source.statements[0]);
    expect(isVariableStatement(statement)).toBe(true);
    expect(statement.getStart(source)).toBe(0);
    if (jsx) {
      if (!isVariableStatement(statement)) throw new Error('Expected a variable declaration');
      const initializer = expectDefined(expectDefined(statement.declarationList.declarations[0]).initializer);
      expect(isJsxElement(initializer)).toBe(true);
    }
  });
});

test('repeated paths parse new text instead of cached source', () => {
  const sources = createTypeScriptSources();
  onTestFinished(sources.close);
  expect(sources.withSource('const first = 1;', 'fixture.ts', (source) => source.text)).toBe('const first = 1;');
  expect(sources.withSource('const second = 2;', 'fixture.ts', (source) => source.text)).toBe('const second = 2;');
});

test('callback failures propagate and leave later parsing usable', () => {
  const sources = createTypeScriptSources();
  onTestFinished(sources.close);
  expect(() =>
    sources.withSource('', 'fixture.ts', () => {
      throw new Error('callback failed');
    }),
  ).toThrow('callback failed');
  expect(sources.withSource('', 'fixture.ts', (source) => source.statements.length)).toBe(0);
});
