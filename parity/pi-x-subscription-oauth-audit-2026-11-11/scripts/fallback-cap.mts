import { readAgentResult, runCursorAgent } from '../../../extensions/pi-x-subscription-oauth/src/cursor/stream.ts';

// Run with fakebin first on PATH: a cursor-agent that answers successfully after 130 s.
// The package test "a quiet non-zero exit reports the process failure" (test/cursor.test.ts) shows that this
// run result (code 1, empty stdout and stderr) reaches the Pi user as "cursor-agent exited 1.".
const started = Date.now();
const run = await runCursorAgent(['--print', '--', 'hi'], undefined);
console.log('after', Math.round((Date.now() - started) / 1000), 's code', run.code, 'stdout', JSON.stringify(run.stdout), 'stderr', JSON.stringify(run.stderr), 'parsed', JSON.stringify(readAgentResult(run.stdout)));
