import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { clearAgentCache, discoverAgents } from '../src/subagents/definitions.ts';

vi.mock(import('node:fs'), { spy: true });

test('[G2-02] cache hit performs zero filesystem reads and clear reloads an edited file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-cache-'));
  const agents = join(dir, '.pi/agents');
  const file = join(agents, 'cache.md');
  const options = { root: dir, userDirs: [], env: {} };
  try {
    clearAgentCache();
    mkdirSync(agents, { recursive: true });
    writeFileSync(file, '---\nname: cache\ndescription: cache probe\n---\nfirst body');
    vi.clearAllMocks();
    const first = discoverAgents(options);
    expect(readFileSync).toHaveBeenCalledWith(file, 'utf8');
    expect(readdirSync).toHaveBeenCalled();
    expect(statSync).toHaveBeenCalled();
    writeFileSync(file, '---\nname: cache\ndescription: cache probe\n---\nsecond body');
    vi.clearAllMocks();
    expect(discoverAgents(options)).toBe(first);
    expect(readFileSync).toHaveBeenCalledTimes(0);
    expect(readdirSync).toHaveBeenCalledTimes(0);
    expect(statSync).toHaveBeenCalledTimes(0);
    clearAgentCache();
    const fresh = discoverAgents(options);
    expect(fresh.activeAgents.find((entry) => entry.agentType === 'cache')?.systemPrompt).toBe('second body');
    expect(readFileSync).toHaveBeenCalledWith(file, 'utf8');
  } finally {
    clearAgentCache();
    rmSync(dir, { recursive: true, force: true });
  }
});
