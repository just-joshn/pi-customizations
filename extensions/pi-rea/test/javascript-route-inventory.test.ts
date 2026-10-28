import { expect, test } from 'vitest';
import { buildRouteInventory } from '../src/analysis/formats/javascript-route-inventory.mjs';

test('buildRouteInventory: empty candidates seal the measured js-compare left inventory_id', () => {
  const inventory = buildRouteInventory([
    {
      key: 'src/main.js',
      path: 'src/main.js',
      url: null,
      sha256: 'e7e2a42b20204248a9330eb6ec9aeaecb72fe12aab2c009c91330456cc69361e',
      container_sha256: 'ab140656924ac82690ec8be06424257028dc07ca2c227e72de6c418b3caaca2f',
      status: 'complete',
      reason: null,
      facts: { candidates: [], unresolved: [], capacity: null },
    },
  ]);

  expect(inventory.inventory_id).toBe('jsri:131b23ba6f8a4058e5714a31012760b293f3d305ee4178cc2181fc34302e89ed');
  expect(inventory.sources).toHaveLength(1);
  expect(inventory.sources[0]?.id).toBe('jss:079c06357f4ae5086eaf5b3400ec59f4');
  expect(inventory.routes).toStrictEqual([]);
  expect(inventory.statistics).toStrictEqual({
    sources_seen: 1,
    sources_retained: 1,
    route_patterns: 0,
    occurrences: 0,
    unanchored_literals_excluded: 0,
  });
  expect(inventory.coverage.candidate_enumeration).toBe('complete');
});
