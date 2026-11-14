import { describe, expect, test } from 'vitest';
import { violations } from '../scripts/type-discipline.ts';

describe('type-discipline', () => {
  test.for<[string, string]>([
    ['a type assertion', 'const n = value as number;'],
    ['an angle-bracket assertion', 'const n = <number>value;'],
    ['a double assertion', 'const n = value as unknown as number;'],
    ['a non-null assertion', 'const n = list[0]!;'],
    ['any', 'let n: any;'],
    ['a suppression comment', `// ${['@ts', 'expect-error'].join('-')}\nconst n: number = "x";`],
  ])('rejects %s', ([, source]) => {
    expect(violations('x.ts', source)).not.toEqual([]);
  });

  test('allows const assertions, satisfies, and checked narrowing', () => {
    expect(violations('x.ts', "const modes = ['a', 'b'] as const;\nconst config = { a: 1 } satisfies Record<string, number>;\nif (typeof value === 'string') value.length;")).toEqual([]);
  });
});
