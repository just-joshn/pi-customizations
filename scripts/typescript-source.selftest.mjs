import { strict as assert } from 'node:assert';

import { isJsxElement, isVariableStatement } from 'typescript/unstable/ast';
import { closeTypeScriptSources, withTypeScriptSource } from './typescript-source.mjs';

try {
  for (const extension of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'tsx', 'jsx']) {
    const text = extension.endsWith('x') ? 'const view = <div>hello</div>;' : 'const value = 1;';
    withTypeScriptSource(text, `fixture.${extension}`, (source) => {
      assert.equal(source.text, text);
      assert.equal(isVariableStatement(source.statements[0]), true);
      assert.equal(source.statements[0].getStart(source), 0);
      if (extension.endsWith('x')) assert.equal(isJsxElement(source.statements[0].declarationList.declarations[0].initializer), true);
    });
  }
  withTypeScriptSource('const replaced = 2;', 'fixture.ts', (source) => assert.equal(source.text, 'const replaced = 2;'));
  assert.throws(
    () =>
      withTypeScriptSource('', 'fixture.ts', () => {
        throw new Error('callback failed');
      }),
    /callback failed/,
  );
  withTypeScriptSource('', 'fixture.ts', (source) => assert.equal(source.statements.length, 0));
} finally {
  closeTypeScriptSources();
}
process.stdout.write('TypeScript native source selftest passed.\n');
