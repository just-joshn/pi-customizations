import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const userAgentDir = resolve(process.env.HOME ?? '', '.pi/agent');

function run(args, agentDir) {
  return new Promise((resolveRun, reject) => {
    execFile('pi', args, { env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, timeout: 60_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolveRun({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-xai-oauth-install-'));
if (resolve(agentDir) === userAgentDir) throw new Error('refusing to install into the user agent directory');
try {
  const installed = await run(['install', packageDir, '--no-approve'], agentDir);
  if (installed.code !== 0) throw new Error(`install failed\n${installed.output}`);
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ 'grok-build': { type: 'oauth', access: 'fixture', refresh: 'fixture', expires: 4102444800000 } }), { mode: 0o600 });
  const listed = await run(['--offline', '--list-models', 'grok-build', '--no-approve'], agentDir);
  if (!listed.output.includes('grok-build') || !listed.output.includes('grok-4.7-build-fast')) {
    throw new Error(`installed package did not list grok-build\n${listed.output}`);
  }
  const removed = await run(['remove', packageDir, '--no-approve'], agentDir);
  if (removed.code !== 0) throw new Error(`remove failed\n${removed.output}`);
  const after = await run(['--offline', '--list-models', 'grok-build', '--no-approve'], agentDir);
  if (after.output.includes('grok-4.7-build-fast')) throw new Error(`remove left grok-build models listed\n${after.output}`);
  process.stdout.write('prove-install: isolated install listed grok-build, and remove cleared it\n');
} finally {
  await rm(agentDir, { recursive: true, force: true });
}
