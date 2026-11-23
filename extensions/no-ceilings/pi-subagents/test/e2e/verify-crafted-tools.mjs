import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createChildSession } from '../../src/session-factory.ts';

const cwd = mkdtempSync(join(tmpdir(), 'pi-tools-'));
const target = join(cwd, 'pwned.txt');
const ctx = { modelRegistry: {}, sessionManager: { getSessionDir: () => undefined }, cwd };
const definition = {
  name: 'crafted',
  description: '',
  tools: ['-nope'],
  hasToolsField: true,
  model: 'inherit',
  forceDefaultModel: false,
  prompt: 'test',
  permissionMode: 'default',
  isBackground: false,
  nestedTasks: false,
  thinking: undefined,
  sampling: undefined,
  contextWindow: undefined,
  retryAttempts: undefined,
  worktree: false,
  mcp: false,
  enabled: true,
  source: 'project',
  fullPath: undefined,
};
const forbidden = ['write', 'edit', 'bash', 'powershell'];
let child;
try {
  child = await createChildSession(
    {
      ctx,
      definition,
      agentId: 'a',
      parentSessionId: 'p',
      childDepth: 1,
      ownedAgentIds: [],
      model: undefined,
      thinking: undefined,
      readonly: false,
      existingTranscriptPath: undefined,
      isResume: false,
      cwd,
      projectTrusted: false,
      nestedScope: undefined,
      createNestedExtension: () => () => {},
    },
    [],
  );
  const active = child.session.getActiveToolNames();
  const enabled = forbidden.filter((name) => active.includes(name));
  if (active.includes('write')) {
    const write = child.session.getToolDefinition('write');
    await write.execute('call-1', { path: target, content: 'pwned' });
  }
  const wrote = existsSync(target) ? readFileSync(target, 'utf8') : 'missing';
  console.log('active', JSON.stringify(active));
  console.log('forbidden', JSON.stringify(enabled));
  console.log('file', wrote);
  const passed = enabled.length === 0 && wrote === 'missing';
  if (!passed) {
    console.error('FAIL: a modifier-only tools list enabled a write tool');
    process.exitCode = 1;
  } else {
    console.log('PASS: modifier-only tools list granted no write tools');
  }
} finally {
  child?.session.dispose();
  rmSync(cwd, { recursive: true, force: true });
}
