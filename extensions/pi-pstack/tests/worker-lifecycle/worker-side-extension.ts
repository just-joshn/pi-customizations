// Test-only Pi extension for workers: the pstack worker-side registration, with the test's spawn options for any
// workers a sub-coordinator starts.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerWorkerSideTools } from '../../src/workers.ts';

export default function workerSide(pi: ExtensionAPI): void {
  registerWorkerSideTools(pi, process.env, JSON.parse(process.env['PSTACK_TEST_WORKER_OPTIONS'] ?? '{}'));
}
