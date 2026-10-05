import { createScanner, SyntaxKind } from 'typescript/unstable/ast';

export function compilerOptionsText(text) {
  const scanner = createScanner(true, undefined, text);
  let depth = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (depth === 1 && token === SyntaxKind.StringLiteral && scanner.getTokenValue() === 'compilerOptions') {
      if (scanner.scan() !== SyntaxKind.ColonToken || scanner.scan() !== SyntaxKind.OpenBraceToken) throw new Error('compilerOptions must be an object');
      const start = scanner.getTokenStart();
      let nested = 1;
      while (nested > 0) {
        const next = scanner.scan();
        if (next === SyntaxKind.EndOfFile) throw new Error('Unclosed compilerOptions object');
        if (next === SyntaxKind.OpenBraceToken) nested += 1;
        if (next === SyntaxKind.CloseBraceToken) nested -= 1;
      }
      return text.slice(start, scanner.getTokenEnd());
    }
    if (token === SyntaxKind.OpenBraceToken) depth += 1;
    if (token === SyntaxKind.CloseBraceToken) depth -= 1;
  }
  throw new Error('Root config has no compilerOptions authority');
}
