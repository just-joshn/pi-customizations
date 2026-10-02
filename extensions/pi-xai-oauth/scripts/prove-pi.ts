import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_IDS = ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5', 'grok-4.7-low-fast', 'grok-4.7-medium-fast', 'grok-4.7-high-fast', 'grok-4.7-xhigh-fast'];
const PRINT_MODEL = 'grok-build/grok-4.7-xhigh-fast';
const TIMEOUT_MS = 120_000;

type Run = { readonly code: number; readonly output: string; readonly stdout: string };

function pi(args: readonly string[], agentDir: string): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = execFile('pi', ['--no-extensions', '-e', packageDir, ...args], { env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolveRun({ code, stdout, output: `${stdout}\n${stderr}` });
    });
    // Print mode reads piped stdin until it closes, so close it.
    child.stdin?.end();
  });
}

// Pi lists only models whose provider has auth, so an isolated agent dir with a fixture
// credential shows the catalog without touching any real login.
const agentDir = await mkdtemp(join(tmpdir(), 'pi-xai-oauth-'));
const accessToken = randomUUID();
try {
  const credential = { type: 'oauth', access: accessToken, refresh: randomUUID(), expires: Date.UTC(2100, 0, 1) };
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ 'grok-build': credential }), { mode: 0o600 });

  const listed = await pi(['--offline', '--list-models', 'grok-build'], agentDir);
  const listedIds = listed.stdout
    .split('\n')
    .filter((line) => line.startsWith('grok-build'))
    .map((line) => line.split(/\s+/)[1]);
  const missing = EXPECTED_IDS.filter((id) => !listedIds.includes(id));
  if (listed.code !== 0 || missing.length > 0) throw new Error(`pi --list-models did not list every grok-build model. Missing: ${missing.join(', ') || 'none'}.\nexit=${listed.code}\n${listed.output.replaceAll(accessToken, '[token]')}`);
  process.stdout.write(`pi --list-models lists ${listedIds.length} grok-build models: ${listedIds.join(', ')}\n`);

  // Pi does not fail on an unregistered model id. It warns "Using custom model id" and sends the
  // request anyway, so that warning is what shows the alias is missing. The proxy may answer,
  // reject the fixture token, or report an exhausted balance.
  const pinged = await pi(['--print', 'ping', '--model', PRINT_MODEL], agentDir);
  const output = pinged.output.replaceAll(accessToken, '[token]');
  if (output.includes('Unknown model') || output.includes('Using custom model id')) throw new Error(`pi did not resolve ${PRINT_MODEL}.\nexit=${pinged.code}\n${output}`);
  const firstLine = output.split('\n').find((line) => line.trim().length > 0) ?? 'no output';
  const outcome = pinged.code === 0 && pinged.stdout.trim().length > 0 ? `answered: ${pinged.stdout.trim()}` : `stopped with exit ${pinged.code}: ${firstLine}`;
  process.stdout.write(`pi resolved ${PRINT_MODEL} and ${outcome}\n`);
} finally {
  await rm(agentDir, { recursive: true, force: true });
}
