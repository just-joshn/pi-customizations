import { expect, test } from 'vitest';
import { countVisitedAstNodes } from '../src/analysis/formats/javascript-ast-count.mjs';

test('countVisitedAstNodes: matches measured 6.8.0 visit count for js-compare left main', () => {
  const source = `export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3 };
}
export const plain = { a: 1 };
`;
  expect(countVisitedAstNodes(source, 'src/main.js')).toBe(35);
});
