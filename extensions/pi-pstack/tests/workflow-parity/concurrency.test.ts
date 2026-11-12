import { concurrencyFamily } from './families/concurrency.ts';
import { defineFamilyTests } from './lib/define.ts';

defineFamilyTests([concurrencyFamily]);
