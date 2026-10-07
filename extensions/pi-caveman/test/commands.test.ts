import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { harness } from './support/harness.ts';

let agentDir = '';
beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'caveman-agent-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('CAVEMAN_DEFAULT_MODE', 'caveman');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

const started = () => {
  const h = harness(agentDir);
  h.emit('session_start', { reason: 'startup' });
  return h;
};

const assistant = (timestamp: number, output: number) => ({ type: 'message', message: { role: 'assistant', model: 'm', timestamp, usage: { output, cacheRead: 0 } } });

describe('mode commands', () => {
  test('/ultracave reports the new mode', async () => {
    const h = started();
    await h.command('ultracave');
    expect(h.notices.at(-1)).toBe('Caveman mode: ultracave');
  });

  test('/ultracave switches the badge', async () => {
    const h = started();
    await h.command('ultracave');
    expect(h.statuses.at(-1)).toBe('[ULTRACAVE]');
  });

  test('/ultracave switches the injected ruleset', async () => {
    const h = started();
    await h.command('ultracave');
    expect(h.turn('x').sections['caveman']?.split('\n')[0]).toBe('CAVEMAN MODE ACTIVE — mode: ultracave');
  });

  test('repeating the active mode says unchanged', async () => {
    const h = started();
    await h.command('caveman');
    expect(h.notices.at(-1)).toBe('Caveman mode: caveman (unchanged)');
  });

  test('/caveman status writes no entry', async () => {
    const h = started();
    await h.command('caveman', 'status');
    expect(h.entries).toHaveLength(1);
  });

  test('/caveman status reports the mode', async () => {
    const h = started();
    await h.command('caveman', 'status');
    expect(h.notices.at(-1)).toBe('Caveman mode: caveman');
  });

  test('/megacave off turns caveman off', async () => {
    const h = started();
    await h.command('megacave', 'off');
    expect(h.notices.at(-1)).toBe('Caveman mode: off');
  });

  test('an unknown argument is reported without echo', async () => {
    const h = started();
    await h.command('caveman', 'loud');
    expect(h.notices.at(-1)).toBe('their /caveman argument was not recognized and the mode is unchanged. Modes: /caveman, /ultracave, /megacave. Use /caveman off to deactivate.');
  });
});

describe('argument completion', () => {
  test.for([
    { name: 'caveman', prefix: 'wen', expected: ['wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'] },
    { name: 'ultracave', prefix: '', expected: ['off', 'status'] },
  ])('completes $name arguments for "$prefix"', ({ name, prefix, expected }) => {
    expect(harness().completions(name, prefix)).toStrictEqual(expected.map((value) => ({ value, label: value })));
  });

  test('an argument prefix with no match completes to null', () => {
    expect(harness().completions('megacave', 'zz')).toBe(null);
  });
});

describe('/caveman-help', () => {
  test('posts the help card without frontmatter', async () => {
    const h = started();
    await h.command('caveman-help');
    expect(h.messages.at(-1)?.content.split('\n')[0]).toBe('# Caveman Help');
  });
});

describe('/caveman-stats', () => {
  test('an empty session posts the no-turns share line', async () => {
    const h = started();
    await h.command('caveman-stats', '--share');
    expect(h.messages.at(-1)).toStrictEqual({ customType: 'caveman-stats', content: '```\n🪨 No turns yet; savings unknown — caveman.sh\n```', display: true });
  });

  test('a session with turns appends a history row', async () => {
    const h = started();
    h.record(assistant(Date.now(), 12));
    await h.command('caveman-stats');
    const row = JSON.parse(readFileSync(join(agentDir, 'caveman', 'history.jsonl'), 'utf8'));
    expect(row).toMatchObject({ session_id: 'sid', mode: 'caveman', model: 'm', output_tokens: 12, turns: 1 });
  });

  test('--all aggregates the lifetime history', async () => {
    const h = started();
    h.record(assistant(Date.now(), 12));
    await h.command('caveman-stats');
    await h.command('caveman-stats', '--all');
    expect(h.messages.at(-1)?.content).toContain('Sessions:   1');
  });

  test('a malformed --since is rejected', async () => {
    const h = started();
    await h.command('caveman-stats', '--since 3w');
    expect(h.notices.at(-1)).toBe('caveman-stats: --since takes Nh or Nd (e.g. 7d, 24h), got: 3w');
  });
});

describe('without a UI (print and JSON modes)', () => {
  const headless = () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const h = harness(agentDir, { hasUI: false });
    h.emit('session_start', { reason: 'startup' });
    return { h, written: () => stderr.mock.calls.map(([chunk]) => String(chunk)).join('') };
  };

  test('/caveman status prints the mode on stderr', async () => {
    const { h, written } = headless();
    await h.command('caveman', 'status');
    expect(written()).toBe('Caveman mode: caveman\n');
  });

  test('a mode switch prints its confirmation on stderr', async () => {
    const { h, written } = headless();
    await h.command('megacave');
    expect(written()).toBe('Caveman mode: megacave\n');
  });

  test('/caveman-help prints the card on stderr', async () => {
    const { h, written } = headless();
    await h.command('caveman-help');
    expect(written().split('\n')[0]).toBe('# Caveman Help');
  });

  test('/caveman-stats prints the report on stderr', async () => {
    const { h, written } = headless();
    await h.command('caveman-stats');
    expect(written()).toContain('No conversation yet — stats available after first response.');
  });
});
