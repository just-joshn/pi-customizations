import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.ts');
const model = 'google-antigravity/gemini-3.1-pro-low';

async function pi(args: string[], env = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn('pi', ['--no-extensions', '-e', extension, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number>((resolveCode, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolveCode(status ?? 1));
  });
  return { code, stdout, stderr };
}

// Pi lists only models whose provider has auth. An isolated, offline agent dir
// with a placeholder credential shows the catalog without touching real logins.
const agentDir = mkdtempSync(join(tmpdir(), 'pi-antigravity-'));
writeFileSync(
  join(agentDir, 'auth.json'),
  JSON.stringify({
    'google-antigravity': { type: 'oauth', access: 'placeholder', refresh: 'placeholder', expires: 4102444800000, projectId: 'placeholder' },
  }),
);
const listed = await pi(['--offline', '--list-models'], { ...process.env, PI_CODING_AGENT_DIR: agentDir }).finally(() => rmSync(agentDir, { recursive: true, force: true }));
const listedIds = listed.stdout
  .split('\n')
  .filter((line) => line.startsWith('google-antigravity'))
  .map((line) => line.split(/\s+/)[1]);
if (listed.code !== 0 || !listedIds.includes('gemini-3.1-pro-low') || !listedIds.includes('claude-sonnet-4-6')) {
  throw new Error(`pi --list-models did not list google-antigravity models.\nexit=${listed.code}\n${listed.stdout}\n${listed.stderr}`);
}
console.log(`pi --list-models lists ${listedIds.length} google-antigravity models: ${listedIds.join(', ')}`);

const pinged = await pi(['--print', 'ping', '--model', model]);
const output = `${pinged.stdout}\n${pinged.stderr}`;
const askedForLogin = output.includes('No API key found for google-antigravity');
const answered = pinged.code === 0 && pinged.stdout.trim().length > 0;
if (output.includes('Unknown model') || (!askedForLogin && !answered)) {
  throw new Error(`pi did not resolve ${model}.\nexit=${pinged.code}\n${output}`);
}
console.log(askedForLogin ? `pi resolved ${model} and asked for login` : `pi answered through ${model}: ${pinged.stdout.trim()}`);
