import { buildFamilies } from './families/build.ts';
import { defineFamilyTests } from './lib/define.ts';

defineFamilyTests(buildFamilies);
