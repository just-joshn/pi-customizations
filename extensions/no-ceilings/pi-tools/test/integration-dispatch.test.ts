import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import piToolsExtension from '../src/index.ts';
import { fakeModel, writeFakeModelConfig } from './support/fake-model.ts';
import { type FakeModelServer, startFakeModel } from './support/fake-model-server.ts';

/**
 * Integration: Pi's own agent loop validates arguments, dispatches to the layer's tools, and feeds the
 * results back to the model. No CLI process and no real provider; the model is the deterministic server.
 */

interface ToolEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly isError?: boolean;
  readonly result?: { readonly content?: readonly { readonly type: string; readonly text?: string }[] };
}

describe('integration: agent tool-call dispatcher', () => {
  let server: FakeModelServer | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('validates arguments, runs real local tools, and returns their results to the model', async () => {
    server = await startFakeModel([
      { toolCalls: [{ name: 'write', arguments: { path: 'broken.txt' } }] },
      {
        toolCalls: [
          { name: 'write', arguments: { path: 'notes.txt', content: 'alpha\n' } },
          { name: 'bash', arguments: { command: 'printf side > side.txt' } },
        ],
      },
      { text: 'INTEGRATION-OK' },
    ]);
    root = await mkdtemp(path.join(tmpdir(), 'pi-tools-integration-'));
    const workspace = path.join(root, 'ws');
    const agentDir = path.join(root, 'agent');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(workspace, { recursive: true });
    await writeFakeModelConfig(agentDir, server.baseUrl);

    // The factory is passed inline so the test and the agent share one module instance.
    const loader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      extensionFactories: [piToolsExtension],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: workspace,
      agentDir,
      model: fakeModel(server.baseUrl) as never,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(workspace),
      tools: ['read', 'write', 'edit', 'bash'],
    });

    const events: ToolEvent[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event as ToolEvent);
    });
    try {
      await session.prompt('Create the notes file, then run the shell step.');
      expect(session.getLastAssistantText()).toBe('INTEGRATION-OK');
    } finally {
      unsubscribe();
      session.dispose();
    }

    const ends = events.filter((event) => event.type === 'tool_execution_end');
    const writeEnds = ends.filter((event) => event.toolName === 'write');
    expect(writeEnds).toHaveLength(2);
    const rejected = writeEnds[0];
    expect(rejected?.isError).toBe(true);
    expect(rejected?.result?.content?.[0]?.text ?? '').toContain('Validation failed for tool "write"');
    const accepted = writeEnds[1];
    expect(accepted?.isError).toBe(false);
    const bashEnd = ends.find((event) => event.toolName === 'bash');
    expect(bashEnd?.isError).toBe(false);

    const starts = events.filter((event) => event.type === 'tool_execution_start').map((event) => event.toolName);
    expect(starts).toEqual(['write', 'write', 'bash']);

    expect(await readFile(path.join(workspace, 'notes.txt'), 'utf-8')).toBe('alpha\n');
    expect(await readFile(path.join(workspace, 'side.txt'), 'utf-8')).toBe('side');

    // The dispatcher sent the validation failure and the real tool results back as tool messages.
    expect(server.requests[1]?.messages.some((message) => JSON.stringify(message).includes('Validation failed for tool'))).toBe(true);
    expect(server.requests[2]?.messages.some((message) => JSON.stringify(message).includes('Successfully wrote to'))).toBe(true);
    expect(server.requests[0]?.toolNames).toEqual(expect.arrayContaining(['read', 'write', 'bash']));
  });

  it('returns a tool error to the model instead of aborting the run', async () => {
    server = await startFakeModel([{ toolCalls: [{ name: 'read', arguments: { path: 'missing.txt' } }] }, { text: 'SAW-ERROR' }]);
    root = await mkdtemp(path.join(tmpdir(), 'pi-tools-integration-'));
    const workspace = path.join(root, 'ws');
    const agentDir = path.join(root, 'agent');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(workspace, { recursive: true });
    await writeFakeModelConfig(agentDir, server.baseUrl);

    const loader = new DefaultResourceLoader({ cwd: workspace, agentDir, extensionFactories: [piToolsExtension] });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: workspace,
      agentDir,
      model: fakeModel(server.baseUrl) as never,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(workspace),
      tools: ['read', 'write', 'bash'],
    });

    try {
      await session.prompt('Read the missing file.');
      expect(session.getLastAssistantText()).toBe('SAW-ERROR');
    } finally {
      session.dispose();
    }

    expect(server.requests[1]?.messages.some((message) => JSON.stringify(message).includes('File not found'))).toBe(true);
  });
});
