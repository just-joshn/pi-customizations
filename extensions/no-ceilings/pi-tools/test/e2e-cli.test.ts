import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { writeFakeModelConfig } from './support/fake-model.ts';
import { type FakeModelServer, type FakeTurn, startFakeModel } from './support/fake-model-server.ts';

/**
 * End to end: the real `pi` executable, configuration loader, agent loop, extension loader, and the
 * layer's tools, driven by a deterministic fake model server. Real files and processes are the
 * observable output. No LLM and no API cost.
 */

const extensionPath = path.join(import.meta.dirname, '..', 'src', 'index.ts');
const piAvailable = spawnSync('pi', ['--version'], { stdio: 'ignore' }).error === undefined;

interface ToolEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly result?: { readonly content?: readonly { readonly text?: string }[] };
  readonly message?: { readonly role?: string; readonly content?: unknown };
}

interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly ToolEvent[];
  readonly workspace: string;
  readonly server: FakeModelServer;
}

interface CliRunOptions {
  readonly tools?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

async function runCli(turns: readonly FakeTurn[], prompt: string, options: CliRunOptions = {}): Promise<CliRun> {
  const server = await startFakeModel(turns);
  const root = await mkdtemp(path.join(tmpdir(), 'pi-tools-e2e-'));
  const workspace = path.join(root, 'ws');
  const agentDir = path.join(root, 'agent');
  await mkdir(workspace, { recursive: true });
  await writeFakeModelConfig(agentDir, server.baseUrl);
  for (const [name, content] of Object.entries(options.files ?? {})) {
    await writeFile(path.join(workspace, name), content, 'utf-8');
  }

  const tools = options.tools ?? 'read,write,edit,bash';
  const args = ['--print', '--mode', 'json', '--model', 'fake/fake-model', '--provider', 'fake', '--tools', tools, '-e', extensionPath, prompt];
  // The child must not inherit the coverage agent, or its partial run would merge into the suite's.
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...options.env };
  delete env['NODE_V8_COVERAGE'];
  const deadline = AbortSignal.timeout(45_000);
  const combined = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const child = spawn('pi', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'], signal: combined, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const events = stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line) as ToolEvent;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is ToolEvent => event !== undefined);

  return { code, stdout, stderr, events, workspace, server };
}

describe.skipIf(!piAvailable)('e2e: real CLI against a deterministic model server', () => {
  let run: CliRun | undefined;

  afterEach(async () => {
    if (run !== undefined) {
      await run.server.close();
      await rm(path.dirname(run.workspace), { recursive: true, force: true });
      run = undefined;
    }
  });

  it('runs real tools and produces real files and processes', async ({ signal }) => {
    run = await runCli(
      [
        { toolCalls: [{ name: 'write', arguments: { path: 'notes.txt', content: 'alpha\n' } }] },
        { toolCalls: [{ name: 'bash', arguments: { command: 'printf side > side.txt && printf "process=%s" "$PPID" > proc.txt' } }] },
        { toolCalls: [{ name: 'read', arguments: { path: 'notes.txt' } }] },
        { text: 'E2E-COMPLETE' },
      ],
      'Create the notes file, run the shell step, and read the file back.',
      { signal },
    );

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('E2E-COMPLETE');

    const ends = run.events.filter((event) => event.type === 'tool_execution_end');
    expect(ends.map((event) => event.toolName)).toEqual(['write', 'bash', 'read']);
    expect(ends.map((event) => event.isError)).toEqual([false, false, false]);
    const readEnd = ends[2];
    expect(readEnd?.result?.content?.[0]?.text ?? '').toContain('alpha');

    expect(await readFile(path.join(run.workspace, 'notes.txt'), 'utf-8')).toBe('alpha\n');
    expect(await readFile(path.join(run.workspace, 'side.txt'), 'utf-8')).toBe('side');
    expect(await readFile(path.join(run.workspace, 'proc.txt'), 'utf-8')).toMatch(/^process=\d+$/);

    expect(run.server.requests.length).toBeGreaterThanOrEqual(4);
    expect(run.server.requests[0]?.toolNames).toEqual(expect.arrayContaining(['read', 'write', 'bash']));
    expect(run.server.requests[1]?.messages.some((message) => JSON.stringify(message).includes('Successfully wrote to'))).toBe(true);
  });

  it('reports a validation failure to the model and writes nothing', async ({ signal }) => {
    run = await runCli([{ toolCalls: [{ name: 'write', arguments: { path: 'never.txt' } }] }, { text: 'SAW-VALIDATION-ERROR' }], 'Write the file.', { signal });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('SAW-VALIDATION-ERROR');
    const end = run.events.find((event) => event.type === 'tool_execution_end');
    expect(end?.isError).toBe(true);
    expect(end?.result?.content?.[0]?.text ?? '').toContain('Validation failed for tool "write"');
    await expect(readFile(path.join(run.workspace, 'never.txt'), 'utf-8')).rejects.toThrow();
    expect(run.server.requests[1]?.messages.some((message) => JSON.stringify(message).includes('Validation failed'))).toBe(true);
  });

  it('enforces the permission policy through the real loader and workspace', async ({ signal }) => {
    run = await runCli([{ toolCalls: [{ name: 'read', arguments: { path: 'secret.txt' } }] }, { text: 'SAW-BLOCK' }], 'Read the secret.', {
      tools: 'read,write,bash',
      files: { 'secret.txt': 'TOP-SECRET\n' },
      env: { PI_TOOLS_RULES: 'read:deny:**/secret.txt' },
      signal,
    });
    const end = run.events.find((event) => event.type === 'tool_execution_end');
    expect(end?.isError).toBe(true);
    expect(end?.result?.content?.[0]?.text ?? '').toContain('Blocked by permissions configuration');
    expect(run.server.requests[1]?.messages.some((message) => JSON.stringify(message).includes('Blocked by permissions configuration'))).toBe(true);
  });
});
