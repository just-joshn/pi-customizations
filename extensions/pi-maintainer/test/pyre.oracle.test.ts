import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { PY_SPACE } from '../src/support/pyre.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

test.for(oracleCases('pyre', 'pyre.whitespace', Type.Object({})))('PY_SPACE matches Python re \\s $id', async ({ expected }) => {
  expect(
    await outcomeOf(() => {
      const pattern = new RegExp(`^${PY_SPACE}$`, 'u');
      const codes: number[] = [];
      for (let code = 0; code < 0x110000; code += 1) {
        if (pattern.test(String.fromCodePoint(code))) codes.push(code);
      }
      return codes;
    }),
  ).toEqual(expected);
});
