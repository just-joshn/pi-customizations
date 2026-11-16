import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import pstack from '../src/index.ts';
import { tmuxSocket } from '../src/jobs.ts';

test('parent wait and output retain a real print-mode worker report and correction after a nested job wakes it', async () => {
  const agentDir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-report-agent-')));
  let repo: string | undefined;
  const owner = `report${process.pid}`;
  const savedArgv = process.argv[1] ?? '';
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
  const tools = new Map<string, Parameters<ExtensionAPI['registerTool']>[0]>();
  let ctx: ExtensionToolContext | undefined;
  try {
    repo = realpathSync(mkdtempSync(join(homedir(), '.pstack-report-repo-')));
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    vi.stubEnv('PSTACK_V2_SANDBOXED', '');
    mkdirSync(join(agentDir, 'extensions'));
    const runtime = fileURLToPath(new URL('../src/index.ts', import.meta.url));
    const release = join(repo, 'release');
    const sawLate = join(repo, 'saw-late');
    writeFileSync(
      join(agentDir, 'extensions', 'scripted.ts'),
      `
import { writeFileSync } from 'node:fs';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import pstack from ${JSON.stringify(runtime)};
export default function (pi) {
  pstack(pi);
  const faux = fauxProvider({ provider: 'prov', models: [{ id: 'model' }] });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('tmux_run', { name: 'late', command: ${JSON.stringify(`while [ ! -e '${release}' ]; do sleep 0.1; done; echo late-output`)}, wake: 'Late result.' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('SUBSTANTIVE REPORT: initial verdict PASS'),
    context => {
      writeFileSync(${JSON.stringify(sawLate)}, String(JSON.stringify(context).includes('late-output')));
      return fauxAssistantMessage('CORRECTION: late result checked. ACK.');
    },
  ]);
  pi.registerProvider(faux.provider);
}
`,
    );
    pstack({
      on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(event, handler),
      registerCommand: () => {},
      registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => tools.set(tool.name, tool),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI);
    ctx = {
      mode: 'tui',
      hasUI: true,
      ui: { setStatus: vi.fn(), notify: vi.fn() },
      cwd: repo,
      model: undefined,
      sessionManager: { getSessionId: () => owner, getSessionFile: () => undefined },
      modelRegistry: { find: (provider: string, id: string) => (provider === 'prov' && id === 'model' ? {} : undefined), getApiKeyAndHeaders: async () => ({}) },
      isProjectTrusted: () => true,
      isIdle: () => true,
      hasPendingMessages: () => false,
    } as unknown as ExtensionToolContext;
    const spawnTool = tools.get('pi_spawn');
    const jobsTool = tools.get('tmux_jobs');
    if (!spawnTool || !jobsTool) throw new Error('parent job tools missing');
    process.argv[1] = fileURLToPath(new URL('./cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
    await handlers.get('session_start')?.({}, ctx);
    await spawnTool.execute('call', { name: 'scripted', brief: 'Run the scripted check.', model: 'prov/model', wake: false }, undefined, undefined, ctx);
    const root = join(agentDir, 'pstack-v2', 'jobs');
    const [id] = readdirSync(root);
    if (!id) throw new Error('worker job missing');
    const dir = join(root, id);
    const session = join(dir, 'session');
    await expect.poll(() => readdirSync(session).some((file) => readFileSync(join(session, file), 'utf8').includes('SUBSTANTIVE REPORT: initial verdict PASS')), { timeout: 20_000 }).toBe(true);
    expect(existsSync(join(dir, 'exit'))).toBe(false);
    writeFileSync(release, 'release');
    const waited = await jobsTool.execute('call', { action: 'wait', ids: [id], timeout_seconds: 20 }, undefined, undefined, ctx);
    expect(readFileSync(join(dir, 'exit'), 'utf8').trim()).toBe('0');
    expect(readFileSync(sawLate, 'utf8')).toBe('true');
    const stdout = readFileSync(join(dir, 'output.log'), 'utf8');
    expect(stdout.trim()).toBe('CORRECTION: late result checked. ACK.');
    for (const result of [waited, await jobsTool.execute('call', { action: 'output', ids: [id] }, undefined, undefined, ctx)]) {
      const report = result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      expect(report).toMatch(/SUBSTANTIVE REPORT: initial verdict PASS[\s\S]*CORRECTION: late result checked\. ACK\./);
      expect(report).toContain(`Transcript: ${session}/`);
    }
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toBe(stdout);
    rmSync(session, { recursive: true });
    const fallback = await jobsTool.execute('call', { action: 'output', ids: [id] }, undefined, undefined, ctx);
    const fallbackText = fallback.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(fallbackText).toContain('[No completed transcript answers available; showing raw stdout.]');
    expect(fallbackText).toContain('CORRECTION: late result checked. ACK.');
    expect(readFileSync(join(dir, 'output.log'), 'utf8')).toBe(stdout);
  } finally {
    await handlers.get('session_shutdown')?.({}, ctx);
    process.argv[1] = savedArgv;
    vi.unstubAllEnvs();
    try {
      execFileSync('tmux', ['-S', tmuxSocket(owner), 'kill-server'], { stdio: 'ignore' });
    } catch {
      // No server was started.
    }
    rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 50_000);
