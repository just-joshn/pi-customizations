import type { Check } from '../lib/check.ts';
import type { RunSpec } from '../lib/driver.ts';
import type { Negative } from '../lib/mutate.ts';

export interface Family {
  id: string;
  title: string;
  /** The real-model prompt differs from the scripted one only when a model must be told what the fixture is. */
  spec: RunSpec;
  checks: Check[];
  negatives: Negative[];
  /** A tool the family needs that this machine may not have. Its absence is reported, never passed. */
  requires?: 'tlc';
  /** Checks that fail today because of a product defect. Each is asserted with test.fails, so fixing the defect turns the test red until this entry is removed. */
  knownDefects?: { checkId: string; defect: string }[];
}
