import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSession, DefaultResourceLoader, type ExtensionFactory, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import piSubagentsExtension from '../src/index.ts';
import { type FakeModelRequest, startFakeModelServer } from './fixtures/fake-model-server.mjs';

const ONE = 1;
const CHILD_MARKER = 'FAKE_CHILD_MARKER';

let server: Awaited<ReturnType<typeof startFakeModelServer>>;
let root: string;
let profile: string;
let workspace: string;

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => (typeof part === 'string' ? part : typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '')).join('');
}

function childRequests(requests: readonly FakeModelRequest[]): readonly FakeModelRequest[] {
  return requests.filter((request) => request.messages.some((message) => message.role === 'system' && textOf(message.content).includes(CHILD_MARKER)));
}

function createSession(): Promise<Awaited<ReturnType<typeof createAgentSession>>['session']> {
  return (async () => {
    const settingsManager = SettingsManager.create(workspace, profile, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir: profile,
      settingsManager,
      extensionFactories: [piSubagentsExtension as ExtensionFactory],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: workspace,
      agentDir: profile,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.create(workspace, join(workspace, 'sessions')),
    });
    return session;
  })();
}

describe('real session delegation', () => {
  beforeAll(async () => {
    server = await startFakeModelServer({ childMarker: CHILD_MARKER });
    root = mkdtempSync(join(tmpdir(), 'pi-subagents-integration-'));
    profile = join(root, 'profile');
    workspace = join(root, 'workspace');
    mkdirSync(profile, { recursive: true });
    mkdirSync(join(workspace, '.pi', 'agents'), { recursive: true });
    mkdirSync(join(workspace, 'sessions'), { recursive: true });
    writeFileSync(
      join(profile, 'models.json'),
      JSON.stringify({
        providers: {
          fake: {
            baseUrl: `${server.url}/v1`,
            api: 'openai-completions',
            apiKey: 'fake-key',
            models: [{ id: 'fake-model', contextWindow: 100_000, maxTokens: 4096 }],
          },
        },
      }),
    );
    writeFileSync(join(workspace, 'marker.txt'), 'alpha\n');
    writeFileSync(join(workspace, '.pi', 'APPEND_SYSTEM.md'), 'PROJECT_APPEND_RULE\n');
    writeFileSync(
      join(workspace, '.pi', 'agents', 'worker.md'),
      ['---', 'name: worker', 'description: Reads one file and reports its contents.', 'tools: read', '---', `${CHILD_MARKER}. Read the requested file and report its contents.`].join('\n'),
    );
  });

  beforeEach(() => {
    vi.stubEnv('PI_CODING_AGENT_DIR', profile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('runs a real parent, child, and read tool, then returns the result', async () => {
    const before = server.requests.length;
    const session = await createSession();
    try {
      await session.prompt('Delegate this work to the worker subagent, then report its result.');
      expect(session.getLastAssistantText()).toContain('PARENT_SAW:CHILD_SAW:alpha');
      const messages = JSON.stringify(session.agent.state.messages);
      expect(messages).toContain('"name":"task"');
      expect(messages).toContain('CHILD_SAW:alpha');
      const requests = server.requests.slice(before);
      expect(childRequests(requests)).toHaveLength(2);
      expect(JSON.stringify(childRequests(requests))).toContain('"name":"read"');
      for (const request of childRequests(requests)) {
        const system = request.messages
          .filter((message) => message.role === 'system')
          .map((message) => textOf(message.content))
          .join('\n');
        expect(system).toContain('PROJECT_APPEND_RULE');
      }
      const transcripts = readdirSync(join(workspace, 'sessions', 'subagents'));
      expect(transcripts.length).toBe(ONE);
      const transcript = readFileSync(join(workspace, 'sessions', 'subagents', transcripts[0] ?? ''), 'utf8');
      expect(transcript).toContain('"name":"read"');
      expect(transcript).toContain('CHILD_SAW:alpha');
    } finally {
      session.dispose();
    }
  });

  it('keeps the child context isolated from the parent conversation', async () => {
    const before = server.requests.length;
    writeFileSync(join(workspace, 'marker.txt'), 'beta\n');
    const session = await createSession();
    try {
      await session.prompt('Delegate the beta check to the worker subagent, then report its result.');
      expect(session.getLastAssistantText()).toContain('PARENT_SAW:CHILD_SAW:beta');
      const requests = childRequests(server.requests.slice(before));
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        const serialized = JSON.stringify(request.messages);
        expect(serialized).not.toContain('Delegate the beta check');
        expect(serialized).not.toContain('Delegate this work');
        expect(serialized).toContain('Read marker.txt');
      }
    } finally {
      session.dispose();
    }
  });

  it('reports a failure id and retries when child model requests fail with HTTP 500', async () => {
    let seenChildCalls = 0;
    const errorServer = await startFakeModelServer({
      childMarker: CHILD_MARKER,
      onRequest: ({ isChild, hasToolResult, model, response, streamText, streamToolCall }) => {
        if (isChild) {
          seenChildCalls += ONE;
          response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'upstream failed' } }));
          return true;
        }
        if (!hasToolResult) {
          streamToolCall(response, model, {
            id: 'call_retry_task',
            name: 'task',
            args: { description: 'Retry failing child', prompt: 'Do work', subagent_type: 'worker', max_attempts: 2 },
          });
          return true;
        }
        const tool = [...(response.req ? [] : [])];
        void tool;
        streamText(response, model, 'PARENT_SAW_DONE');
        return true;
      },
    });
    const errRoot = mkdtempSync(join(tmpdir(), 'pi-subagents-err-'));
    const errProfile = join(errRoot, 'profile');
    const errWorkspace = join(errRoot, 'workspace');
    mkdirSync(errProfile, { recursive: true });
    mkdirSync(join(errWorkspace, '.pi', 'agents'), { recursive: true });
    mkdirSync(join(errWorkspace, 'sessions'), { recursive: true });
    writeFileSync(
      join(errProfile, 'models.json'),
      JSON.stringify({
        providers: {
          fake: { baseUrl: `${errorServer.url}/v1`, api: 'openai-completions', apiKey: 'fake-key', models: [{ id: 'fake-model', contextWindow: 100_000, maxTokens: 4096 }] },
        },
      }),
    );
    writeFileSync(join(errWorkspace, '.pi', 'agents', 'worker.md'), ['---', 'name: worker', 'description: Worker.', 'tools: read', '---', `${CHILD_MARKER}.`].join('\n'));
    vi.stubEnv('PI_CODING_AGENT_DIR', errProfile);
    const settings = SettingsManager.create(errWorkspace, errProfile, { projectTrusted: true });
    const loader = new DefaultResourceLoader({ cwd: errWorkspace, agentDir: errProfile, settingsManager: settings, extensionFactories: [piSubagentsExtension as ExtensionFactory] });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: errWorkspace,
      agentDir: errProfile,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: SessionManager.create(errWorkspace, join(errWorkspace, 'sessions')),
    });
    try {
      await session.prompt('Run the worker with retries.');
      const serialized = JSON.stringify(session.agent.state.messages);
      expect(serialized).toContain('failure_id');
      expect(serialized).toContain('attempts: 2');
      expect(seenChildCalls).toBeGreaterThan(ONE);
    } finally {
      session.dispose();
      vi.unstubAllEnvs();
      vi.stubEnv('PI_CODING_AGENT_DIR', profile);
      await errorServer.close();
      rmSync(errRoot, { recursive: true, force: true });
    }
  });
});
