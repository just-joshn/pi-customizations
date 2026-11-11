import { fileURLToPath } from 'node:url';

import { readAgentResult, runCursorAgent } from '../../../extensions/pi-x-subscription-oauth/src/cursor/stream.ts';

process.env['PATH'] = `${fileURLToPath(new URL('./fakebin', import.meta.url))}:${process.env['PATH'] ?? ''}`;
const started = Date.now();
const run = await runCursorAgent(['--print', '--', 'hi'], undefined);
console.log('after', Math.round((Date.now() - started) / 1000), 's code', run.code, 'stdout', JSON.stringify(run.stdout), 'stderr', JSON.stringify(run.stderr), 'parsed', JSON.stringify(readAgentResult(run.stdout)));
