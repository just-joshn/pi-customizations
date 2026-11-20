import type { JsonObject } from './json.ts';

/** One metric value pulled out of a run record, or undefined when the record lacks it. */
export type Extractor = (record: JsonObject) => number | undefined;
export interface Metric {
  readonly name: string;
  readonly extract: Extractor;
}
