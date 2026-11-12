import { orchestrateFamilies } from './families/pr-orchestrate.ts';
import { defineFamilyTests } from './lib/define.ts';

defineFamilyTests(orchestrateFamilies);
