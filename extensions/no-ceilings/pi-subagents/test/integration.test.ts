import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentSession, DefaultResourceLoader, type ExtensionFactory, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import piSubagentsExtension from '../src/index.ts';
import { type FakeModelRequest, startFakeModelServer } from './fixtures/fake-model-server.mjs';

const ONE = 1;
const CHILD_MARKER = 'FAKE_CHILD_MARKER';

let server: Awaited<ReturnType<typeof startFakeModelServer>>;
let root: string;
let profile: string;
let workspace: string;
let previousAgentDir: string | undefined;

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
    writeFileSync(
      join(workspace, '.pi', 'agents', 'worker.md'),
      ['---', 'name: worker', 'description: Reads one file and reports its contents.', 'tools: read', '---', `${CHILD_MARKER}. Read the requested file and report its contents.`].join('\n'),
    );
    previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
    process.env['PI_CODING_AGENT_DIR'] = profile;
  });

  afterAll(async () => {
    if (previousAgentDir === undefined) {
      delete process.env['PI_CODING_AGENT_DIR'];
    } else {
      process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
    }
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
});
