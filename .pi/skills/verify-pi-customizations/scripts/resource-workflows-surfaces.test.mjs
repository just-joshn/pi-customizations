import assert from 'node:assert/strict';
import test from 'node:test';

import { surfaceContract } from '../helpers/resource-workflows-surfaces.mjs';

test('header names distinguish expected behavior from source after reordering', () => {
  assert.deepEqual(surfaceContract('source\texpected\tsurface_id\ncontract.md:1\tRun the owned app\tROW\n', 'ROW'), {
    surfaceId: 'ROW',
    expected: 'Run the owned app',
    source: 'contract.md:1',
  });
});

for (const [name, table] of [
  ['missing expected column', 'surface_id\tsource\nROW\tcontract.md'],
  ['duplicate expected column', 'surface_id\texpected\texpected\tsource\nROW\tRun\tRun\tcontract.md'],
  ['missing row', 'surface_id\texpected\tsource\nOTHER\tRun\tcontract.md'],
  ['duplicate row', 'surface_id\texpected\tsource\nROW\tRun\tcontract.md\nROW\tRun\tcontract.md'],
  ['empty expectation', 'surface_id\texpected\tsource\nROW\t\tcontract.md'],
]) {
  test(`rejects ${name} instead of emitting a misleading receipt`, () => {
    assert.throws(() => surfaceContract(table, 'ROW'));
  });
}
