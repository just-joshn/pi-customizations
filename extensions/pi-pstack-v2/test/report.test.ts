import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import pstack from '../src/index.ts';
import type { JobSpec } from '../src/jobs.ts';

test('parent wait and output retain real Pi answers when print stdout contains only a late correction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pstack-print-'));
  const id = 'scripted-000001';
  const dir = join(root, 'pstack-v2', 'jobs', id);
  const session = join(dir, 'session');
  mkdirSync(session, { recursive: true });
  const release = join(root, 'release');
  const sawLate = join(root, 'saw-late');
  const fixture = join(root, 'provider.ts');
  writeFileSync(
    fixture,
    `
import { existsSync, writeFileSync } from 'node:fs';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
export default function (pi) {
  const faux = fauxProvider({ provider: 'prov', models: [{ id: 'model' }] });
  faux.setResponses([
    fauxAssistantMessage('SUBSTANTIVE REPORT: initial verdict PASS'),
    context => {
      writeFileSync(${JSON.stringify(sawLate)}, String(JSON.stringify(context).includes('late-output')));
      return fauxAssistantMessage('CORRECTION: late result checked. ACK.');
    },
  ]);
  pi.registerProvider(faux.provider);
  let delivered = false;
  pi.on('agent_before_settle', async () => {
    if (delivered) return;
    while (!existsSync(${JSON.stringify(release)})) await new Promise(resolve => setTimeout(resolve, 10));
    delivered = true;
    return { entries: [{ type: 'custom_message', customType: 'pstack-job', content: 'late-output', display: true }], continue: true };
  });
}
`,
  );
  const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
  const command = [process.execPath, cli, '-p', '--no-extensions', '-e', fixture, '--session-dir', session, '--model', 'prov/model', 'Run the scripted check.'];
  const createdAt = new Date().toISOString();
  const child = spawn(process.execPath, command.slice(1), { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  try {
    await expect.poll(() => readdirSync(session).some((name) => readFileSync(join(session, name), 'utf8').includes('SUBSTANTIVE REPORT: initial verdict PASS')), { timeout: 20_000 }).toBe(true);
    expect(child.exitCode).toBeNull();
    writeFileSync(release, 'release');
    expect(await exited, stderr).toBe(0);
    expect(readFileSync(sawLate, 'utf8')).toBe('true');
    expect(stdout.trim()).toBe('CORRECTION: late result checked. ACK.');
    writeFileSync(join(dir, 'output.log'), stdout);
    writeFileSync(join(dir, 'exit'), '0');
    const spec: JobSpec = {
      id,
      name: 'scripted',
      kind: 'pi',
      cwd: root,
      argv: command,
      command,
      owner: 'parent',
      wake: null,
      brokered: false,
      out: dir,
      repeat: false,
      series: id,
      socket: '',
      sweep: { roots: [], protect: [] },
      createdAt,
      policy: { writable: [], protect: [], lock: [], gitDirs: [], checkouts: [], credentials: '', agentDir: root, jobDir: dir },
    };
    writeFileSync(join(dir, 'job.json'), JSON.stringify(spec));
    vi.stubEnv('PI_CODING_AGENT_DIR', root);
    vi.stubEnv('PSTACK_V2_SANDBOXED', '');
    const tools = new Map<string, Parameters<ExtensionAPI['registerTool']>[0]>();
    pstack({ on: () => {}, registerCommand: () => {}, registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
    const tool = tools.get('tmux_jobs');
    if (!tool) throw new Error('tmux_jobs missing');
    const ctx = { sessionManager: { getSessionId: () => 'parent' }, hasPendingMessages: () => false } as unknown as ExtensionToolContext;
    for (const action of ['wait', 'output']) {
      const result = await tool.execute('call', { action, ids: [id] }, undefined, undefined, ctx);
      const report = result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      expect(report).toMatch(/SUBSTANTIVE REPORT: initial verdict PASS[\s\S]*CORRECTION: late result checked\. ACK\./);
      expect(report).toContain(`Transcript: ${session}/`);
    }
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toBe(stdout);
  } finally {
    child.kill('SIGKILL');
    await exited;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
