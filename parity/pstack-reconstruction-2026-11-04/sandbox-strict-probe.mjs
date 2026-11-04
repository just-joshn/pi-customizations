import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SandboxManager } from '../../extensions/pi-pstack/node_modules/@anthropic-ai/sandbox-runtime/dist/index.js';

const execute = promisify(execFile);
const policy = {
  network: { allowedDomains: [], deniedDomains: [], allowAllUnixSockets: false },
  filesystem: { denyRead: ['~/.npm/_logs', '~/.claude/debug'], allowWrite: [], denyWrite: ['/tmp/claude', '/private/tmp/claude'] },
};

try {
  console.log(JSON.stringify({ platform: process.platform, dependencies: SandboxManager.checkDependencies() }));
  await SandboxManager.initialize(policy);
  const command = await SandboxManager.wrapWithSandbox('printf STRICT-SANDBOX-OK', '/bin/bash', policy);
  const { stdout, stderr } = await execute('/bin/bash', ['-c', command], { timeout: 10_000 });
  console.log(JSON.stringify({ stdout, stderr }));
  if (stdout !== 'STRICT-SANDBOX-OK') throw new Error('The strict sandbox did not run the harmless command.');
} catch (error) {
  console.error(error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await SandboxManager.reset();
}
