import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRpcSession } from '../lib/rpc.mjs';
import { PROVIDER, waitForValue } from '../scenarios/pstack-env-lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const raw = join(root, 'artifacts/user-perspective/f017-double-shutdown');
mkdirSync(raw, { recursive: true });
const results = [];
for (const secondShutdown of [false, true]) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pi-double-shutdown-')));
  const agentDir = join(scratch, 'agent');
  const trace = join(scratch, 'trace.txt');
  const rem = join(scratch, 'rem.txt');
  const fixture = join(scratch, 'blocker.ts');
  mkdirSync(join(agentDir, 'context-boards'), { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ quietStartup: true }));
  const boardName = createHash('sha1').update(scratch).digest('hex').slice(0, 16);
  writeFileSync(join(agentDir, 'context-boards', `${boardName}.json`), JSON.stringify({ probe: 'populated board' }));
  const recorder = join(scratch, 'pi-recorder');
  writeFileSync(recorder, `#!/bin/sh\nprintf 'consolidation launched\\n' >> ${JSON.stringify(rem)}\n`, { mode: 0o700 });
  writeFileSync(
    fixture,
    `import { appendFileSync } from 'node:fs';
export default function(pi) {
  pi.registerCommand('shutdown-probe', { handler: async (_args, ctx) => { ctx.shutdown(); } });
  pi.on('session_shutdown', async () => {
    appendFileSync(${JSON.stringify(trace)}, 'entered\\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    appendFileSync(${JSON.stringify(trace)}, 'completed\\n');
  });
}
`,
  );
  const name = secondShutdown ? 'double' : 'single';
  const session = createRpcSession({
    packagePath: fixture,
    extraExtensions: [join(root, 'extensions/pi-pstack'), PROVIDER],
    agentDir,
    cwd: scratch,
    capturePath: join(raw, `${name}-rpc.jsonl`),
    env: { COPILOT_SUBCONSCIOUS: '1', PSTACK_PI_COMMAND: recorder, PI_OFFLINE: '1' },
  });
  try {
    await session.commands();
    await session.send({ type: 'prompt', message: '/shutdown-probe' });
    await waitForValue(() => (existsSync(trace) ? readFileSync(trace, 'utf8') : undefined), { description: 'shutdown hook entry' });
    if (!secondShutdown) await waitForValue(() => (existsSync(rem) ? readFileSync(rem, 'utf8') : undefined), { description: 'consolidation launch' });
    await session.close();
    const result = { secondShutdown, trace: readFileSync(trace, 'utf8'), consolidationLaunched: existsSync(rem) };
    writeFileSync(join(raw, `${name}.json`), JSON.stringify(result, null, 2));
    results.push(result);
  } finally {
    await session.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
assert.equal(results[0].trace, 'entered\ncompleted\n');
assert.equal(results[0].consolidationLaunched, true);
assert.equal(results[1].trace, 'entered\n');
assert.equal(results[1].consolidationLaunched, false);
console.log(JSON.stringify({ pi: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), results }));
