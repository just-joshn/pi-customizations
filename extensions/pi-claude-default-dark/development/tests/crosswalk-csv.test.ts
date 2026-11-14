import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { type CrosswalkRow, readCrosswalk, writeCrosswalk } from '../lib/crosswalk-csv.ts';

const row: CrosswalkRow = {
  pi_role: 'accent',
  pi_optional: '',
  claude_candidate_or_observation: 'say "hi", ok',
  pi_semantic_surface: 'line one\nline two',
  pi_color_direction: 'fg',
  mapping_class: '',
  public_renderer_required: '',
  reference_rgb: '',
  actual_rgb: '',
  parity_status: '',
  notes: '',
};
const header = 'pi_role,pi_optional,claude_candidate_or_observation,pi_semantic_surface,pi_color_direction,mapping_class,public_renderer_required,reference_rgb,actual_rgb,parity_status,notes';

describe('crosswalk CSV', () => {
  test('quotes, commas, and newlines survive a write and read', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cw-')), 'c.csv');
    writeCrosswalk(path, [row]);
    expect(readCrosswalk(path)).toEqual([row]);
  });
  test('a row with the wrong number of columns is rejected', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cw-')), 'c.csv');
    writeFileSync(path, `${header}\naccent,,x\n`);
    expect(() => readCrosswalk(path)).toThrow();
  });
});
